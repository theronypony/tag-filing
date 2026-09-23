import { describe, expect, it, vi } from 'vitest';
import AutoTagNotesPlugin from '../src/main';
import { DEFAULT_SETTINGS, migrateSettings } from '../src/settings';
import { confirmFolderMoves } from '../src/ui/confirmDialog';
import { showFolderSetup } from '../src/ui/folderSetupModal';
import { createMoveLog } from '../src/organizer/moveLog';
import { Modal, Plugin } from './stubs/obsidian';
import { vaultHarness } from './helpers/vault';

const currentModal = () => Modal.opened[Modal.opened.length - 1];
async function dialog(title: string): Promise<Modal> {
    await vi.waitFor(() => expect(currentModal()?.contentEl.allText()).toContain(title), { interval: 5 });
    return currentModal();
}
async function click(label: string): Promise<void> {
    const button = currentModal().contentEl.allButtons().find(button => button.text === label);
    expect(button, `Missing button: ${label}`).toBeDefined();
    await button!.click();
}
async function makePlugin() {
    const h = vaultHarness();
    const plugin = new AutoTagNotesPlugin(h.app, { id: 'inherit-tags', name: 'Inherit Tags', version: '2.0.0', minAppVersion: '1.11.0', author: 'test' });
    await plugin.onload();
    return { ...h, plugin, testPlugin: plugin as unknown as Plugin };
}
async function finished(plugin: AutoTagNotesPlugin) {
    await vi.waitFor(() => expect((plugin as unknown as { manualRunning: boolean }).manualRunning).toBe(false), { interval: 5 });
}

describe('folder setup and settings migration', () => {
    it('drops the old auto-tagger switch, starts filing off, and preserves existing preferences', () => {
        expect(migrateSettings({ autoTaggerEnabled: true, autoMoveEnabled: true, excludeFolders: 'Templates, Archive',
            hexColorFilter: false, skipShortNumericTags: true, customExcludeRegex: '^temporary',
            convertExistingOnly: true, stripSingleNoteTags: true })).toEqual({
            ...DEFAULT_SETTINGS, excludeFolders: 'Templates, Archive', hexColorFilter: false,
            skipShortNumericTags: true, customExcludeRegex: '^temporary', convertExistingOnly: true, stripSingleNoteTags: true
        });
        expect(migrateSettings({ onboardingVersion: 2, autoMoveEnabled: true }).autoMoveEnabled).toBe(true);
        expect(migrateSettings(null)).toEqual(DEFAULT_SETTINGS);
    });

    it('explains the Navigator hotkey requirement and only enables filing after explicit setup acceptance', async () => {
        const h = await makePlugin();
        h.plugin.showSetup();
        const modal = await dialog('Set up tag-based folders');
        expect(modal.contentEl.allText()).toContain('Notebook Navigator: Create new note');
        expect(modal.contentEl.allText()).toContain('Command-N');
        expect(modal.contentEl.allText()).toContain('no longer adds tags');
        expect(h.plugin.settings.autoMoveEnabled).toBe(false);
        await click('NN command configured — enable filing');
        await vi.waitFor(() => expect(h.testPlugin.storedData).toMatchObject({ onboardingVersion: 2, autoMoveEnabled: true }));
        expect(h.renameFile).not.toHaveBeenCalled();
        h.plugin.onunload();
    });

    it('leaves automatic filing off when onboarding is dismissed', async () => {
        const h = vaultHarness();
        const result = showFolderSetup(h.app);
        currentModal().close();
        expect(await result).toBe(false);
    });
});

