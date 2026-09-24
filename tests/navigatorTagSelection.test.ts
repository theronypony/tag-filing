import { describe, expect, it, vi } from 'vitest';
import { selectNotebookNavigatorTag } from '../src/nnApi';
import { vaultHarness } from './helpers/vault';

function harness() {
    const h = vaultHarness();
    const navigateToTag = vi.fn(async (_tag: string) => true);
    const plugins = (h.app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins.plugins;
    const api = { getVersion: () => '2.0.0', navigation: { navigateToTag } };
    plugins['notebook-navigator'] = { api };
    return { ...h, plugins, api, navigateToTag };
}

describe('Navigator destination-tag selection', () => {
    it('selects the target tag after queued move handlers highlight its folder', async () => {
        vi.useFakeTimers();
        const h = harness();
        let selection = 'tag:work';
        window.setTimeout(() => { selection = 'folder:personal'; }, 0);
        h.navigateToTag.mockImplementation(async tag => {
            expect(selection).toBe('folder:personal');
            selection = `tag:${tag}`;
            return true;
        });
        const pending = selectNotebookNavigatorTag(h.app, 'personal/meetings', () => false);
        expect(h.navigateToTag).not.toHaveBeenCalled();
        await vi.runAllTimersAsync();
        expect(await pending).toBe(true);
        expect(selection).toBe('tag:personal/meetings');
    });

    it('cancels a queued selection when filing is disabled or the plugin unloads', async () => {
        vi.useFakeTimers();
        const h = harness();
        let cancelled = false;
        const pending = selectNotebookNavigatorTag(h.app, 'personal', () => cancelled);
        cancelled = true;
        await vi.runAllTimersAsync();
        expect(await pending).toBe(false);
        expect(h.navigateToTag).not.toHaveBeenCalled();
    });

    it.each(['disabled', 'unsupported', 'missing navigation'])('handles Navigator being %s without affecting the completed move', async state => {
        const h = harness();
        const pending = selectNotebookNavigatorTag(h.app, 'personal', () => false);
        if (state === 'disabled') delete h.plugins['notebook-navigator'];
        if (state === 'unsupported') h.api.getVersion = () => '3.0.0';
        if (state === 'missing navigation') h.plugins['notebook-navigator'] = { api: { getVersion: () => '2.0.0' } };
        expect(await pending).toBe(false);
        expect(h.navigateToTag).not.toHaveBeenCalled();
    });

    it.each(['false', 'throws'])('reports unsuccessful navigation when the API returns %s', async response => {
        const h = harness();
        if (response === 'false') h.navigateToTag.mockResolvedValueOnce(false);
        else h.navigateToTag.mockRejectedValueOnce(new Error('Navigator not ready'));
        expect(await selectNotebookNavigatorTag(h.app, 'personal', () => false)).toBe(false);
    });
});
