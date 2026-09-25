import { describe, expect, it, vi } from 'vitest';
import { FolderMover } from '../src/folderPlacement';
import { TagDropFiler } from '../src/tagDrop/tagDropFiler';
import { editDroppedNoteTags } from '../src/tagDrop/noteTagEdit';
import { readNoteTags } from '../src/organizer/noteTags';
import { TagDropBehavior } from '../src/ui/tagDropModal';
import { migrateSettings } from '../src/settings';
import { Modal } from './stubs/obsidian';
import { note, vaultHarness } from './helpers/vault';
import { navigatorMoveQueue } from './helpers/navigator';
import { moveFileWithNotebookNavigator } from '../src/nnApi';

function harness() {
    const h = vaultHarness();
    const moveQueue = navigatorMoveQueue();
    (h.app as any).plugins.plugins['notebook-navigator'] = { api: { getVersion: () => '2.0.0' }, commandQueue: moveQueue };
    const state = { enabled: true, behavior: 'ask' as TagDropBehavior, exclusions: [] as string[] };
    const notify = vi.fn();
    const selectTag = vi.fn(async (_tag: string, _shouldCancel: () => boolean) => true);
    const save = vi.fn(async (value: TagDropBehavior) => { state.behavior = value; });
    const filer = new TagDropFiler(h.app, new FolderMover(h.app), {
        enabled: () => state.enabled, exclusions: () => state.exclusions, behavior: () => state.behavior,
        saveBehavior: save, selectTag, notify,
        renameFile: (file, destination) => moveFileWithNotebookNavigator(h.app, file, destination)
    });
    return { ...h, state, filer, notify, save, selectTag, moveQueue };
}

async function modal() {
    await vi.waitFor(() => expect(Modal.opened).toHaveLength(1), { interval: 2 });
    return Modal.opened[0];
}

async function choose(choice: 'Yes' | 'No, just add the tag', remember = false) {
    const dialog = await modal();
    const checkbox = dialog.contentEl.allElements().find(element => element.tagName === 'input')!;
    checkbox.checked = remember;
    checkbox.dispatchEvent(new Event('change'));
    await dialog.contentEl.allButtons().find(button => button.text === choice)!.click();
}

describe('explicit drop tag editing', () => {
    it('removes other frontmatter aliases and inline occurrences while preserving unrelated property values and protected text', () => {
        const before = note({ title: 'Meeting', Tags: ['work', 'home'], tag: 'travel', description: '#keep' },
            '#work repeated #WORK\n#personal\n%% #comment %%\n`#code`\n```\n#fenced\n```\n<pre>#raw</pre>\n#2024\n\\#escaped');
        const after = editDroppedNoteTags(before, 'personal', true);
        expect(readNoteTags(after).tags).toEqual(['personal']);
        expect(after).toContain('"title":"Meeting"');
        expect(after).toContain('"description":"#keep"');
        for (const text of ['#comment', '`#code`', '#fenced', '<pre>#raw</pre>', '#2024', '\\#escaped', '#personal']) expect(after).toContain(text);
        expect(after).not.toContain('#work');
        expect(after).not.toContain('#WORK');
        expect(after).not.toContain('"tag":');
    });

    it('add-only keeps all existing properties and body text, without treating a parent as the child tag', () => {
        const before = note({ Tags: ['work/meetings'], tag: 'travel' }, '#home and #work/meetings');
        const after = editDroppedNoteTags(before, 'work', false);
        expect(readNoteTags(after).tags).toEqual(['work/meetings', 'work', 'travel', 'home']);
        expect(after.endsWith('#home and #work/meetings')).toBe(true);
        expect(after).toContain('"tag":"travel"');
    });

    it('leaves content byte-for-byte intact when the requested tag is already the only tag', () => {
        const before = '\uFEFF' + note({ tags: 'WORK' }, '#work').replace(/\n/g, '\r\n');
        expect(editDroppedNoteTags(before, 'work', true)).toBe(before);
        expect(editDroppedNoteTags(before + ' #home', 'work', false)).toBe(before + ' #home');
    });

    it('retains BOM and CRLF when rewriting, and never counts code markers inside comments', () => {
        const before = '\uFEFF' + note({ tags: 'work' }, '%%\n```\n%%\n#home').replace(/\n/g, '\r\n');
        const after = editDroppedNoteTags(before, 'personal', true);
        expect(after.startsWith('\uFEFF---\r\n')).toBe(true);
        expect(after.replace(/\r\n/g, '')).not.toContain('\n');
        expect(after).toContain('%%\r\n```\r\n%%');
        expect(readNoteTags(after).tags).toEqual(['personal']);
    });
});

