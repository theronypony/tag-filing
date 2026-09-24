import { App, TFile } from 'obsidian';
import { NotebookNavigatorAPI } from '../nnApi';
import { hasValidTagCharacters } from '../utils/tagUtils';

export interface NavigatorNoteDrop { files: TFile[]; tag: string }

const NON_FILE_TYPES = [
    'application/x-notebook-navigator-tag', 'application/x-notebook-navigator-property', 'application/x-notebook-shortcut'
];

/** NN 3.4.1 has no public tag-drop event. Keep the DOM/data-transfer adapter isolated here. */
export function readNavigatorNoteDrop(app: App, api: NotebookNavigatorAPI | null, event: DragEvent): NavigatorNoteDrop | null {
    if (api?.getVersion?.().split('.')[0] !== '2' || !api.tagCollections || event.defaultPrevented) return null;
    // Avoid instanceof Element: a Navigator pane can live in a different window.
    const target = event.target as Element | null;
    const zone = target?.closest?.('[data-drop-zone]');
    if (!zone?.closest('[data-type="notebook-navigator"]') || zone.getAttribute('data-drop-zone') !== 'tag'
        || zone.getAttribute('data-allow-internal-drop') === 'false') return null;
    const rawTag = zone.getAttribute('data-drop-path');
    const canonical = zone.getAttribute('data-tag');
    if (!rawTag || api.tagCollections.isCollection(rawTag) || api.tagCollections.isCollection(canonical)) return null;
    const tag = rawTag.replace(/^#/, '').normalize('NFC');
    if (!hasValidTagCharacters(tag)) return null;
    const data = event.dataTransfer;
    if (!data || NON_FILE_TYPES.some(type => Array.from(data.types).includes(type))) return null;

    let paths: string[];
    try {
        // A URI also identifies the source vault: never interpret a cross-vault path as a local note.
        let uriPaths: string[] = [];
        for (const type of ['text/plain', 'text/uri-list']) {
            const items = data.getData(type).trim().split(/\r?\n|(?=obsidian:\/\/open\?)/)
                .filter(item => item && !item.startsWith('#'));
            if (!items.length || !items[0].startsWith('obsidian://open?')) continue;
            const parsedPaths: string[] = [];
            for (const item of items) {
                const uri = new URL(item);
                if (uri.protocol !== 'obsidian:' || uri.hostname !== 'open' || uri.searchParams.get('vault') !== app.vault.getName()) return null;
                const path = uri.searchParams.get('file');
                if (!path) return null;
                parsedPaths.push(path);
            }
            if (!uriPaths.length) uriPaths = parsedPaths;
        }
        const multiple = data.getData('obsidian/files');
        const single = data.getData('obsidian/file');
        if (multiple) {
            const parsed: unknown = JSON.parse(multiple);
            if (!Array.isArray(parsed) || parsed.some(path => typeof path !== 'string' || !path)) return null;
            paths = parsed;
        } else if (single) paths = [single];
        else paths = uriPaths;
        if (!paths.length) return null;
        const files = paths.map(path => {
            const exact = app.vault.getAbstractFileByPath(path);
            // NN omits .md from native URIs. A folder with the same basename is not that note.
            // Custom payloads contain exact paths; in those, a folder must remain a folder drag.
            return !multiple && !single && !(exact instanceof TFile)
                ? app.vault.getAbstractFileByPath(`${path}.md`) : exact;
        });
        if (files.some(file => !(file instanceof TFile) || file.extension !== 'md')) return null;
        return { files: [...new Set(files as TFile[])], tag };
    } catch { return null; }
}

export class NavigatorDropListener {
    private documents = new Set<Document>();
    constructor(private readonly app: App, private readonly api: () => NotebookNavigatorAPI | null,
        private readonly enabled: () => boolean, private readonly onDrop: (drop: NavigatorNoteDrop) => void) {}

    attach(document: Document): void {
        if (this.documents.has(document)) return;
        this.documents.add(document);
        document.addEventListener('drop', this.handleDrop, { capture: true });
    }

    detach(document: Document): void {
        document.removeEventListener('drop', this.handleDrop, { capture: true });
        this.documents.delete(document);
    }

    dispose(): void { for (const document of this.documents) this.detach(document); }

    private handleDrop = (event: DragEvent): void => {
        if (!this.enabled()) return;
        const drop = readNavigatorNoteDrop(this.app, this.api(), event);
        if (!drop) return;
        // Own only validated note-to-tag drops. NN's browser dragend still clears its drag session.
        event.preventDefault();
        event.stopImmediatePropagation();
        this.onDrop(drop);
    };
}
