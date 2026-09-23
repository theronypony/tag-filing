import { vi } from 'vitest';
import type { App } from 'obsidian';
import { TAbstractFile, TFile, TFolder } from '../stubs/obsidian';

export function note(frontmatter: unknown, body = ''): string {
    return `---\n${JSON.stringify(frontmatter)}\n---\n${body}`;
}

export function vaultHarness() {
    const root = new TFolder();
    const entries = new Map<string, TAbstractFile>([['', root]]);
    const contents = new Map<TFile, string>();
    const createListeners: ((file: TAbstractFile) => void)[] = [];
    const openListeners: ((file: TFile | null) => void)[] = [];
    const layouts: (() => void)[] = [];
    const writes = new Map<string, string>();
    function seedFolder(path: string): TFolder {
        const existing = entries.get(path);
        if (existing instanceof TFolder) return existing;
        if (existing) throw new Error(`File occupies folder: ${path}`);
        const folder = new TFolder();
        folder.path = path;
        folder.name = path.split('/').pop()!;
        folder.parent = seedFolder(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
        folder.parent.children.push(folder);
        entries.set(path, folder);
        return folder;
    }
    function seedFile(path: string, content = '', ctime = Date.now()): TFile {
        if (entries.has(path)) throw new Error(`Already exists: ${path}`);
        const file = new TFile();
        file.path = path;
        file.name = path.split('/').pop()!;
        file.basename = file.name.replace(/\.[^.]+$/, '');
        file.extension = file.name.split('.').pop()!;
        file.stat.ctime = ctime;
        file.parent = seedFolder(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
        file.parent.children.push(file);
        entries.set(path, file);
        contents.set(file, content);
        return file;
    }
    const read = vi.fn(async (file: TFile) => {
        if (entries.get(file.path) !== file || !contents.has(file)) throw new Error('File unavailable');
        return contents.get(file)!;
    });
    const createFolder = vi.fn(async (path: string) => {
        if (entries.has(path)) throw new Error('Already exists');
        return seedFolder(path);
    });
    const renameFile = vi.fn(async (file: TFile, destination: string) => {
        if (entries.has(destination)) throw new Error('Destination already exists');
        const parent = entries.get(destination.slice(0, destination.lastIndexOf('/')));
        if (!(parent instanceof TFolder)) throw new Error('Parent missing');
        entries.delete(file.path);
        file.parent!.children = file.parent!.children.filter(child => child !== file);
        file.parent = parent;
        parent.children.push(file);
        file.path = destination;
        file.name = destination.split('/').pop()!;
        entries.set(destination, file);
    });
    const write = vi.fn(async (path: string, content: string) => { writes.set(path, content); });
    const append = vi.fn(async (path: string, content: string) => { writes.set(path, (writes.get(path) ?? '') + content); });
    const processFrontMatter = vi.fn(async () => { throw new Error('Folder filing must not write tags'); });
    const app = {
        vault: {
            configDir: '.obsidian',
            getRoot: () => root,
            getAbstractFileByPath: (path: string) => entries.get(path) ?? null,
            getMarkdownFiles: () => [...entries.values()].filter(file => file instanceof TFile && file.extension === 'md'),
            read, createFolder, adapter: { write, append },
            on: (_event: string, callback: (file: TAbstractFile) => void) => { createListeners.push(callback); return {}; }
        },
        fileManager: { renameFile, processFrontMatter },
        workspace: {
            onLayoutReady: (callback: () => void) => layouts.push(callback),
            on: (_event: string, callback: (file: TFile | null) => void) => { openListeners.push(callback); return {}; }
        },
        plugins: { plugins: {} as Record<string, unknown> }
    } as unknown as App;
    return {
        app, entries, contents, writes, seedFile, seedFolder, read, createFolder, renameFile, write, append, processFrontMatter,
        layoutReady: () => layouts.splice(0).forEach(callback => callback()),
        create: (file: TFile) => createListeners.forEach(callback => callback(file)),
        open: (file: TFile) => openListeners.forEach(callback => callback(file))
    };
}
