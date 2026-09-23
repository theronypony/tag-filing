import { describe, expect, it, vi } from 'vitest';
import { AutoMover, selectedNavigatorTag } from '../src/autoMover';
import { FolderMover } from '../src/folderPlacement';
import { NotebookNavigatorAPI, NavItem } from '../src/nnApi';
import { note, vaultHarness } from './helpers/vault';

function setup() {
    vi.useFakeTimers();
    const h = vaultHarness();
    let enabled = true;
    let exclusions: string[] = [];
    let item = { type: 'tag', tag: 'work/meetings', folder: null, property: null } as NavItem;
    const api: NotebookNavigatorAPI = { getVersion: () => '2.0.0', selection: { getNavItem: () => item },
        tagCollections: { isCollection: tag => tag === 'virtual-collection' } };
    const report = vi.fn();
    const mover = new AutoMover(h.app, new FolderMover(h.app), () => api, () => enabled, () => exclusions, report);
    return { ...h, mover, report, api, setItem: (value: NavItem) => { item = value; },
        setEnabled: (value: boolean) => { enabled = value; }, setExclusions: (value: string[]) => { exclusions = value; } };
}

describe('automatic NN folder filing', () => {
    it('waits for NN to add its tag and open the note, then files it without writing tags', async () => {
        const h = setup();
        const file = h.seedFile('Untitled.md');
        h.mover.handleCreate(file);
        h.contents.set(file, note({ Tags: ['work/meetings', 'template-tag'] }));
        h.mover.handleOpen(file);
        await vi.advanceTimersByTimeAsync(250);
        expect(file.path).toBe('work/meetings/Untitled.md');
        expect(h.processFrontMatter).not.toHaveBeenCalled();
        expect(h.contents.get(file)).toBe(note({ Tags: ['work/meetings', 'template-tag'] }));
        h.mover.handleOpen(file);
        await vi.advanceTimersByTimeAsync(500);
        expect(h.renameFile).toHaveBeenCalledTimes(1);
    });

    it('uses the tag captured at creation even if the user changes selection before the move', async () => {
        const h = setup();
        const file = h.seedFile('note.md', note({ tags: 'work/meetings' }));
        h.mover.handleCreate(file);
        h.setItem({ type: 'tag', tag: 'home', folder: null, property: null });
        h.mover.handleOpen(file);
        await vi.advanceTimersByTimeAsync(250);
        expect(file.path).toBe('work/meetings/note.md');
    });

    it.each(['background-sync', 'old-created-file', 'expired', 'disabled', 'disposed', 'source-excluded', 'target-excluded', 'standard-command', 'inline-only', 'tag-removed'])
    ('does not automatically move ineligible notes: %s', async scenario => {
        const h = setup();
        const file = h.seedFile('Inbox/note.md', note({ tags: 'work/meetings' }), scenario === 'old-created-file' ? Date.now() - 60_000 : Date.now());
        if (scenario === 'source-excluded') h.setExclusions(['Inbox']);
        if (scenario === 'target-excluded') h.setExclusions(['work']);
        if (scenario === 'standard-command') h.contents.set(file, '');
        if (scenario === 'inline-only') h.contents.set(file, '#work/meetings');
        h.mover.handleCreate(file);
        if (scenario === 'expired') await vi.advanceTimersByTimeAsync(31_000);
        if (scenario !== 'background-sync') h.mover.handleOpen(file);
        if (scenario === 'disabled') h.setEnabled(false);
        if (scenario === 'disposed') h.mover.dispose();
        if (scenario === 'tag-removed') h.contents.set(file, note({ tags: ['home'] }));
        await vi.advanceTimersByTimeAsync(500);
        expect(h.renameFile).not.toHaveBeenCalled();
        expect(h.createFolder).not.toHaveBeenCalled();
        expect(h.processFrontMatter).not.toHaveBeenCalled();
    });

    it('reports a conflict and retains the new note in its original location', async () => {
        const h = setup();
        const file = h.seedFile('note.md', note({ tags: ['work/meetings'] }));
        h.seedFile('work/meetings/NOTE.md', 'original');
        h.mover.handleCreate(file);
        h.mover.handleOpen(file);
        await vi.advanceTimersByTimeAsync(250);
        expect(file.path).toBe('note.md');
        expect(h.report).toHaveBeenCalledWith(expect.stringContaining('Destination already exists'));
    });

    it('clears queued creation work when a manual operation starts', async () => {
        const h = setup();
        const file = h.seedFile('note.md', note({ tags: 'work/meetings' }));
        h.mover.handleCreate(file);
        h.mover.handleOpen(file);
        h.mover.clearPending();
        await vi.advanceTimersByTimeAsync(250);
        expect(h.renameFile).not.toHaveBeenCalled();
    });

    it('never uses a previous tag for a folder, property, aggregate, or no selection', () => {
        const h = setup();
        expect(selectedNavigatorTag(h.api)).toBe('work/meetings');
        const selections: NavItem[] = [
            { type: 'folder', folder: h.seedFolder('Home'), tag: null, property: null },
            { type: 'property', property: 'status:open', tag: null, folder: null },
            { type: 'none', property: null, tag: null, folder: null },
            ...['__tagged__', '__untagged__', 'virtual-collection'].map(tag => ({ type: 'tag' as const, tag, folder: null, property: null }))
        ];
        for (const item of selections) {
            h.setItem(item);
            expect(selectedNavigatorTag(h.api)).toBeNull();
        }
    });

    it('fails closed for unavailable, unsupported or throwing Navigator APIs', () => {
        expect(selectedNavigatorTag(null)).toBeNull();
        expect(selectedNavigatorTag({ getVersion: () => '3.0.0' })).toBeNull();
        expect(selectedNavigatorTag({ getVersion: () => { throw new Error('Loading'); } })).toBeNull();
    });
});
