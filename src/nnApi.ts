import { App, TFile, TFolder } from 'obsidian';

/**
 * Minimal type definitions for the Notebook Navigator public API (contract v2.0.0).
 *
 * Only the surface this plugin uses is declared. Mirrors NN's public type definitions
 * (`src/api/public/notebook-navigator.d.ts`). All members are treated as optional/guarded at
 * runtime because the API may be absent, an older version, or not yet ready.
 */

export type NavItemType = 'folder' | 'tag' | 'property' | 'none';

export type NavItem =
    | { type: 'folder'; folder: TFolder; tag: null; property: null }
    | { type: 'tag'; folder: null; tag: string; property: null }
    | { type: 'property'; folder: null; tag: null; property: string }
    | { type: 'none'; folder: null; tag: null; property: null };

export interface NotebookNavigatorAPI {
    getVersion?: () => string;
    whenReady?: () => Promise<void>;
    selection?: {
        getNavItem: () => NavItem;
    };
    navigation?: {
        navigateToTag?: (tag: string) => Promise<boolean>;
    };
    tagCollections?: {
        isCollection: (tag: string | null | undefined) => boolean;
    };
}

interface NavigatorMoveData {
    movedCount: number;
    skippedCount: number;
    cancelledCount: number;
    movedSourcePaths: string[];
    errors: { filePath: string; error: unknown }[];
}

interface PluginWithApi {
    api?: NotebookNavigatorAPI;
    // Internal NN integration, checked against 3.4.3. This is not part of public API 2.x.
    commandQueue?: {
        isChangingFilePaths?: () => boolean;
        executeMoveFiles?: (
            files: TFile[], folder: TFolder, performMove: () => Promise<NavigatorMoveData>
        ) => Promise<unknown>;
    };
}

interface AppWithPlugins extends App {
    plugins?: {
        plugins?: Record<string, PluginWithApi | undefined>;
        enabledPlugins?: Set<string>;
    };
}

export const NOTEBOOK_NAVIGATOR_ID = 'notebook-navigator';

/**
 * Returns the Notebook Navigator public API if the plugin is installed, enabled, and has
 * initialized its API. Returns null otherwise. Never throws.
 */
export function getNotebookNavigatorApi(app: App): NotebookNavigatorAPI | null {
    const plugins = (app as AppWithPlugins).plugins?.plugins;
    const api = plugins?.[NOTEBOOK_NAVIGATOR_ID]?.api;
    return api ?? null;
}

/** Mark an explicit tag-drop move as Navigator-managed so its rename listener skips folder reveal. */
export async function moveFileWithNotebookNavigator(app: App, file: TFile, destination: string): Promise<void> {
    const source = file.path;
    let renamePromise: Promise<void> | undefined;
    // Cache success AND failure: an adapter error must never retry a filesystem operation.
    const renameOnce = (): Promise<void> => renamePromise ??= (async () => {
        await app.fileManager.renameFile(file, destination);
    })();
    try {
        const plugin = (app as AppWithPlugins).plugins?.plugins?.[NOTEBOOK_NAVIGATOR_ID];
        const queue = plugin?.commandQueue;
        const folder = app.vault.getAbstractFileByPath(destination.slice(0, destination.lastIndexOf('/')));
        if (plugin?.api?.getVersion?.().split('.')[0] === '2'
            && typeof queue?.isChangingFilePaths === 'function'
            && typeof queue.executeMoveFiles === 'function' && folder instanceof TFolder) {
            // NN captures this operation context synchronously when the rename event fires.
            // Its service releases the context in finally, including when the rename fails.
            await queue.executeMoveFiles([file], folder, async () => {
                await renameOnce();
                return { movedCount: 1, skippedCount: 0, cancelledCount: 0, movedSourcePaths: [source], errors: [] };
            });
        }
    } catch {
        // Missing/changed NN internals must not block filing. A rename error is rethrown below.
    }
    // If NN was unavailable, perform the normal move. If it ran, reuse its exact result.
    await renameOnce();
}

/** Select the drop's tag after Obsidian has dispatched the move's UI updates. */
export async function selectNotebookNavigatorTag(app: App, tag: string, shouldCancel: () => boolean): Promise<boolean> {
    // Let queued rename/selection handlers run before requesting the final navigation context.
    await new Promise<void>(resolve => window.setTimeout(resolve, 0));
    if (shouldCancel()) return false;
    try {
        const api = getNotebookNavigatorApi(app);
        if (api?.getVersion?.().split('.')[0] !== '2' || !api.navigation?.navigateToTag) return false;
        // Navigator's navigation API waits for its view to be ready and expands the tag's parents.
        return await api.navigation.navigateToTag(tag);
    } catch {
        return false;
    }
}