describe('tag-drop filing decisions', () => {
    it.each(['#work', note({ tags: ['work'] }), note({ Tags: ['WORK', '#work'] }, '#Work #work'), 'Untagged note'])
    ('automatically replaces zero or one distinct pre-drop tag and creates the full target folder: %s', async before => {
        const h = harness();
        h.state.behavior = 'add'; // This preference must affect multi-tag notes only.
        const file = h.seedFile('inbox/note.md', before);
        await h.filer.enqueue([file], 'personal/meetings');
        expect(file.path).toBe('personal/meetings/note.md');
        expect(readNoteTags(h.contents.get(file)!).tags).toEqual(['personal/meetings']);
        expect(Modal.opened).toHaveLength(0);
        expect(h.save).not.toHaveBeenCalled();
        expect(h.selectTag).toHaveBeenCalledWith('personal/meetings', expect.any(Function));
    });

    it.each(['Yes', 'No, just add the tag'] as const)('prompts before changing multi-tag notes and handles %s', async choice => {
        const h = harness();
        const before = note({ tags: ['work'] }, 'Text #home');
        const file = h.seedFile('inbox/note.md', before);
        const pending = h.filer.enqueue([file], 'personal');
        const dialog = await modal();
        expect(dialog.contentEl.allText()).toContain('Move to #personal and remove all other tags?');
        expect(dialog.contentEl.allText()).toContain('inbox/note.md');
        expect(h.process).not.toHaveBeenCalled();
        expect(h.createFolder).not.toHaveBeenCalled();
        expect(h.moveQueue.isChangingFilePaths()).toBe(false); // Never suppress reveal while waiting for a choice.
        await choose(choice);
        await pending;
        expect(readNoteTags(h.contents.get(file)!).tags).toEqual(choice === 'Yes' ? ['personal'] : ['work', 'personal', 'home']);
        expect(file.path).toBe(choice === 'Yes' ? 'personal/note.md' : 'inbox/note.md');
        expect(h.save).not.toHaveBeenCalled();
        expect(h.state.behavior).toBe('ask');
        expect(h.filer.busy).toBe(false);
        expect(h.selectTag).toHaveBeenCalledTimes(choice === 'Yes' ? 1 : 0);
    });

    it.each(['Yes', 'No, just add the tag'] as const)('remembers %s and uses it for the rest of a multi-note drop', async choice => {
        const h = harness();
        const files = ['one', 'two'].map(name => h.seedFile(`${name}.md`, '#work #home'));
        const pending = h.filer.enqueue(files, 'personal');
        await choose(choice, true);
        await pending;
        expect(h.save).toHaveBeenCalledOnce();
        expect(h.state.behavior).toBe(choice === 'Yes' ? 'move' : 'add');
        expect(Modal.opened).toHaveLength(0);
        for (const file of files) {
            expect(file.path.startsWith('personal/')).toBe(choice === 'Yes');
            expect(readNoteTags(h.contents.get(file)!).tags.length).toBe(choice === 'Yes' ? 1 : 3);
        }
    });

    it('asks once per multi-tag note when no default is saved', async () => {
        const h = harness();
        const files = ['one', 'two'].map(name => h.seedFile(`${name}.md`, '#work #home'));
        const pending = h.filer.enqueue(files, 'personal');
        await choose('No, just add the tag');
        await choose('Yes');
        await pending;
        expect(files.map(file => file.path)).toEqual(['one.md', 'personal/two.md']);
    });

    it('dismissal cancels the note without adding a tag or saving a checked default', async () => {
        const h = harness();
        const file = h.seedFile('note.md', '#work #home');
        const pending = h.filer.enqueue([file], 'personal');
        const dialog = await modal();
        const checkbox = dialog.contentEl.allElements().find(element => element.tagName === 'input')!;
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change'));
        dialog.close();
        await pending;
        expect(h.process).not.toHaveBeenCalled();
        expect(h.renameFile).not.toHaveBeenCalled();
        expect(h.save).not.toHaveBeenCalled();
        expect(h.selectTag).not.toHaveBeenCalled();
    });

    it('uses the explicit choice even if saving the preference fails', async () => {
        const h = harness();
        h.save.mockRejectedValueOnce(new Error('Settings read only'));
        const file = h.seedFile('note.md', '#work #home');
        const pending = h.filer.enqueue([file], 'personal');
        await choose('Yes', true);
        await pending;
        expect(file.path).toBe('personal/note.md');
        expect(h.notify).toHaveBeenCalledWith(expect.stringContaining('Could not save'));
    });

    it('keeps only the chosen tag even when the note is already in its target folder', async () => {
        const h = harness();
        const file = h.seedFile('personal/note.md', '#work #home');
        h.state.behavior = 'move';
        await h.filer.enqueue([file], 'personal');
        expect(readNoteTags(h.contents.get(file)!).tags).toEqual(['personal']);
        expect(h.renameFile).not.toHaveBeenCalled();
        expect(h.selectTag).toHaveBeenCalledWith('personal', expect.any(Function));
    });

    it('migrates saved defaults, preserves old settings and rejects unknown preference values', () => {
        for (const choice of ['ask', 'move', 'add']) expect(migrateSettings({ tagDropBehavior: choice }).tagDropBehavior).toBe(choice);
        expect(migrateSettings({ onboardingVersion: 2, autoMoveEnabled: true, tagDropEnabled: false }))
            .toMatchObject({ autoMoveEnabled: true, tagDropEnabled: false, tagDropBehavior: 'ask' });
        expect(migrateSettings({ tagDropBehavior: 'invalid' }).tagDropBehavior).toBe('ask');
    });
});

