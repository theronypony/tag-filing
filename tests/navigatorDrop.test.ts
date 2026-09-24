import { afterEach, describe, expect, it, vi } from 'vitest';
import TagFilingPlugin from '../src/main';
import { NavigatorDropListener, readNavigatorNoteDrop } from '../src/tagDrop/navigatorDrop';
import { NotebookNavigatorAPI } from '../src/nnApi';
import { TagFilingSettingTab, DEFAULT_SETTINGS } from '../src/settings';
import { readNoteTags } from '../src/organizer/noteTags';
import { Modal, Plugin, TestElement } from './stubs/obsidian';
import { vaultHarness } from './helpers/vault';

const api: NotebookNavigatorAPI = {
    getVersion: () => '2.0.0',
    tagCollections: { isCollection: tag => tag === '__tagged__' || tag === '__untagged__' }
};

function dropEvent(payload: Record<string, string> = { 'obsidian/file': 'note.md' }) {
    const pane = new TestElement();
    pane.attributes['data-type'] = 'notebook-navigator';
    const zone = pane.createDiv();
    zone.attributes = { 'data-drop-zone': 'tag', 'data-drop-path': 'personal', 'data-tag': 'personal' };
    const label = zone.createEl('span');
    const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperties(event, {
        target: { value: label },
        dataTransfer: { value: { types: Object.keys(payload), getData: (type: string) => payload[type] ?? '' } }
    });
    return { event, pane, zone };
}

const uri = (path: string, vault = 'Test vault') => `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(path)}`;

