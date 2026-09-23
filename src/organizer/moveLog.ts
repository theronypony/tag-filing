import { Plugin } from 'obsidian';
import { MoveResult } from './singleTagOrganizer';

export interface MoveLog {
    version: 1;
    startedAt: string;
    finishedAt?: string;
    cancelled: boolean;
    error?: string;
    files: MoveResult[];
}

/** Append outcomes instead of rewriting a vault-sized report after every note. */
export function createMoveLog(plugin: Plugin, files: MoveResult[]): { path: string; log: MoveLog; save: (result?: MoveResult) => Promise<void> } {
    const dir = plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`;
    const startedAt = new Date().toISOString();
    const nonce = crypto.randomUUID();
    const path = `${dir}/folder-moves-${startedAt.replace(/[:.]/g, '-')}-${nonce}.jsonl`;
    const log: MoveLog = { version: 1, startedAt, cancelled: false, files };
    let initialized = false;
    return { path, log, save: async result => {
        if (!initialized) {
            await plugin.app.vault.adapter.write(path, JSON.stringify({ type: 'plan', ...log }) + '\n');
            initialized = true;
        } else {
            const entry = result ? { type: 'result', ...result, at: new Date().toISOString() } : {
                type: 'summary', finishedAt: log.finishedAt, cancelled: log.cancelled, error: log.error,
                counts: files.reduce<Record<string, number>>((counts, file) => {
                    counts[file.status] = (counts[file.status] ?? 0) + 1;
                    return counts;
                }, {})
            };
            // A leading newline separates this entry even after a partially written previous line.
            await plugin.app.vault.adapter.append(path, '\n' + JSON.stringify(entry) + '\n');
        }
    } };
}
