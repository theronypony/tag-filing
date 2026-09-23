import { App, DataWriteOptions, TFile } from 'obsidian';
import { NumericRange, mergeRanges } from '../utils/ranges';
import { computeExclusionRanges } from './exclusionRanges';
import { ExtractorSettings, TagConvertPolicy, extractInlineTags } from './tagExtractor';
import { stripInlineTags } from './whitespaceCleanup';
import { computeTagsToAdd, mergeTagsIntoFrontmatter, normalizeTagsValue } from '../frontmatter';
import { FileStatus } from '../transactionLog';

export interface FilePreview {
    path: string;
    /** Tags that would actually be added to frontmatter (after dup / redundant-parent filtering). */
    tagsToAdd: string[];
    /** All distinct inline tags found in the body (some may already be in frontmatter). */
    extractedTags: string[];
    /** Number of inline tokens that would be removed from the body. */
    removedTokenCount: number;
}

export interface ConversionResult {
    path: string;
    extractedTags: string[];
    status: FileStatus;
    error?: string;
}

export interface ProgressInfo {
    processed: number;
    total: number;
    tagsFound: number;
    currentPath: string;
}

export interface ConvertOptions {
    onProgress?: (info: ProgressInfo) => void;
    /** Polled between files; return true to stop. Already-processed files remain converted. */
    shouldCancel?: () => boolean;
}

/**
 * Context for the "convert existing tags only" mode. Built once per run (a snapshot taken before any
 * file is modified) so the preview and the actual conversion judge against the same vault state.
 */
export interface ExistingOnlyContext {
    /** Lowercased tag path → set of file paths that contain it (frontmatter or inline). */
    tagFiles: ReadonlyMap<string, ReadonlySet<string>>;
    /** When true, one-off inline tags (found only in this note) are stripped without being added. */
    stripSingleNote: boolean;
}

/**
 * Builds the vault-wide tag → file-paths index from the metadata cache (no files written). A tag is
 * mapped to every file whose frontmatter or body references it. Used to decide whether an inline tag
 * is "established" (used in another note) for the existing-tags-only mode.
 */