describe('Navigator drop recognition', () => {
    it('uses the dropped-on tag, independent of the selected tag, and resolves the exact local file', () => {
        const h = vaultHarness();
        const file = h.seedFile('note.md');
        const { event, zone } = dropEvent();
        zone.attributes['data-drop-path'] = 'Personal/Meetings';
        expect(readNavigatorNoteDrop(h.app, api, event)).toEqual({ files: [file], tag: 'Personal/Meetings' });
    });

    it('prefers the full custom multi-note payload over a truncated macOS URI list', () => {
        const h = vaultHarness();
        const files = ['one.md', 'two.md'].map(path => h.seedFile(path));
        const { event } = dropEvent({ 'obsidian/files': JSON.stringify(['one.md', 'two.md', 'one.md']), 'text/uri-list': uri('one') });
        expect(readNavigatorNoteDrop(h.app, api, event)?.files).toEqual(files);
    });

    it.each(['\n', ''])('supports same-vault Obsidian URI payloads with separator %j', separator => {
        const h = vaultHarness();
        const files = ['one note.md', 'two.md'].map(path => h.seedFile(path));
        const { event } = dropEvent({ 'text/plain': [uri('one note'), uri('two')].join(separator) });
        expect(readNavigatorNoteDrop(h.app, api, event)?.files).toEqual(files);
    });

    it('resolves a URI note sharing a basename with a folder, without claiming actual folder drags', () => {
        const h = vaultHarness();
        const file = h.seedFile('note.md');
        h.seedFolder('note');
        const event = dropEvent({ 'text/plain': uri('note') }).event;
        expect(readNavigatorNoteDrop(h.app, api, event)?.files).toEqual([file]);
        expect(readNavigatorNoteDrop(h.app, api, dropEvent({ 'obsidian/file': 'note' }).event)).toBeNull();
    });

    it('checks the URI-list vault even when text/plain contains an unrelated display label', () => {
        const h = vaultHarness();
        const file = h.seedFile('note.md');
        const payload = { 'text/plain': 'Note title', 'text/uri-list': uri('note') };
        expect(readNavigatorNoteDrop(h.app, api, dropEvent(payload).event)?.files).toEqual([file]);
        payload['text/uri-list'] = uri('note', 'Other vault');
        expect(readNavigatorNoteDrop(h.app, api, dropEvent({ ...payload, 'obsidian/file': 'note.md' }).event)).toBeNull();
    });

    it.each(['outside NN', 'folder target', 'denied', 'collection path', 'collection canonical', 'invalid tag', 'prevented'])
    ('passes through %s drops without claiming them', kind => {
        const h = vaultHarness();
        h.seedFile('note.md');
        const { event, zone, pane } = dropEvent();
        if (kind === 'outside NN') pane.attributes['data-type'] = 'file-explorer';
        if (kind === 'folder target') zone.attributes['data-drop-zone'] = 'folder';
        if (kind === 'denied') zone.attributes['data-allow-internal-drop'] = 'false';
        if (kind === 'collection path') zone.attributes['data-drop-path'] = '__untagged__';
        if (kind === 'collection canonical') zone.attributes['data-tag'] = '__tagged__';
        if (kind === 'invalid tag') zone.attributes['data-drop-path'] = 'bad//tag';
        if (kind === 'prevented') event.preventDefault();
        expect(readNavigatorNoteDrop(h.app, api, event)).toBeNull();
    });

    it.each([
        { 'application/x-notebook-navigator-tag': '{}', 'obsidian/file': 'note.md' },
        { 'application/x-notebook-navigator-property': '{}', 'obsidian/file': 'note.md' },
        { 'application/x-notebook-shortcut': '{}', 'obsidian/file': 'note.md' },
        { 'obsidian/file': 'folder' },
        { 'obsidian/file': 'missing.md' },
        { 'obsidian/files': '["note.md", "image.png"]' },
        { 'obsidian/files': '["note.md", 12]' },
        { 'obsidian/files': 'not json' },
        { Files: '' },
        { 'text/plain': 'note.md' },
        { 'text/plain': uri('note', 'Other vault') },
        { 'obsidian/file': 'note.md', 'text/plain': uri('note', 'Other vault') }
    ])('passes through unsupported or unsafe payload %j', payload => {
        const h = vaultHarness();
        h.seedFile('note.md');
        h.seedFile('image.png');
        h.seedFolder('folder');
        expect(readNavigatorNoteDrop(h.app, api, dropEvent(payload).event)).toBeNull();
    });

    it('requires the supported API and collection guard', () => {
        const h = vaultHarness();
        h.seedFile('note.md');
        for (const unsupported of [null, {}, { ...api, getVersion: () => '1.0.0' }]) {
            expect(readNavigatorNoteDrop(h.app, unsupported, dropEvent().event)).toBeNull();
        }
    });

    it('intercepts once, allows ordinary drag cleanup, and detaches listeners', () => {
        const h = vaultHarness();
        h.seedFile('note.md');
        const doc = new EventTarget() as unknown as Document;
        const receive = vi.fn();
        const listener = new NavigatorDropListener(h.app, () => api, () => true, receive);
        listener.attach(doc);
        listener.attach(doc);
        const nativeDrop = vi.fn();
        const dragEnd = vi.fn();
        doc.addEventListener('drop', nativeDrop);
        doc.addEventListener('dragend', dragEnd);
        const { event } = dropEvent();
        doc.dispatchEvent(event);
        doc.dispatchEvent(new Event('dragend'));
        expect(event.defaultPrevented).toBe(true);
        expect(receive).toHaveBeenCalledOnce();
        expect(nativeDrop).not.toHaveBeenCalled();
        expect(dragEnd).toHaveBeenCalledOnce();
        listener.dispose();
        doc.dispatchEvent(dropEvent().event);
        expect(receive).toHaveBeenCalledOnce();
        expect(nativeDrop).toHaveBeenCalledOnce();
    });

    it('leaves NN in charge when disabled or when the drop targets a folder', () => {
        const h = vaultHarness();
        h.seedFile('note.md');
        for (const enabled of [false, true]) {
            const doc = new EventTarget() as unknown as Document;
            const receive = vi.fn();
            const listener = new NavigatorDropListener(h.app, () => api, () => enabled, receive);
            listener.attach(doc);
            const { event, zone } = dropEvent();
            if (enabled) zone.attributes['data-drop-zone'] = 'folder';
            doc.dispatchEvent(event);
            expect(event.defaultPrevented).toBe(false);
            expect(receive).not.toHaveBeenCalled();
            listener.dispose();
        }
    });
});

