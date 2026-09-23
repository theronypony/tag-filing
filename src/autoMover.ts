import { App, TAbstractFile, TFile } from 'obsidian';
import { FolderMover, isExcludedPath, resolvePlacement } from './folderPlacement';
import { NotebookNavigatorAPI } from './nnApi';
import { readNoteTags, tagKey } from './organizer/noteTags';

const CREATION_WINDOW_MS = 30_000;
const OPEN_SETTLE_MS = 250;

interface PendingNote {
    path: string;
    tag: string;
    expires: number;
}

/** Reads a concrete selection only. Folder/property/aggregate selections never reuse a cached tag. */
export function selectedNavigatorTag(api: NotebookNavigatorAPI | null): string | null {
    try {
        if (api?.getVersion?.().split('.')[0] !== '2') return null;
        const item = api.selection?.getNavItem();
        if (item?.type !== 'tag' || !item.tag?.trim()) return null;
        if (['__tagged__', '__untagged__'].includes(item.tag) || api.tagCollections?.isCollection(item.tag)) return null;
        return item.tag.trim().replace(/^#/, '');
    } catch {
        return null;
    }
}

/**
 * Watches creation followed by a local file-open, the sequence used by NN's new-note command.
 * Never writes a tag and never files a background create/sync event on its own.
 * This is deliberately bounded, not a claim that Obsidian exposes a creation-device identifier.
 */
export class AutoMover {
    private pending = new Map<TFile, PendingNote>();
    private timers = new Set<number>();
    private disposed = false;

    constructor(
        private readonly app: App,
        private readonly mover: FolderMover,
        private readonly getApi: () => NotebookNavigatorAPI | null,
        private readonly canMove: () => boolean,
        private readonly exclusions: () => string[],
        private readonly report: (message: string) => void
    ) {}

    handleCreate(file: TAbstractFile): void {
        this.prune();
        if (this.disposed || !this.canMove() || !(file instanceof TFile) || file.extension !== 'md') return;
        const now = Date.now();
        if (now - file.stat.ctime > CREATION_WINDOW_MS || file.stat.ctime > now + 5000) return;
        if (isExcludedPath(file.path, [...this.exclusions(), this.app.vault.configDir])) return;
        const tag = selectedNavigatorTag(this.getApi());
        if (!tag) return;
        // Bound memory even during a large sync/import.
        if (this.pending.size >= 500) this.pending.delete(this.pending.keys().next().value!);
        this.pending.set(file, { path: file.path, tag, expires: now + CREATION_WINDOW_MS });
    }

    handleOpen(file: TFile | null): void {
        this.prune();
        if (!file || this.disposed || !this.canMove()) return;
        const candidate = this.pending.get(file);
        if (!candidate) return;
        this.pending.delete(file);
        // Let NN finish opening the editor/cursor before changing its file path.
        const timer = window.setTimeout(() => {
            this.timers.delete(timer);
            void this.place(file, candidate);
        }, OPEN_SETTLE_MS);
        this.timers.add(timer);
    }

    private async place(file: TFile, candidate: PendingNote): Promise<void> {
        const cancelled = (): boolean => this.disposed || !this.canMove();
        if (cancelled() || file.path !== candidate.path || Date.now() > candidate.expires) return;
        try {
            const hasSelectedTag = async (): Promise<boolean> => readNoteTags(await this.app.vault.read(file))
                .frontmatterTags.some(tag => tagKey(tag) === tagKey(candidate.tag));
            // NN supplies the tag before opening the file. The standard Obsidian command does not.
            if (!await hasSelectedTag()) return;
            const placement = resolvePlacement(this.app, file, candidate.tag, this.exclusions());
            if (placement.destination === file.path) return;
            const result = await this.mover.move({
                file, source: candidate.path, tag: candidate.tag, destination: placement.destination,
                exclusions: this.exclusions, shouldCancel: cancelled, isCurrent: hasSelectedTag
            });
            if (result.status !== 'moved' && !cancelled()) this.report(`${file.name}: ${result.reason}`);
        } catch (error) {
            if (!cancelled()) this.report(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    prune(): void {
        const now = Date.now();
        for (const [file, candidate] of this.pending) {
            if (candidate.expires < now || !this.canMove()) this.pending.delete(file);
        }
    }

    clearPending(): void {
        this.pending.clear();
        for (const timer of this.timers) window.clearTimeout(timer);
        this.timers.clear();
    }

    dispose(): void {
        this.disposed = true;
        this.clearPending();
    }
}
