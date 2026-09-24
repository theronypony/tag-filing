import { getFrontMatterInfo, parseYaml, stringifyYaml } from 'obsidian';
import { normalizeTagsValue } from '../frontmatter';
import { stripInlineTags } from '../converter/whitespaceCleanup';
import { extractNoteBodyTags, readNoteTags, tagKey } from '../organizer/noteTags';
import { hasValidTagCharacters } from '../utils/tagUtils';

/** Pure transformation; the caller commits it with Vault.process after revalidation. */
export function editDroppedNoteTags(content: string, rawTag: string, replace: boolean): string {
    const tag = rawTag.trim().replace(/^#/, '').normalize('NFC');
    if (!hasValidTagCharacters(tag)) throw new Error('Invalid target tag.');
    const { tags } = readNoteTags(content); // Reject malformed/ambiguous tag values before any edits.
    const hasTarget = tags.some(value => tagKey(value) === tagKey(tag));
    if (hasTarget && (!replace || tags.length === 1)) return content;

    const bom = content.startsWith('\uFEFF') ? '\uFEFF' : '';
    const text = content.slice(bom.length);
    const newline = text.includes('\r\n') ? '\r\n' : '\n';
    const info = getFrontMatterInfo(text);
    const properties: Record<string, unknown> = info.exists ? parseYaml(info.frontmatter) ?? {} : {};
    const keys = Object.keys(properties).filter(key => ['tags', 'tag'].includes(key.toLowerCase()));
    const targetKey = keys.find(key => key.toLowerCase() === 'tags') ?? 'tags';
    if (replace) {
        for (const key of keys) delete properties[key];
        properties[targetKey] = [tag];
    } else {
        properties[targetKey] = [...normalizeTagsValue(properties[targetKey]), tag];
    }
    let body = info.exists ? text.slice(info.contentStart) : text;
    if (replace) {
        const { removals } = extractNoteBodyTags(body, value => tagKey(value) !== tagKey(tag));
        body = stripInlineTags(body, removals);
    }
    // Obsidian's serializer retains unrelated property values, like processFrontMatter does.
    const yaml = stringifyYaml(properties).replace(/\r?\n/g, newline).replace(/[\r\n]+$/, '');
    return `${bom}---${newline}${yaml}${newline}---${newline}${body}`;
}
