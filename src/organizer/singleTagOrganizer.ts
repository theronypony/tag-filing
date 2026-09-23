import { App, TFile } from 'obsidian';
import { FolderMover, isExcludedPath, pathKey, resolvePlacement } from '../folderPlacement';
import { contentFingerprint, readNoteTags, tagKey } from './noteTags';

export interface MovePreview {
    source: string;
    tag?: string;
    destination?: string;
    missingFolders: string[];
    status: 'ready' | 'skipped';
    reason?: string;
    fingerprint?: string;
    file?: TFile;
}

export interface MoveResult {
    source: string;
    tag?: string;
    destination?: string;
    status: 'pending' | 'moving' | 'moved' | 'skipped' | 'failed';
    reason?: string;
}

export interface OrganizerOptions {
    shouldCancel: () => boolean;
    onProgress?: (processed: number, total: number, path: string) => void;
}

export async function scanSingleTagNotes(app: App, exclusions: string[], options: OrganizerOptions): Promise<MovePreview[]> {
    const files = app.vault.getMarkdownFiles();
    const previews: MovePreview[] = [];
    for (const file of files) {
        if (options.shouldCancel()) break;
        const source = file.path;
        const row: MovePreview = { source, missingFolders: [], status: 'skipped' };
        try {
            if (isExcludedPath(source, [...exclusions, app.vault.configDir])) {
                row.reason = 'Excluded folder';
            } else {
                const content = await app.vault.read(file);
                const { tags } = readNoteTags(content);
                if (tags.length !== 1) {
                    row.reason = tags.length === 0 ? 'No tags' : 'Multiple tags';
                } else {
                    row.tag = tags[0];
                    const placement = resolvePlacement(app, file, tags[0], exclusions);
                    Object.assign(row, placement);
                    if (placement.destination === source) row.reason = 'Already in matching folder';
                    else {
                        row.fingerprint = await contentFingerprint(content);
                        row.file = file;
                        row.status = 'ready';
                    }
                }
            }
        } catch (error) {
            row.reason = error instanceof Error ? error.message : String(error);
        }
        previews.push(row);
        options.onProgress?.(previews.length, files.length, source);
        if (previews.length % 10 === 0) await new Promise(resolve => window.setTimeout(resolve, 0));
    }
    // Agree on spelling for folders that do not exist yet, including shared parent folders.
    const plannedFolders = new Map<string, string>();
    for (const row of previews) {
        if (row.status !== 'ready' || !row.destination) continue;
        const parts = row.destination.split('/');
        const filename = parts.pop()!;
        let folder = '';
        for (const segment of parts) {
            const path = folder ? `${folder}/${segment}` : segment;
            folder = plannedFolders.get(pathKey(path)) ?? path;
            plannedFolders.set(pathKey(path), folder);
        }
        row.destination = `${folder}/${filename}`;
        row.missingFolders = row.missingFolders.map(path => plannedFolders.get(pathKey(path)) ?? path);
    }
    const destinations = new Map<string, MovePreview[]>();
    for (const row of previews) {
        if (row.status !== 'ready' || !row.destination) continue;
        const key = pathKey(row.destination);
        destinations.set(key, [...(destinations.get(key) ?? []), row]);
    }
    for (const group of destinations.values()) {
        if (group.length < 2) continue;
        for (const row of group) {
            row.status = 'skipped';
            row.reason = 'Multiple notes would have the same destination filename';
        }
    }
    return previews;
}

export function initialMoveResults(previews: MovePreview[]): MoveResult[] {
    return previews.map(row => ({ source: row.source, tag: row.tag, destination: row.destination,
        status: row.status === 'ready' ? 'pending' : 'skipped', reason: row.reason }));
}

/** The caller must obtain both backup confirmations before invoking this mutation phase. */
export async function executeMoves(
    app: App, mover: FolderMover, previews: MovePreview[], results: MoveResult[],
    exclusions: () => string[], options: OrganizerOptions, checkpoint: (result?: MoveResult) => Promise<void>
): Promise<void> {
    await checkpoint(); // If logging fails, no moves start.
    for (let index = 0; index < previews.length; index++) {
        if (options.shouldCancel()) break;
        const row = previews[index];
        const result = results[index];
        if (row.status !== 'ready' || !row.file || !row.tag || !row.destination) continue;
        result.status = 'moving';
        await checkpoint(result); // A crash can leave this explicitly indeterminate, never falsely "moved".
        const outcome = await mover.move({
            file: row.file, source: row.source, destination: row.destination, tag: row.tag,
            exclusions, shouldCancel: options.shouldCancel,
            isCurrent: async () => {
                const content = await app.vault.read(row.file!);
                if (await contentFingerprint(content) !== row.fingerprint) return false;
                const tags = readNoteTags(content).tags;
                return tags.length === 1 && tagKey(tags[0]) === tagKey(row.tag!);
            }
        });
        Object.assign(result, outcome);
        await checkpoint(result); // Stop further moves if recording the result failed.
        options.onProgress?.(index + 1, previews.length, row.source);
        await new Promise(resolve => window.setTimeout(resolve, 0));
    }
}

export function buildMoveReport(previews: MovePreview[]): string {
    const escape = (value: string): string => value.replace(/[|\r\n]/g, ' ');
    return ['# Single-tag folder placement preview', '', '| Note | Tag | Destination | Result |', '| --- | --- | --- | --- |',
        ...previews.map(row => `| ${escape(row.source)} | ${escape(row.tag ?? '')} | ${escape(row.destination ?? '')} | ${escape(row.reason ?? 'Ready to move')} |`)].join('\n');
}