describe('plugin integration and preferences', () => {
    const cleanups: (() => void)[] = [];
    afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); });

    async function pluginHarness() {
        const h = vaultHarness();
        const navigateToTag = vi.fn(async (_tag: string) => true);
        (h.app as any).plugins.plugins['notebook-navigator'] = { api: { ...api, navigation: { navigateToTag } } };
        const plugin = new TagFilingPlugin(h.app, { id: 'inherit-tags', name: 'Tag Filing', version: '2.1.0', minAppVersion: '1.11.0', author: 'test' });
        const testPlugin = plugin as unknown as Plugin;
        testPlugin.storedData = { ...DEFAULT_SETTINGS, onboardingVersion: 2 };
        await plugin.onload();
        h.layoutReady();
        const doc = new EventTarget() as unknown as Document;
        h.workspaceEvent('window-open', {}, { document: doc });
        cleanups.push(() => { plugin.onunload(); testPlugin.intervals.forEach(id => clearInterval(id)); });
        return { ...h, plugin, testPlugin, doc, navigateToTag };
    }

    it('files an actual routed drop without enabling new-note filing, and detaches on window close', async () => {
        const h = await pluginHarness();
        const file = h.seedFile('note.md', '#work');
        h.doc.dispatchEvent(dropEvent().event);
        await vi.waitFor(() => expect(file.path).toBe('personal/note.md'), { interval: 2 });
        expect(readNoteTags(h.contents.get(file)!).tags).toEqual(['personal']);
        expect(h.plugin.settings.autoMoveEnabled).toBe(false);
        await vi.waitFor(() => expect(h.navigateToTag).toHaveBeenCalledWith('personal'), { interval: 2 });
        h.workspaceEvent('window-close', {}, { document: h.doc });
        const event = dropEvent({ 'obsidian/file': file.path }).event;
        h.doc.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
    });

    it('persists a checkbox choice and blocks manual tools while a drop dialog is open', async () => {
        const h = await pluginHarness();
        const file = h.seedFile('note.md', '#work #home');
        h.doc.dispatchEvent(dropEvent().event);
        await vi.waitFor(() => expect(Modal.opened).toHaveLength(1), { interval: 2 });
        h.plugin.runOrganizer();
        h.plugin.runConverter();
        expect(Modal.opened).toHaveLength(1);
        const checkbox = Modal.opened[0].contentEl.allElements().find(element => element.tagName === 'input')!;
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change'));
        await Modal.opened[0].contentEl.allButtons().find(button => button.text === 'No, just add the tag')!.click();
        await vi.waitFor(() => expect(h.testPlugin.storedData).toMatchObject({ tagDropBehavior: 'add' }), { interval: 2 });
        await vi.waitFor(() => expect(h.process).toHaveBeenCalledOnce(), { interval: 2 });
        expect(file.path).toBe('note.md');
        await h.plugin.loadSettings();
        expect(h.plugin.settings.tagDropBehavior).toBe('add');
    });

    it('lets settings change or reset the default and disable a pending drop', async () => {
        const h = await pluginHarness();
        const previous = (globalThis as any).createFragment;
        (globalThis as any).createFragment = (callback: (fragment: TestElement) => void) => {
            const fragment = new TestElement(); callback(fragment); return fragment;
        };
        cleanups.push(() => { (globalThis as any).createFragment = previous; });
        const tab = new TagFilingSettingTab(h.app, h.plugin);
        tab.display();
        const root = tab.containerEl as unknown as TestElement;
        const dropdown = root.allControls().find(control => control.options.ask)!;
        for (const value of ['move', 'add', 'ask']) {
            await dropdown.change(value);
            expect(h.testPlugin.storedData).toMatchObject({ tagDropBehavior: value });
        }
        h.seedFile('note.md', '#work #home');
        h.doc.dispatchEvent(dropEvent().event);
        await vi.waitFor(() => expect(Modal.opened).toHaveLength(1), { interval: 2 });
        const setting = root.children.find(element => element.allText().includes('File notes dropped on Navigator tags'))!;
        await setting.allControls()[0].change(false);
        expect(Modal.opened).toHaveLength(0);
        expect(h.process).not.toHaveBeenCalled();
        const next = dropEvent().event;
        h.doc.dispatchEvent(next);
        expect(next.defaultPrevented).toBe(false);
    });
});