export function buildVaultTagFileMap(app: App): Map<string, Set<string>> {
    const map = new Map<string, Set<string>>();
    const add = (rawTag: string, path: string): void => {
        const key = rawTag.trim().replace(/^#+/, '').toLowerCase();
        if (key.length === 0) {
            return;
        }
        let set = map.get(key);
        if (!set) {
            set = new Set<string>();
            map.set(key, set);
        }
        set.add(path);
    };
    for (const file of app.vault.getMarkdownFiles()) {
        const cache = app.metadataCache.getFileCache(file);
        for (const tag of normalizeTagsValue(cache?.frontmatter?.tags)) {
            add(tag, file.path);
        }
        for (const ref of cache?.tags ?? []) {
            add(ref.tag, file.path);
        }
    }
    return map;
}

/**
 * Builds the per-file add/remove policy for a single conversion. Returns undefined (convert
 * everything) when not in existing-tags-only mode. Otherwise an inline tag is "established" — and so
 * convertible — when it already sits in this note's frontmatter or appears in at least one *other*
 * note. One-off tags (only inline, only here) are added to frontmatter never, and stripped from the
 * body only when `stripSingleNote` is on.
 */
export function buildConvertPolicy(
    existingOnly: ExistingOnlyContext | null | undefined,
    filePath: string,
    existingFrontmatterTags: string[]
): TagConvertPolicy | undefined {
    if (!existingOnly) {
        return undefined;
    }
    const frontmatterTags = new Set(existingFrontmatterTags.map(tag => tag.toLowerCase()));
    const isEstablished = (tagName: string): boolean => {
        const key = tagName.toLowerCase();
        if (frontmatterTags.has(key)) {
            return true;
        }
        const files = existingOnly.tagFiles.get(key);
        if (!files) {
            return false;
        }
        for (const path of files) {
            if (path !== filePath) {
                return true; // appears in another note
            }
        }
        return false;
    };
    return {
        shouldAdd: isEstablished,
        shouldRemove: tagName => isEstablished(tagName) || existingOnly.stripSingleNote
    };
}

/**
 * Locates the YAML frontmatter block range (`[start, end)`) if the content begins with one.
 * Used so inline-tag scanning never touches frontmatter (where `#` is a YAML comment).
 */
export function findFrontmatterRange(content: string): NumericRange | null {
    // Obsidian frontmatter must be the very first thing in the file.
    const opening = /^---[ \t]*\r?\n/.exec(content);
    if (!opening || opening.index !== 0) {
        return null;
    }
    const bodyStart = opening[0].length;
    // Closing delimiter: a line containing only --- or ...
    const closing = /\r?\n(---|\.\.\.)[ \t]*(\r?\n|$)/.exec(content.slice(bodyStart - 1));
    if (!closing) {
        return null;
    }
    const end = bodyStart - 1 + closing.index + closing[0].length;
    return { start: 0, end };
}

/** Computes the full exclusion set (code/inline-code/HTML + frontmatter) for a file's content. */
function computeAllExclusions(content: string): NumericRange[] {
    const base = computeExclusionRanges(content);
    const fm = findFrontmatterRange(content);
    return fm ? mergeRanges([...base, fm]) : base;
}

/**
 * Scans a single file read-only and returns a preview, or null if it has no convertible inline tags.
 * Uses the metadata cache for existing frontmatter tags (no write).
 */
export function scanFileForPreview(
    app: App,
    file: TFile,
    content: string,
    settings: ExtractorSettings,
    existingOnly?: ExistingOnlyContext | null
): FilePreview | null {
    const existing = normalizeTagsValue(app.metadataCache.getFileCache(file)?.frontmatter?.tags);
    const policy = buildConvertPolicy(existingOnly, file.path, existing);
    const ranges = computeAllExclusions(content);
    const { tags, removals } = extractInlineTags(content, ranges, settings, policy);
    if (removals.length === 0) {
        return null;
    }
    const tagsToAdd = computeTagsToAdd(existing, tags);
    return {
        path: file.path,
        tagsToAdd,
        extractedTags: tags,
        removedTokenCount: removals.length
    };
}

/**
 * Converts a single file: frontmatter write first, then body strip.
 *
 * Ordering rationale (deviates from the plan's body-first, intentionally — safer & idempotent):
 * writing frontmatter first means a crash between the two steps leaves a *recoverable* duplicate
 * (inline tag still present AND now in frontmatter) rather than irrecoverable loss. Re-running the
 * converter is then idempotent: the tag is already in frontmatter so nothing is added, and the body
 * strip completes. If `processFrontMatter` throws (e.g. malformed YAML), we skip before touching the
 * body, so a file with unwritable frontmatter never loses its inline tags.
 */
export async function convertSingleFile(
    app: App,
    file: TFile,
    settings: ExtractorSettings,
    existingOnly?: ExistingOnlyContext | null
): Promise<ConversionResult> {
    let content: string;
    try {
        content = await app.vault.read(file);
    } catch (error) {
        return { path: file.path, extractedTags: [], status: 'failed', error: describe(error) };
    }

    // Capture the file's pre-conversion timestamps once, before any write touches `file.stat`.
    // Both writes below reuse these so the converted file keeps its original modification date
    // instead of being stamped with "now". (ctime restore is best-effort; some OSes/filesystems
    // ignore it, but mtime — the user-facing modification date — is preserved reliably.)
    const writeOptions: DataWriteOptions = { ctime: file.stat.ctime, mtime: file.stat.mtime };

    const existing = normalizeTagsValue(app.metadataCache.getFileCache(file)?.frontmatter?.tags);
    const policy = buildConvertPolicy(existingOnly, file.path, existing);

    const ranges = computeAllExclusions(content);
    const { tags, removals } = extractInlineTags(content, ranges, settings, policy);

    // Nothing to add and nothing to strip (e.g. only excluded or one-off tags that we keep) → no-op.
    if (tags.length === 0 && removals.length === 0) {
        return { path: file.path, extractedTags: [], status: 'skipped' };
    }

    // 1. Frontmatter first (skip the write entirely if nothing new would be added).
    const tagsToAdd = computeTagsToAdd(existing, tags);
    if (tagsToAdd.length > 0) {
        try {
            await mergeTagsIntoFrontmatter(app, file, tags, writeOptions);
        } catch (error) {
            // Could not write frontmatter (e.g. malformed YAML) → do NOT strip the body.
            return { path: file.path, extractedTags: tags, status: 'failed', error: describe(error) };
        }
    }

    // 2. Body strip (atomic). Recompute exclusions/removals from the data Obsidian hands us.
    try {
        await app.vault.process(file, data => {
            const dataRanges = computeAllExclusions(data);
            const { removals: dataRemovals } = extractInlineTags(data, dataRanges, settings, policy);
            if (dataRemovals.length === 0) {
                return data;
            }
            return stripInlineTags(data, dataRemovals);
        }, writeOptions);
    } catch (error) {
        // Frontmatter already updated; inline tags remain → recoverable duplicate, not data loss.
        return { path: file.path, extractedTags: tags, status: 'failed', error: describe(error) };
    }

    return { path: file.path, extractedTags: tags, status: 'ok' };
}

/**
 * Runs a dry-run scan over the given files, returning previews only for files with inline tags.
 * Yields to the event loop periodically and honors cancellation.
 */
export async function dryRunScan(
    app: App,
    files: TFile[],
    settings: ExtractorSettings,
    options: ConvertOptions = {},
    existingOnly?: ExistingOnlyContext | null
): Promise<FilePreview[]> {
    const previews: FilePreview[] = [];
    let processed = 0;
    let tagsFound = 0;
    for (const file of files) {
        if (options.shouldCancel?.()) {
            break;
        }
        try {
            const content = await app.vault.cachedRead(file);
            const preview = scanFileForPreview(app, file, content, settings, existingOnly);
            if (preview) {
                previews.push(preview);
                tagsFound += preview.extractedTags.length;
            }
        } catch (error) {
            console.error(`[tag-filing] Scan failed for ${file.path}:`, error);
        }
        processed += 1;
        options.onProgress?.({ processed, total: files.length, tagsFound, currentPath: file.path });
        if (processed % 10 === 0) {
            await yieldToEventLoop();
        }
    }
    return previews;
}

/**
 * Runs the conversion over the given files sequentially. Yields to the event loop every 10 files and
 * honors cancellation. Per-file errors are captured; processing continues.
 */
export async function convertFiles(
    app: App,
    files: TFile[],
    settings: ExtractorSettings,
    options: ConvertOptions = {},
    existingOnly?: ExistingOnlyContext | null
): Promise<ConversionResult[]> {
    const results: ConversionResult[] = [];
    let processed = 0;
    let tagsFound = 0;
    for (const file of files) {
        if (options.shouldCancel?.()) {
            break;
        }
        const result = await convertSingleFile(app, file, settings, existingOnly);
        results.push(result);
        if (result.status === 'ok') {
            tagsFound += result.extractedTags.length;
        }
        processed += 1;
        options.onProgress?.({ processed, total: files.length, tagsFound, currentPath: file.path });
        if (processed % 10 === 0) {
            await yieldToEventLoop();
        }
    }
    return results;
}

/** Lets Obsidian process pending UI events so the interface stays responsive during long runs. */
export function yieldToEventLoop(): Promise<void> {
    return new Promise(resolve => window.setTimeout(resolve, 0));
}

function describe(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

/** Builds a human-readable markdown report of a dry-run scan for export/review. */
export function buildPreviewMarkdown(previews: FilePreview[], scopeLabel: string): string {
    const tagCount = previews.reduce((sum, p) => sum + p.removedTokenCount, 0);
    const lines: string[] = [];
    lines.push('# Inline tag conversion — preview report');
    lines.push('');
    lines.push(`- Scope: ${scopeLabel}`);
    lines.push(`- Files to modify: ${previews.length}`);
    lines.push(`- Inline tokens to remove: ${tagCount}`);
    lines.push('');
    lines.push('| File | Add to frontmatter | Inline tokens removed |');
    lines.push('| --- | --- | --- |');
    for (const p of previews) {
        const add = p.tagsToAdd.length > 0 ? p.tagsToAdd.join(', ') : '(already present)';
        // Escape pipes so the markdown table stays intact.
        const path = p.path.replace(/\|/g, '\\|');
        lines.push(`| ${path} | ${add.replace(/\|/g, '\\|')} | ${p.removedTokenCount} |`);
    }
    lines.push('');
    return lines.join('\n');
}
