import { describe, expect, it, vi } from 'vitest';
import { FolderMover } from '../src/folderPlacement';
import { executeMoves, initialMoveResults, scanSingleTagNotes } from '../src/organizer/singleTagOrganizer';
import { note, vaultHarness } from './helpers/vault';

const options = { shouldCancel: () => false };
describe('manual single-tag organizer', () => {
    it('previews all Markdown notes, counting both tag locations and ignoring multiple distinct tags', async () => {
        const h = vaultHarness();
        h.seedFile('root.md', '#work #WORK');
        h.seedFile('Inbox/fm.md', note({ Tags: ['work/meetings'] }, '#work/meetings'));
        h.seedFile('Inbox/multiple.md', note({ tags: ['work'] }, '#home'));
        h.seedFile('Inbox/parent.md', '#work #work/meetings');
        h.seedFile('empty.md', 'text');
        h.seedFile('work/done.md', '#work');
        h.seedFile('note.canvas', '#work');
        const previews = await scanSingleTagNotes(h.app, [], options);
        expect(previews).toHaveLength(6);
        expect(previews.filter(row => row.status === 'ready').map(row => row.source)).toEqual(['root.md', 'Inbox/fm.md']);
        expect(previews.find(row => row.source === 'Inbox/multiple.md')?.reason).toBe('Multiple tags');
        expect(previews.find(row => row.source === 'work/done.md')?.reason).toBe('Already in matching folder');
        expect(h.createFolder).not.toHaveBeenCalled();
        expect(h.renameFile).not.toHaveBeenCalled();
        expect(h.write).not.toHaveBeenCalled();
    });

    it('skips excluded sources and destinations, malformed notes, and existing collisions', async () => {
        const h = vaultHarness();
        h.seedFile('Archive/note.md', '#work');
        h.seedFile('root.md', '#Archive/old');
        h.seedFile('bad.md', note({ tags: ['work', 2] }));
        h.seedFile('duplicate.md', '#work');
        h.seedFile('work/duplicate.md', '#home');
        const rows = await scanSingleTagNotes(h.app, ['Archive'], options);
        expect(rows.slice(0, 4).every(row => row.status === 'skipped')).toBe(true);
        expect(rows[0].reason).toBe('Excluded folder');
        expect(rows[1].reason).toContain('Destination folder');
        expect(rows[2].reason).toContain('non-text');
        expect(rows[3].reason).toContain('Destination already exists');
    });

    it('marks every candidate in a planned filename collision as skipped', async () => {
        const h = vaultHarness();
        h.seedFile('Inbox/note.md', '#work');
        h.seedFile('Archive/NOTE.md', '#WORK');
        const rows = await scanSingleTagNotes(h.app, [], options);
        expect(rows.every(row => row.status === 'skipped' && row.reason?.includes('same destination'))).toBe(true);
        expect(h.entries.has('work')).toBe(false);
    });

    it('moves eligible notes without tag changes, then skips them on a second run', async () => {
        const h = vaultHarness();
        const file = h.seedFile('root.md', note({ tags: ['work'] }, 'Body #WORK'));
        const previews = await scanSingleTagNotes(h.app, [], options);
        const results = initialMoveResults(previews);
        const states: string[][] = [];
        const checkpoint = vi.fn(async () => { states.push(results.map(row => row.status)); });
        await executeMoves(h.app, new FolderMover(h.app), previews, results, () => [], options, checkpoint);
        expect(states).toEqual([['pending'], ['moving'], ['moved']]);
        expect(file.path).toBe('work/root.md');
        expect(h.contents.get(file)).toBe(note({ tags: ['work'] }, 'Body #WORK'));
        expect(h.processFrontMatter).not.toHaveBeenCalled();
        expect((await scanSingleTagNotes(h.app, [], options))[0].reason).toBe('Already in matching folder');
    });

    it('uses one planned spelling for missing shared folders despite tag case differences', async () => {
        const h = vaultHarness();
        const first = h.seedFile('one.md', '#work/meetings');
        const second = h.seedFile('two.md', '#WORK/Meetings');
        const third = h.seedFile('three.md', '#WORK/home');
        const previews = await scanSingleTagNotes(h.app, [], options);
        expect(previews.map(row => row.destination)).toEqual(['work/meetings/one.md', 'work/meetings/two.md', 'work/home/three.md']);
        // Even if the first note is edited and skipped, the others keep the previewed spelling.
        h.contents.set(first, '#work/meetings #other');
        const results = initialMoveResults(previews);
        await executeMoves(h.app, new FolderMover(h.app), previews, results, () => [], options, async () => {});
        expect(results.map(row => row.status)).toEqual(['skipped', 'moved', 'moved']);
        expect(second.path).toBe('work/meetings/two.md');
        expect(third.path).toBe('work/home/three.md');
    });

    it.each(['add-tag', 'edit-body', 'delete', 'rename', 'exclude-source', 'exclude-target', 'new-collision'])
    ('revalidates the confirmed preview when the vault changes: %s', async change => {
        const h = vaultHarness();
        const file = h.seedFile('Inbox/note.md', '#work');
        const previews = await scanSingleTagNotes(h.app, [], options);
        let exclusions: string[] = [];
        if (change === 'add-tag') h.contents.set(file, '#work #home');
        if (change === 'edit-body') h.contents.set(file, '#work edited body');
        if (change === 'delete') h.entries.delete(file.path);
        if (change === 'rename') file.path = 'Inbox/renamed.md';
        if (change === 'exclude-source') exclusions = ['Inbox'];
        if (change === 'exclude-target') exclusions = ['work'];
        if (change === 'new-collision') h.seedFile('work/note.md', 'existing');
        const results = initialMoveResults(previews);
        await executeMoves(h.app, new FolderMover(h.app), previews, results, () => exclusions, options, async () => {});
        expect(results[0].status).not.toBe('moved');
        expect(h.renameFile).not.toHaveBeenCalled();
        expect(h.createFolder).not.toHaveBeenCalled();
    });

    it('makes no moves or folders if the initial log cannot be saved', async () => {
        const h = vaultHarness();
        h.seedFile('note.md', '#work');
        const previews = await scanSingleTagNotes(h.app, [], options);
        await expect(executeMoves(h.app, new FolderMover(h.app), previews, initialMoveResults(previews), () => [], options,
            async () => { throw new Error('Log unavailable'); })).rejects.toThrow('Log unavailable');
        expect(h.renameFile).not.toHaveBeenCalled();
        expect(h.createFolder).not.toHaveBeenCalled();
    });

    it('stops further moves when saving a completed move fails', async () => {
        const h = vaultHarness();
        h.seedFile('one.md', '#work');
        h.seedFile('two.md', '#home');
        const previews = await scanSingleTagNotes(h.app, [], options);
        const results = initialMoveResults(previews);
        const checkpoint = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Disk full'));
        await expect(executeMoves(h.app, new FolderMover(h.app), previews, results, () => [], options, checkpoint)).rejects.toThrow('Disk full');
        expect(h.renameFile).toHaveBeenCalledTimes(1);
        expect(results.map(row => row.status)).toEqual(['moved', 'pending']);
    });

    it('keeps completed moves and leaves the rest pending when cancelled', async () => {
        const h = vaultHarness();
        h.seedFile('one.md', '#work');
        h.seedFile('two.md', '#home');
        const previews = await scanSingleTagNotes(h.app, [], options);
        const results = initialMoveResults(previews);
        let cancelled = false;
        await executeMoves(h.app, new FolderMover(h.app), previews, results, () => [], {
            shouldCancel: () => cancelled, onProgress: () => { cancelled = true; }
        }, async () => {});
        expect(results.map(row => row.status)).toEqual(['moved', 'pending']);
        expect(h.renameFile).toHaveBeenCalledTimes(1);
    });

    it('continues after an individual file failure', async () => {
        const h = vaultHarness();
        h.seedFile('one.md', '#work');
        h.seedFile('two.md', '#home');
        const previews = await scanSingleTagNotes(h.app, [], options);
        const results = initialMoveResults(previews);
        h.renameFile.mockRejectedValueOnce(new Error('File locked'));
        await executeMoves(h.app, new FolderMover(h.app), previews, results, () => [], options, async () => {});
        expect(results.map(row => row.status)).toEqual(['failed', 'moved']);
    });

    it('cancels a scan before reading more files and performs no mutations', async () => {
        const h = vaultHarness();
        h.seedFile('one.md', '#work');
        h.seedFile('two.md', '#home');
        let cancelled = false;
        const rows = await scanSingleTagNotes(h.app, [], {
            shouldCancel: () => cancelled, onProgress: () => { cancelled = true; }
        });
        expect(rows).toHaveLength(1);
        expect(h.read).toHaveBeenCalledTimes(1);
        expect(h.renameFile).not.toHaveBeenCalled();
    });
});