describe('backup confirmations and mutation gating', () => {
    it.each(['preview', 'first', 'second'])('cancelling %s makes no note, folder or log changes', async stage => {
        const h = await makePlugin();
        h.seedFile('note.md', '#work');
        h.testPlugin.commands.find(command => command.id === 'move-single-tag-notes')!.callback();
        await dialog('Move single-tag notes — preview');
        if (stage !== 'preview') {
            await click('Proceed to move 1 notes…');
            await dialog('Move notes to matching folders?');
        }
        if (stage === 'second') {
            await click('I understand, continue');
            await dialog('Are you absolutely sure?');
        }
        await click('Cancel');
        await finished(h.plugin);
        expect(h.createFolder).not.toHaveBeenCalled();
        expect(h.renameFile).not.toHaveBeenCalled();
        expect(h.write).not.toHaveBeenCalled();
        expect(h.append).not.toHaveBeenCalled();
        h.plugin.onunload();
    });

    it.each(['first', 'second'])('dismissing the %s warning aborts the operation', async stage => {
        const h = vaultHarness();
        const confirmation = confirmFolderMoves(h.app, 1);
        await dialog('Move notes to matching folders?');
        if (stage === 'second') {
            await click('I understand, continue');
            await dialog('Are you absolutely sure?');
        }
        currentModal().close();
        expect(await confirmation).toBe(false);
    });

    it('requires both backup warnings before any writes and repeats both warnings on every run', async () => {
        const h = await makePlugin();
        for (const name of ['one.md', 'two.md']) {
            h.seedFile(name, '#work');
            h.plugin.runOrganizer();
            const before = h.renameFile.mock.calls.length;
            const writesBefore = h.write.mock.calls.length;
            await dialog('Move single-tag notes — preview');
            await click('Proceed to move 1 notes…');
            let modal = await dialog('Move notes to matching folders?');
            expect(modal.contentEl.allText()).toContain('Back up your entire vault');
            expect(modal.contentEl.allButtons().find(button => button.text === 'Cancel')?.cta).toBe(true);
            expect(h.renameFile).toHaveBeenCalledTimes(before);
            expect(h.write).toHaveBeenCalledTimes(writesBefore);
            await click('I understand, continue');
            modal = await dialog('Are you absolutely sure?');
            expect(modal.contentEl.allText()).toContain('backed up your entire vault');
            expect(h.renameFile).toHaveBeenCalledTimes(before);
            expect(h.write).toHaveBeenCalledTimes(writesBefore);
            await click('Yes, I have backed up — proceed');
            await dialog('Folder moves complete');
            await finished(h.plugin);
            expect(h.renameFile).toHaveBeenCalledTimes(before + 1);
            expect(h.entries.has(`work/${name}`)).toBe(true);
            const records = [...h.writes.values()].flatMap(content => content.split('\n').filter(Boolean).map(line => JSON.parse(line)));
            expect(records.some(record => record.type === 'result' && record.source === name && record.status === 'moved')).toBe(true);
            await click('Close');
        }
        expect(h.processFrontMatter).not.toHaveBeenCalled();
        h.plugin.onunload();
    });

    it('exports a preview only on request and never moves from the export action', async () => {
        const h = await makePlugin();
        h.seedFile('note.md', '#work');
        h.plugin.runOrganizer();
        await dialog('Move single-tag notes — preview');
        await click('Export report');
        expect(h.write).toHaveBeenCalledTimes(1);
        expect([...h.writes.keys()][0]).toContain('folder-moves-preview.md');
        expect(h.renameFile).not.toHaveBeenCalled();
        expect(h.createFolder).not.toHaveBeenCalled();
        await click('Cancel');
        await finished(h.plugin);
        h.plugin.onunload();
    });

    it('does not open backup warnings when no notes qualify', async () => {
        const h = await makePlugin();
        h.seedFile('note.md', '#work #home');
        h.plugin.runOrganizer();
        const modal = await dialog('Move single-tag notes — preview');
        expect(modal.contentEl.allButtons().find(button => button.text.startsWith('Proceed'))?.disabled).toBe(true);
        await click('Close');
        await finished(h.plugin);
        expect(await confirmFolderMoves(h.app, 0)).toBe(false);
        expect(Modal.opened).toHaveLength(0);
        expect(h.write).not.toHaveBeenCalled();
        h.plugin.onunload();
    });

    it('ignores late confirmation after the plugin has been disabled', async () => {
        const h = await makePlugin();
        h.seedFile('note.md', '#work');
        h.plugin.runOrganizer();
        await dialog('Move single-tag notes — preview');
        await click('Proceed to move 1 notes…');
        await dialog('Move notes to matching folders?');
        await click('I understand, continue');
        await dialog('Are you absolutely sure?');
        h.plugin.onunload();
        await click('Yes, I have backed up — proceed');
        await finished(h.plugin);
        expect(h.renameFile).not.toHaveBeenCalled();
        expect(h.write).not.toHaveBeenCalled();
    });
});

describe('incremental recovery log', () => {
    it('writes the plan once, appends per-note states and keeps independent run files', async () => {
        const h = vaultHarness();
        const plugin = new Plugin(h.app);
        const files = [{ source: 'note.md', destination: 'work/note.md', tag: 'work', status: 'pending' as const }];
        const record = createMoveLog(plugin as never, files);
        const other = createMoveLog(plugin as never, files);
        expect(record.path).not.toBe(other.path);
        expect(h.write).not.toHaveBeenCalled();
        await record.save();
        await record.save({ ...files[0], status: 'moving' });
        await record.save({ ...files[0], status: 'moved' });
        record.log.finishedAt = new Date().toISOString();
        await record.save();
        const entries = h.writes.get(record.path)!.split('\n').filter(Boolean).map(line => JSON.parse(line));
        expect(entries.map(entry => entry.type)).toEqual(['plan', 'result', 'result', 'summary']);
        expect(entries[1].status).toBe('moving');
        expect(entries[2].status).toBe('moved');
        expect(h.write).toHaveBeenCalledTimes(1);
        expect(h.append).toHaveBeenCalledTimes(3);
    });
});
