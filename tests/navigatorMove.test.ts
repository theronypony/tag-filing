import { describe, expect, it, vi } from 'vitest';
import { moveFileWithNotebookNavigator } from '../src/nnApi';
import { navigatorMoveQueue } from './helpers/navigator';
import { vaultHarness } from './helpers/vault';

function harness() {
    const h = vaultHarness();
    const file = h.seedFile('work/note.md');
    const folder = h.seedFolder('personal/meetings');
    const destination = `${folder.path}/${file.name}`;
    const queue = navigatorMoveQueue();
    const plugins = (h.app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins.plugins;
    const plugin = { api: { getVersion: () => '2.0.0' }, commandQueue: queue };
    plugins['notebook-navigator'] = plugin;
    return { ...h, file, folder, destination, queue, plugin, plugins };
}

describe('Navigator move context', () => {
    it('keeps context active until the native rename finishes, then releases it', async () => {
        const h = harness();
        const rename = h.renameFile.getMockImplementation()!;
        let finish!: () => void;
        h.renameFile.mockImplementationOnce(async (file, destination) => {
            expect(h.queue.isChangingFilePaths()).toBe(true);
            await new Promise<void>(resolve => { finish = resolve; });
            await rename(file, destination);
        });
        const pending = moveFileWithNotebookNavigator(h.app, h.file, h.destination);
        expect(h.queue.executeMoveFiles).toHaveBeenCalledWith([h.file], h.folder, expect.any(Function));
        expect(h.queue.isChangingFilePaths()).toBe(true);
        finish();
        await pending;
        expect(h.file.path).toBe(h.destination);
        expect(h.renameFile).toHaveBeenCalledOnce();
        expect(h.queue.isChangingFilePaths()).toBe(false);
    });

    it.each(['rejection', 'synchronous throw'])('propagates a rename %s without retrying, and releases move context', async failure => {
        const h = harness();
        const error = new Error('Read-only destination');
        if (failure === 'rejection') h.renameFile.mockRejectedValueOnce(error);
        else h.renameFile.mockImplementationOnce(() => { throw error; });
        await expect(moveFileWithNotebookNavigator(h.app, h.file, h.destination)).rejects.toBe(error);
        expect(h.file.path).toBe('work/note.md');
        expect(h.renameFile).toHaveBeenCalledOnce();
        expect(h.queue.isChangingFilePaths()).toBe(false);
    });

    it.each(['disabled', 'unsupported API', 'missing queue', 'missing execute', 'missing context check'])
    ('falls back to one normal rename when Navigator has %s', async state => {
        const h = harness();
        if (state === 'disabled') delete h.plugins['notebook-navigator'];
        if (state === 'unsupported API') h.plugin.api.getVersion = () => '3.0.0';
        if (state === 'missing queue') h.plugins['notebook-navigator'] = { api: h.plugin.api };
        if (state === 'missing execute') h.plugins['notebook-navigator'] = { api: h.plugin.api, commandQueue: { isChangingFilePaths: () => false } };
        if (state === 'missing context check') h.plugins['notebook-navigator'] = { api: h.plugin.api, commandQueue: { executeMoveFiles: h.queue.executeMoveFiles } };
        await moveFileWithNotebookNavigator(h.app, h.file, h.destination);
        expect(h.file.path).toBe(h.destination);
        expect(h.renameFile).toHaveBeenCalledOnce();
        expect(h.queue.executeMoveFiles).not.toHaveBeenCalled();
    });

    it.each(['throws', 'does not invoke callback'])('still files once when the move adapter %s', async failure => {
        const h = harness();
        if (failure === 'throws') h.queue.executeMoveFiles.mockRejectedValueOnce(new Error('Navigator unavailable'));
        else h.queue.executeMoveFiles.mockResolvedValueOnce({ success: false, error: new Error('Navigator unavailable') });
        await moveFileWithNotebookNavigator(h.app, h.file, h.destination);
        expect(h.file.path).toBe(h.destination);
        expect(h.renameFile).toHaveBeenCalledOnce();
    });

    it('does not repeat or undo a completed rename if the adapter throws afterward', async () => {
        const h = harness();
        h.queue.executeMoveFiles.mockImplementationOnce(async (_files, _folder, performMove) => {
            await performMove();
            throw new Error('Navigator cleanup failed');
        });
        await moveFileWithNotebookNavigator(h.app, h.file, h.destination);
        expect(h.file.path).toBe(h.destination);
        expect(h.renameFile).toHaveBeenCalledOnce();
    });
});
