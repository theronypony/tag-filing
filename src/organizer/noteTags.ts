import { getFrontMatterInfo, parseYaml } from 'obsidian';
import { normalizeTagsValue } from '../frontmatter';
import { computeExclusionRanges } from '../converter/exclusionRanges';
import { extractInlineTags, InlineTagExtraction } from '../converter/tagExtractor';
import { hasValidTagCharacters } from '../utils/tagUtils';
import { findRangeContainingIndex, mergeRanges, NumericRange } from '../utils/ranges';

export function tagKey(tag: string): string {
    return tag.trim().replace(/^#/, '').normalize('NFC').toLowerCase();
}

/** Read actual file contents, not a possibly stale metadata-cache snapshot. Never writes tags. */
export function readNoteTags(content: string): { tags: string[]; frontmatterTags: string[] } {
    const text = content.replace(/^\uFEFF/, '');
    const info = getFrontMatterInfo(text);
    if (/^---[ \t]*\r?\n/.test(text) && !info.exists) {
        throw new Error('Unclosed frontmatter; skipped because its tags cannot be determined.');
    }
    const frontmatterTags: string[] = [];
    if (info.exists) {
        const value: unknown = parseYaml(info.frontmatter);
        if (value != null && (typeof value !== 'object' || Array.isArray(value))) {
            throw new Error('Frontmatter must contain named properties.');
        }
        for (const [key, raw] of Object.entries(value ?? {})) {
            if (!['tags', 'tag'].includes(key.toLowerCase()) || raw == null) continue;
            const entries: unknown[] = Array.isArray(raw) ? raw : [raw];
            if (entries.some(entry => typeof entry !== 'string')) {
                throw new Error('A tag property contains a non-text value.');
            }
            const normalized = normalizeTagsValue(raw);
            if (normalized.some(tag => !hasValidTagCharacters(tag))) {
                throw new Error('A tag property contains an invalid tag.');
            }
            frontmatterTags.push(...normalized);
        }
    }
    const body = info.exists ? text.slice(info.contentStart) : text;
    const inline = extractNoteBodyTags(body).tags;
    const distinct = (values: string[]): string[] => {
        const tags = new Map<string, string>();
        for (const tag of values) {
            if (!tags.has(tagKey(tag))) tags.set(tagKey(tag), tag.normalize('NFC'));
        }
        return [...tags.values()];
    };
    return { tags: distinct([...frontmatterTags, ...inline]), frontmatterTags: distinct(frontmatterTags) };
}

/** Shared recognition for counting and removal: code, HTML and comments are never tags. */
export function extractNoteBodyTags(body: string, shouldRemove: (tag: string) => boolean = () => false): InlineTagExtraction {
    // A comment marker inside code/HTML must not hide real tags later in the note.
    const protectedRanges = computeExclusionRanges(body);
    const comments: NumericRange[] = [];
    for (let cursor = 0; cursor < body.length;) {
        const start = body.indexOf('%%', cursor);
        if (start < 0) break;
        const protectedRange = findRangeContainingIndex(start, protectedRanges);
        if (protectedRange) { cursor = protectedRange.end; continue; }
        const close = body.indexOf('%%', start + 2);
        cursor = close < 0 ? body.length : close + 2;
        comments.push({ start, end: cursor });
    }
    // Preserve newlines so code fences after a comment are still parsed at the right position.
    let visibleBody = body;
    for (const { start, end } of [...comments].reverse()) {
        visibleBody = visibleBody.slice(0, start) + visibleBody.slice(start, end).replace(/[^\r\n]/g, ' ') + visibleBody.slice(end);
    }
    // Converter filters do not apply here. Obsidian does not recognize purely numeric inline tags.
    return extractInlineTags(visibleBody, mergeRanges([...computeExclusionRanges(visibleBody), ...comments]), { hexColorFilter: false }, {
        shouldAdd: tag => !/^\p{N}+$/u.test(tag),
        shouldRemove: tag => !/^\p{N}+$/u.test(tag) && shouldRemove(tag)
    });
}

export async function contentFingerprint(content: string): Promise<string> {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
