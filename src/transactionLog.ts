import { Plugin } from 'obsidian';

export type FileStatus = 'ok' | 'skipped' | 'failed';

export interface FileLogEntry {
    path: string;
    extractedTags: string[];
    status: FileStatus;
    error?: string;
}

export interface ConversionLog {
    timestamp: string;
    scope: string;
    totalFiles: number;
    modifiedFiles: number;
    failedFiles: number;
    files: FileLogEntry[];
}

const LOG_FILENAME = 'conversion-log.json';

/**
 * Returns the vault-relative path of the conversion log inside the plugin's data directory.
 */
export function getLogPath(plugin: Plugin): string {
    const dir = plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`;
    return `${dir}/${LOG_FILENAME}`;
}

/**
 * Writes the conversion log to the plugin's data directory. Never throws — logging failures must not
 * fail the conversion. Returns the log path on success, or null on failure.
 */
export async function writeConversionLog(plugin: Plugin, log: ConversionLog): Promise<string | null> {
    const path = getLogPath(plugin);
    try {
        await plugin.app.vault.adapter.write(path, JSON.stringify(log, null, 2));
        return path;
    } catch (error) {
        console.error('[tag-filing] Failed to write conversion log:', error);
        return null;
    }
}
