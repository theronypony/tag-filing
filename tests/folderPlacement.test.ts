import { describe, expect, it, vi } from 'vitest';
import { FolderMover, isExcludedPath, resolvePlacement } from '../src/folderPlacement';
import { vaultHarness } from './helpers/vault';

describe('tag paths and exclusions', () => {
    it('maps a full nested tag from the root and reuses existing case', () => {
        const h = vaultHarness();
        h.seedFolder('Work');
        const file = h.seedFile('Inbox/note.md');
        expect(resolvePlacement(h.app, file, '#work/meetings', [])).toEqual({
            destination: 'Work/meetings/note.md', missingFolders: ['Work/meetings']
        });
        expect(h.createFolder).not.toHaveBeenCalled();
    });

    it('plans missing parents without creating them', () => {
        const h = vaultHarness();
        const file = h.seedFile('root.md');
        expect(resolvePlacement(h.app, file, 'work/meetings', [])).toEqual({
            destination: 'work/meetings/root.md', missingFolders: ['work', 'work/meetings']
        });
        expect(h.entries.size).toBe(2);
    });

    it('compares exact folders and supports Unicode-normalized names', () => {
        const h = vaultHarness();
        const file = h.seedFile('Cafe\u0301/archive/note.md');
        expect(resolvePlacement(h.app, file, 'CAFÉ', []).destination).toBe('Cafe\u0301/note.md');
        expect(resolvePlacement(h.app, file, 'café/archive', []).destination).toBe(file.path);
    });

    it('applies exclusion boundaries to both source and destination', () => {
        const h = vaultHarness();
        const file = h.seedFile('Archive/old/note.md');
        expect(isExcludedPath(file.path, ['arch'])).toBe(false);
        expect(isExcludedPath(file.path, [' /ARCHIVE/ '])).toBe(true);
        expect(() => resolvePlacement(h.app, file, 'work', ['Archive'])).toThrow('Source folder');
        expect(() => resolvePlacement(h.app, file, 'work/meetings', ['work'])).toThrow('Destination folder');
        expect(h.createFolder).not.toHaveBeenCalled();
    });

    it('does not write to the vault configuration folder', () => {
        const h = vaultHarness();
        h.app.vault.configDir = 'config';
        expect(() => resolvePlacement(h.app, h.seedFile('note.md'), 'config/private', [])).toThrow('excluded');
    });

    it.each(['../work', 'work/../meetings', '/work', 'work/', 'work//meetings', 'work:meetings', 'CON', 'work/Lpt1', 'work.', 'work\\meetings'])
    ('rejects invalid or nonportable folder tags: %s', tag => {
        const h = vaultHarness();
        expect(() => resolvePlacement(h.app, h.seedFile('note.md'), tag, [])).toThrow();
    });

    it('refuses ambiguous folder capitalization and files occupying a folder', () => {
        const h = vaultHarness();
        const file = h.seedFile('note.md');
        h.seedFolder('Work');
        h.seedFolder('work');
        expect(() => resolvePlacement(h.app, file, 'work', [])).toThrow('Ambiguous');
        h.seedFile('home');
        expect(() => resolvePlacement(h.app, file, 'home/projects', [])).toThrow('file occupies');
    });

    it('detects case-insensitive destination filename conflicts', () => {
        const h = vaultHarness();
        const file = h.seedFile('note.md');
        h.seedFile('Work/NOTE.md');
        expect(() => resolvePlacement(h.app, file, 'work', [])).toThrow('Destination already exists');
    });
});

