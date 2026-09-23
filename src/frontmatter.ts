import { App, DataWriteOptions, TFile } from 'obsidian';
import { isDescendantOf, tagsEqual } from './utils/tagHierarchy';

/**
 * Reads the current frontmatter `tags` value of a file as a normalized string array.
 * Handles the three shapes Obsidian accepts: array, single string, or absent.
 * Read-only — uses the metadata cache, no file write.
 */
export function readFrontmatterTags(app: App, file: TFile): string[] {
    const cache = app.metadataCache.getFileCache(file);
    return normalizeTagsValue(cache?.frontmatter?.tags);
}

/**
 * Normalizes a raw frontmatter `tags` value into a string array.
 * Accepts `string[]`, a single `string` (possibly comma/space separated), or null/undefined.
 * Strips leading `#`, trims, and drops empties.
 */
export function normalizeTagsValue(value: unknown): string[] {
    if (value == null) {
        return [];
    }
    const raw: unknown[] = Array.isArray(value) ? value : [value];
    const result: string[] = [];
    for (const entry of raw) {
        if (typeof entry !== 'string') {
            continue;
        }
        // A single string field may contain multiple space/comma separated tags.
        for (const piece of entry.split(/[\s,]+/)) {
            const cleaned = piece.trim().replace(/^#+/, '').trim();
            if (cleaned.length > 0) {
                result.push(cleaned);
            }
        }
    }
    return result;
}

/**
 * Computes which of `candidateTags` should be added to an existing tag set, applying:
 *  - exact-duplicate skip (case-insensitive)
 *  - redundant-parent skip: if an existing tag is a descendant of the candidate, the candidate
 *    is implied and skipped (e.g. existing `work/meetings` makes candidate `work` redundant).
 *
 * Returns the list of tags to append (preserving candidate order), de-duplicated against itself.
 * Pure function — easy to unit test.
 */
export function computeTagsToAdd(existingTags: string[], candidateTags: string[]): string[] {
    const toAdd: string[] = [];
    const accepted = [...existingTags];

    for (const candidate of candidateTags) {
        const cand = candidate.trim().replace(/^#+/, '').trim();
        if (cand.length === 0) {
            continue;
        }
        // Already present (case-insensitive)?
        if (accepted.some(existing => tagsEqual(existing, cand))) {
            continue;
        }
        // Redundant parent: some accepted tag is a descendant of this candidate.
        if (accepted.some(existing => isDescendantOf(existing, cand))) {
            continue;
        }
        toAdd.push(cand);
        accepted.push(cand);
    }

    return toAdd;
}

/**
 * Merges the given tags into a file's frontmatter `tags:` array using Obsidian's atomic
 * `processFrontMatter`. Applies duplicate and redundant-parent checks. Returns the tags that were
 * actually added (empty array if nothing changed).
 *
 * - No frontmatter → a block is created automatically by Obsidian.
 * - Existing non-array `tags` (single string) → normalized to an array.
 * - Existing array → appended to, preserving order and existing entries.
 *
 * Pass `options` (`{ ctime, mtime }`) to preserve the file's original timestamps across the write;
 * omit it to let Obsidian stamp the current time.
 */
export async function mergeTagsIntoFrontmatter(
    app: App,
    file: TFile,
    tags: string[],
    options?: DataWriteOptions
): Promise<string[]> {
    let added: string[] = [];

    await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        const existing = normalizeTagsValue(frontmatter.tags);
        added = computeTagsToAdd(existing, tags);
        if (added.length === 0) {
            return;
        }
        // Write back as a clean array of the union, preserving existing order then new tags.
        frontmatter.tags = [...existing, ...added];
    }, options);

    return added;
}