describe('tag-drop safety and races', () => {
    it('waits for the folder move to finish before selecting the destination tag', async () => {
        const h = harness();
        const file = h.seedFile('note.md', '#work');
        const rename = h.renameFile.getMockImplementation()!;
        let finishMove!: () => void;
        h.renameFile.mockImplementationOnce(async (file, destination) => {
            await new Promise<void>(resolve => { finishMove = resolve; });
            await rename(file, destination);
        });
        const pending = h.filer.enqueue([file], 'personal');
        await vi.waitFor(() => expect(h.renameFile).toHaveBeenCalledOnce(), { interval: 2 });
        expect(h.selectTag).not.toHaveBeenCalled();
        expect(file.path).toBe('note.md');
        finishMove();
        await pending;
        expect(file.path).toBe('personal/note.md');
        expect(h.selectTag).toHaveBeenCalledWith('personal', expect.any(Function));
    });

    it.each(['unavailable', 'throws'])('retains successful moves and continues the batch when tag navigation %s', async failure => {
        const h = harness();
        const files = ['one', 'two'].map(name => h.seedFile(`${name}.md`, '#work'));
        if (failure === 'unavailable') h.selectTag.mockResolvedValueOnce(false);
        else h.selectTag.mockRejectedValueOnce(new Error('Navigator closed'));
        await h.filer.enqueue(files, 'personal');
        expect(files.map(file => file.path)).toEqual(['personal/one.md', 'personal/two.md']);
        expect(h.selectTag).toHaveBeenCalledTimes(2);
        expect(h.notify).toHaveBeenCalledWith('one.md was filed, but Notebook Navigator could not select #personal.');
        expect(h.process).toHaveBeenCalledTimes(2); // Selection failure never rolls back the note.
    });

    it('does not change Navigator selection after cancellation during the final rename', async () => {
        const h = harness();
        const file = h.seedFile('note.md', '#work');
        const rename = h.renameFile.getMockImplementation()!;
        h.renameFile.mockImplementationOnce(async (file, destination) => {
            await rename(file, destination);
            h.filer.cancelPending();
        });
        await h.filer.enqueue([file], 'personal');
        expect(file.path).toBe('personal/note.md');
        expect(h.selectTag).not.toHaveBeenCalled();
    });

    it.each(['source', 'destination', 'collision', 'invalid path'])('keeps other tags and only adds the target for %s protection', async kind => {
        const h = harness();
        const file = h.seedFile('inbox/note.md', '#work');
        if (kind === 'source') h.state.exclusions = ['inbox'];
        if (kind === 'destination') h.state.exclusions = ['personal'];
        if (kind === 'collision') h.seedFile('personal/note.md', 'Do not overwrite');
        const tag = kind === 'invalid path' ? 'CON' : 'personal';
        await h.filer.enqueue([file], tag);
        expect(file.path).toBe('inbox/note.md');
        expect(readNoteTags(h.contents.get(file)!).tags).toEqual([tag, 'work']);
        expect(h.renameFile).not.toHaveBeenCalled();
        expect(h.createFolder).not.toHaveBeenCalled();
        expect(h.selectTag).not.toHaveBeenCalled();
    });

    it('skips malformed frontmatter without any edits', async () => {
        const h = harness();
        const file = h.seedFile('note.md', '---\ninvalid-yaml: [\n---\n#work');
        await h.filer.enqueue([file], 'personal');
        expect(h.process).not.toHaveBeenCalled();
        expect(h.renameFile).not.toHaveBeenCalled();
        expect(h.notify).toHaveBeenCalled();
    });

    it.each(['content', 'path', 'deletion', 'exclusion', 'collision'])('rechecks %s after prompting without overwriting changes', async change => {
        const h = harness();
        const file = h.seedFile('note.md', '#work #home');
        const pending = h.filer.enqueue([file], 'personal');
        await modal();
        if (change === 'content') h.contents.set(file, '#work #home\nNew edit');
        if (change === 'path') file.path = 'renamed.md';
        if (change === 'deletion') h.entries.delete(file.path);
        if (change === 'exclusion') h.state.exclusions = ['personal'];
        if (change === 'collision') h.seedFile('personal/note.md');
        await choose('Yes');
        await pending;
        expect(h.process).not.toHaveBeenCalled();
        expect(h.renameFile).not.toHaveBeenCalled();
        expect(h.contents.get(file)).toContain('#work #home');
    });

    it.each(['disable', 'unload'])('cancels a pending modal on %s and prevents late edits', async action => {
        const h = harness();
        const file = h.seedFile('note.md', '#work #home');
        const pending = h.filer.enqueue([file], 'personal');
        await modal();
        if (action === 'disable') { h.state.enabled = false; h.filer.cancelPending(); }
        else h.filer.dispose();
        await pending;
        expect(Modal.opened).toHaveLength(0);
        expect(h.process).not.toHaveBeenCalled();
        expect(h.filer.busy).toBe(false);
    });

    it('restores exact original content when the file move fails', async () => {
        const h = harness();
        const before = note({ tags: ['work'], title: 'Meeting' }, 'Text #work');
        const file = h.seedFile('note.md', before);
        h.renameFile.mockRejectedValueOnce(new Error('Read-only destination'));
        await h.filer.enqueue([file], 'personal');
        expect(file.path).toBe('note.md');
        expect(h.contents.get(file)).toBe(before);
        expect(h.notify).toHaveBeenCalledWith(expect.stringContaining('Original note content restored'));
        expect(h.selectTag).not.toHaveBeenCalled();
        expect(h.moveQueue.isChangingFilePaths()).toBe(false);
        expect(h.renameFile).toHaveBeenCalledOnce();
    });

    it('does not overwrite edits made after the tag rewrite when recovery is needed', async () => {
        const h = harness();
        const file = h.seedFile('note.md', '#work');
        h.renameFile.mockImplementationOnce(async () => {
            h.contents.set(file, h.contents.get(file)! + '\nExternal edit');
            throw new Error('Move failed');
        });
        await h.filer.enqueue([file], 'personal');
        expect(h.contents.get(file)).toContain('External edit');
        expect(h.notify).toHaveBeenCalledWith(expect.stringContaining('Could not restore the original tags'));
    });

    it('does not remove tags when folder creation fails', async () => {
        const h = harness();
        const file = h.seedFile('note.md', '#work');
        h.createFolder.mockRejectedValueOnce(new Error('Folder creation failed'));
        await h.filer.enqueue([file], 'personal');
        expect(h.contents.get(file)).toBe('#work');
        expect(h.process).not.toHaveBeenCalled();
    });

    it('compares contents inside the atomic write, catching an edit after the last read', async () => {
        const h = harness();
        const file = h.seedFile('note.md', '#work');
        const process = h.process.getMockImplementation()!;
        h.process.mockImplementationOnce(async (file, callback) => {
            h.contents.set(file, '#work\nLate edit');
            return process(file, callback);
        });
        await h.filer.enqueue([file], 'personal');
        expect(h.contents.get(file)).toBe('#work\nLate edit');
        expect(h.renameFile).not.toHaveBeenCalled();
    });

    it.each(['cancel', 'collision'])('restores original tags if %s occurs just after the rewrite', async reason => {
        const h = harness();
        const before = '#work';
        const file = h.seedFile('note.md', before);
        const process = h.process.getMockImplementation()!;
        h.process.mockImplementationOnce(async (file, callback) => {
            const result = await process(file, callback);
            if (reason === 'cancel') h.filer.cancelPending();
            else h.seedFile('personal/note.md', 'Other note');
            return result;
        });
        await h.filer.enqueue([file], 'personal');
        expect(h.contents.get(file)).toBe(before);
        expect(file.path).toBe('note.md');
        expect(h.renameFile).not.toHaveBeenCalled();
    });

    it('serializes overlapping drops and does not apply a stale second request to the same note', async () => {
        const h = harness();
        const file = h.seedFile('note.md', '#work #home');
        const first = h.filer.enqueue([file], 'personal');
        await modal();
        const second = h.filer.enqueue([file], 'travel');
        await choose('Yes');
        await Promise.all([first, second]);
        expect(file.path).toBe('personal/note.md');
        expect(h.renameFile).toHaveBeenCalledOnce();
        expect(readNoteTags(h.contents.get(file)!).tags).toEqual(['personal']);
    });
});