describe('checked folder moves', () => {
    function setup() {
        const h = vaultHarness();
        const file = h.seedFile('Inbox/note.md', 'unchanged #work/meetings');
        const request = {
            file, source: file.path, tag: 'work/meetings', destination: 'work/meetings/note.md',
            exclusions: () => [] as string[], shouldCancel: () => false, isCurrent: vi.fn(async () => true)
        };
        return { ...h, file, request, mover: new FolderMover(h.app) };
    }

    it('creates missing folders, preserves the filename and does not rewrite tags or content', async () => {
        const h = setup();
        expect(await h.mover.move(h.request)).toEqual({ status: 'moved' });
        expect(h.createFolder.mock.calls.map(call => call[0])).toEqual(['work', 'work/meetings']);
        expect(h.file.path).toBe('work/meetings/note.md');
        expect(h.contents.get(h.file)).toBe('unchanged #work/meetings');
        expect(h.processFrontMatter).not.toHaveBeenCalled();
        expect(h.entries.has('Inbox')).toBe(true);
    });

    it('cancels without creating folders when a read completes after cancellation', async () => {
        const h = setup();
        let cancelled = false;
        h.request.shouldCancel = () => cancelled;
        h.request.isCurrent.mockImplementation(async () => { cancelled = true; return true; });
        expect((await h.mover.move(h.request)).status).toBe('skipped');
        expect(h.createFolder).not.toHaveBeenCalled();
        expect(h.renameFile).not.toHaveBeenCalled();
    });

    it('cancels before moving when cancelled during the final content check', async () => {
        const h = setup();
        let cancelled = false;
        h.request.shouldCancel = () => cancelled;
        h.request.isCurrent.mockResolvedValueOnce(true).mockImplementationOnce(async () => { cancelled = true; return true; });
        expect((await h.mover.move(h.request)).status).toBe('skipped');
        expect(h.renameFile).not.toHaveBeenCalled();
    });

    it('retains completed folder creation but stops before further folders or moves', async () => {
        const h = setup();
        let cancelled = false;
        h.request.shouldCancel = () => cancelled;
        h.createFolder.mockImplementationOnce(async path => { cancelled = true; return h.seedFolder(path); });
        expect((await h.mover.move(h.request)).status).toBe('skipped');
        expect(h.entries.has('work')).toBe(true);
        expect(h.entries.has('work/meetings')).toBe(false);
        expect(h.renameFile).not.toHaveBeenCalled();
    });

    it('does not move a renamed or deleted candidate', async () => {
        const h = setup();
        h.entries.delete(h.file.path);
        expect((await h.mover.move(h.request)).status).toBe('skipped');
        expect(h.createFolder).not.toHaveBeenCalled();
        expect(h.renameFile).not.toHaveBeenCalled();
    });

    it('rechecks exclusions and a new destination conflict after folder creation', async () => {
        const h = setup();
        h.request.isCurrent.mockResolvedValueOnce(true).mockImplementationOnce(async () => {
            h.seedFile('work/meetings/note.md', 'existing');
            return true;
        });
        expect((await h.mover.move(h.request)).status).toBe('failed');
        expect(h.file.path).toBe('Inbox/note.md');
        expect(h.renameFile).not.toHaveBeenCalled();
    });

    it('accepts folders created concurrently and serializes conflicting moves', async () => {
        const h = setup();
        h.createFolder.mockImplementationOnce(async path => { h.seedFolder(path); throw new Error('Already exists'); });
        const other = h.seedFile('Elsewhere/note.md');
        const [first, second] = await Promise.all([
            h.mover.move(h.request), h.mover.move({ ...h.request, file: other, source: other.path })
        ]);
        expect(first.status).toBe('moved');
        expect(second.status).toBe('failed');
        expect(h.renameFile).toHaveBeenCalledTimes(1);
        expect(other.path).toBe('Elsewhere/note.md');
    });

    it('reports a move failure and permits later independent moves', async () => {
        const h = setup();
        h.renameFile.mockRejectedValueOnce(new Error('Disk is read-only'));
        expect(await h.mover.move(h.request)).toEqual({ status: 'failed', reason: 'Disk is read-only' });
        expect((await h.mover.move(h.request)).status).toBe('moved');
    });
});
