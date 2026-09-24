import { App, TFolder } from 'obsidian';

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

interface PluginWithApi {
    api?: NotebookNavigatorAPI;
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
