import { describe, expect, it } from 'vitest';
import { readNoteTags } from '../src/organizer/noteTags';
import { note } from './helpers/vault';

describe('folder organizer tag counting', () => {
    it('deduplicates frontmatter and repeated inline tags without regard to case or Unicode normalization', () => {
        const result = readNoteTags(note({ Tags: ['#Cafe\u0301/Work', 'CAFÉ/work'] }, '#café/WORK #café/work'));
        expect(result.tags).toHaveLength(1);
        expect(result.frontmatterTags).toHaveLength(1);
    });

    it('counts explicit parent and child separately without inventing implicit parents', () => {
        expect(readNoteTags('#work/meetings').tags).toEqual(['work/meetings']);
        expect(readNoteTags(note({ tags: ['work'] }, '#work/meetings')).tags).toEqual(['work', 'work/meetings']);
    });

    it('reads list, string, capitalized and legacy tag properties', () => {
        expect(readNoteTags(note({ Tags: '#work, home', tag: ['travel'], description: '#ignore' })).tags)
            .toEqual(['work', 'home', 'travel']);
    });

    it('keeps hex-like tags regardless of the converter settings, and rejects purely numeric inline text', () => {
        expect(readNoteTags('#work #abc #FF5733 #2024 #1').tags).toEqual(['work', 'abc', 'FF5733']);
    });

    it('ignores comments, code, HTML attributes and escaped hashes', () => {
        const content = ['#work', '%% #comment %%', '`#inline-code`', '```js', '#fenced-code', '```',
            '<span title="#attribute">text</span>', '<!-- #html-comment -->', '<pre> #raw </pre>', '\\#escaped'].join('\n');
        expect(readNoteTags(content).tags).toEqual(['work']);
    });

    it('does not let comment markers inside code hide a second real tag', () => {
        expect(readNoteTags('#work\n`%%`\n#home').tags).toEqual(['work', 'home']);
        expect(readNoteTags('#work\n```\n%%\n```\n#home').tags).toEqual(['work', 'home']);
    });

    it('does not let code markers inside comments hide a second real tag', () => {
        expect(readNoteTags('#work\n%%\n```\n%%\n#home').tags).toEqual(['work', 'home']);
    });

    it('handles BOM and CRLF without leaking frontmatter text into inline tags', () => {
        const content = '\uFEFF' + note({ tags: 'work', description: '#home' }, '#work').replace(/\n/g, '\r\n');
        expect(readNoteTags(content).tags).toEqual(['work']);
    });

    it.each([
        '---\n{"tags": ["work"]}\n#home',
        '---\ninvalid-yaml: [\n---\n#work',
        note({ tags: ['work', 2] }),
        note({ tags: ['work', 'bad//tag'] }),
        note(['work'])
    ])('rejects unreadable or invalid frontmatter instead of undercounting tags', content => {
        expect(() => readNoteTags(content)).toThrow();
    });
});
