import { App, TAbstractFile, TFile, TFolder } from 'obsidian';
import { hasValidTagCharacters } from './utils/tagUtils';

export const pathKey = (path: string): string => path.normalize('NFC').toLowerCase();

export function isExcludedPath(path: string, folders: string[]): boolean {
    const normalized = pathKey(path.replace(/^\/+|\/+$/g, ''));
    return folders.some(folder => {
        const value = pathKey(folder.trim().replace(/^\/+|\/+$/g, ''));
        return value !== '' && (normalized === value || normalized.startsWith(value + '/'));
    });
}

export interface Placement {
    destination: string;
    missingFolders: string[];
}

function matchingChild(parent: TFolder, name: string): TAbstractFile | null {
    const matches = parent.children.filter(child => pathKey(child.name) === pathKey(name));
    if (matches.length > 1) throw new Error(`Ambiguous capitalization: ${parent.path}/${name}`);
    return matches[0] ?? null;
}

/** Resolve the full tag path from the vault root, preserving unambiguous existing folder spelling. */
export function resolvePlacement(app: App, file: TFile, rawTag: string, exclusions: string[]): Placement {
    const tag = rawTag.trim().replace(/^#/, '').normalize('NFC');
    if (!hasValidTagCharacters(tag)) throw new Error(`Invalid folder tag: ${rawTag}`);
    const segments = tag.split('/');
    if (segments.some(segment => /[<>:"\\|?*\u0000-\u001f]/.test(segment) || /[. ]$/.test(segment)
        || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(segment))) {
        throw new Error(`Tag cannot be used as a folder path: ${rawTag}`);
    }
    if (isExcludedPath(file.path, exclusions)) throw new Error('Source folder is excluded.');
    let parent: TFolder | null = app.vault.getRoot();
    const parts: string[] = [];
    const missingFolders: string[] = [];
    for (const segment of segments) {
        const child = parent ? matchingChild(parent, segment) : null;
        if (child && !(child instanceof TFolder)) throw new Error(`A file occupies the folder path: ${child.path}`);
        parts.push(child?.name ?? segment);
        if (!child) missingFolders.push(parts.join('/'));
        parent = child as TFolder | null;
    }
    const folder = parts.join('/');
    if (isExcludedPath(folder, exclusions) || isExcludedPath(folder, [app.vault.configDir])) {
        throw new Error('Destination folder is excluded.');
    }
    if (parent) {
        const existing = matchingChild(parent, file.name);
        if (existing && existing !== file) throw new Error(`Destination already exists: ${existing.path}`);
    }
    return { destination: `${folder}/${file.name}`, missingFolders };
}

export interface MoveOutcome {
    status: 'moved' | 'skipped' | 'failed';
    reason?: string;
    tagsUpdated?: boolean;
}

export interface MoveRequest {
    file: TFile;
    source: string;
    tag: string;
    destination: string;
    exclusions: () => string[];
    shouldCancel: () => boolean;
    /** Re-read the note immediately before moving; false means the preview no longer applies. */
    isCurrent: () => Promise<boolean>;
    /** Only explicit tag drops may rewrite a note. Compare-and-swap protects concurrent edits. */
    contentChange?: { before: string; after: string };
    /** Optional tag-drop adapter; invoked only for the final rename after all move checks. */
    renameFile?: (file: TFile, destination: string) => Promise<void>;
}

/** Shared queue prevents automatic and manual moves racing one another inside this plugin. */
export class FolderMover {
    private queue: Promise<unknown> = Promise.resolve();

    constructor(private readonly app: App) {}

    move(request: MoveRequest): Promise<MoveOutcome> {
        const result = this.queue.then(() => this.perform(request));
        this.queue = result.catch(() => undefined);
        return result;
    }

    private async perform(request: MoveRequest): Promise<MoveOutcome> {
        const { file, source, tag, destination } = request;
        const available = (): boolean => !request.shouldCancel()
            && file.path === source && this.app.vault.getAbstractFileByPath(source) === file;
        // Reading a note yields to the UI and sync. Check cancellation and identity again afterward.
        const unchanged = async (): Promise<boolean> => available() && await request.isCurrent() && available();
        const change = request.contentChange;
        let edited = false;
        try {
            if (!await unchanged()) return { status: 'skipped', reason: 'Note changed, was removed, or processing was cancelled.' };
            const folderTag = destination.slice(0, destination.lastIndexOf('/'));
            if (pathKey(folderTag) !== pathKey(tag.trim().replace(/^#/, ''))) {
                return { status: 'skipped', reason: 'Destination no longer corresponds to the tag.' };
            }
            // The preview may choose one spelling for a missing folder shared by several notes.
            let placement = resolvePlacement(this.app, file, folderTag, request.exclusions());
            if (placement.destination !== destination) return { status: 'skipped', reason: 'Destination changed since preview.' };
            if (source === destination && !change) return { status: 'skipped', reason: 'Already in the matching folder.' };
            for (const folder of placement.missingFolders) {
                if (request.shouldCancel()) return { status: 'skipped', reason: 'Processing cancelled.' };
                // Re-resolve around folder creation; another plugin or sync may have created a path.
                placement = resolvePlacement(this.app, file, folderTag, request.exclusions());
                if (placement.destination !== destination) return { status: 'skipped', reason: 'Destination changed during processing.' };
                if (!this.app.vault.getAbstractFileByPath(folder)) {
                    try {
                        await this.app.vault.createFolder(folder);
                    } catch (error) {
                        if (!(this.app.vault.getAbstractFileByPath(folder) instanceof TFolder)) throw error;
                    }
                }
            }
            if (!await unchanged()) return { status: 'skipped', reason: 'Note changed or processing was cancelled before the move.' };
            placement = resolvePlacement(this.app, file, folderTag, request.exclusions());
            if (placement.destination !== destination) return { status: 'skipped', reason: 'Destination changed during processing.' };
            if (change && change.before !== change.after) {
                await this.app.vault.process(file, current => {
                    if (!available() || current !== change.before) throw new Error('Note changed before its tags could be updated.');
                    if (resolvePlacement(this.app, file, folderTag, request.exclusions()).destination !== destination) {
                        throw new Error('Destination changed before its tags could be updated.');
                    }
                    return change.after;
                });
                edited = true;
                const current = await this.app.vault.read(file);
                if (!available() || current !== change.after) throw new Error('Note changed or processing was cancelled before the move.');
                if (resolvePlacement(this.app, file, folderTag, request.exclusions()).destination !== destination) {
                    throw new Error('Destination changed before the move.');
                }
            }
            if (source === destination) return { status: 'skipped', reason: 'Already in the matching folder.', tagsUpdated: edited };
            if (request.renameFile) await request.renameFile(file, destination);
            else await this.app.fileManager.renameFile(file, destination);
            return edited ? { status: 'moved', tagsUpdated: true } : { status: 'moved' };
        } catch (error) {
            let reason = error instanceof Error ? error.message : String(error);
            if (edited && change) {
                // A failed move must not silently discard the old tags. Never overwrite a later edit.
                let restored = false;
                try {
                    await this.app.vault.process(file, current => {
                        if (file.path !== source || this.app.vault.getAbstractFileByPath(source) !== file || current !== change.after) {
                            throw new Error('Note changed during recovery.');
                        }
                        restored = true;
                        return change.before;
                    });
                } catch { restored = false; }
                reason += restored ? ' Original note content restored.' : ' Could not restore the original tags; check this note before continuing.';
            }
            return { status: 'failed', reason };
        }
    }
}
