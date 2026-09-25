import { App, TFile } from 'obsidian';
import { FolderMover, resolvePlacement } from '../folderPlacement';
import { readNoteTags } from '../organizer/noteTags';
import { TagDropBehavior, TagDropChoice, TagDropDecision, TagDropModal } from '../ui/tagDropModal';
import { editDroppedNoteTags } from './noteTagEdit';

interface DropOptions {
    enabled: () => boolean;
    exclusions: () => string[];
    behavior: () => TagDropBehavior;
    saveBehavior: (choice: TagDropChoice) => Promise<void>;
    renameFile?: (file: TFile, destination: string) => Promise<void>;
    selectTag?: (tag: string, shouldCancel: () => boolean) => Promise<boolean>;
    notify: (message: string) => void;
}

/** Serializes prompts and filing; snapshots are taken before this plugin or NN changes any tags. */
export class TagDropFiler {
    private queue: Promise<void> = Promise.resolve();
    private pending = 0;
    private generation = 0;
    private disposed = false;
    private modal: TagDropModal | null = null;

    constructor(private readonly app: App, private readonly mover: FolderMover, private readonly options: DropOptions) {}

    get busy(): boolean { return this.pending > 0; }

    enqueue(files: TFile[], tag: string): Promise<void> {
        if (this.disposed || !this.options.enabled()) return Promise.resolve();
        const generation = this.generation;
        const snapshots = files.map(file => ({
            file, source: file.path,
            content: this.app.vault.read(file).then(content => ({ content }), error => ({ error }))
        }));
        this.pending++;
        const result = this.queue.then(async () => {
            for (const snapshot of snapshots) {
                if (this.cancelled(generation)) break;
                try {
                    const read = await snapshot.content;
                    if ('error' in read) throw read.error;
                    await this.file(snapshot.file, snapshot.source, read.content, tag, generation);
                } catch (error) {
                    this.options.notify(`${snapshot.source}: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        }).finally(() => { this.pending--; });
        this.queue = result.catch(() => undefined);
        return result;
    }

    cancelPending(): void {
        this.generation++;
        this.modal?.close();
        this.modal = null;
    }

    dispose(): void { this.disposed = true; this.cancelPending(); }

    private cancelled(generation: number): boolean {
        return this.disposed || generation !== this.generation || !this.options.enabled();
    }

    private async file(file: TFile, source: string, before: string, tag: string, generation: number): Promise<void> {
        const available = (): boolean => !this.cancelled(generation)
            && file.path === source && this.app.vault.getAbstractFileByPath(source) === file;
        const current = async (): Promise<boolean> => available() && await this.app.vault.read(file) === before && available();
        if (!await current()) {
            if (!this.cancelled(generation)) this.options.notify(`${source}: note changed after the drop; try again.`);
            return;
        }
        const { tags } = readNoteTags(before);
        // No tags is also unambiguous. Saved behavior applies only to notes already having 2+ tags.
        let choice: TagDropBehavior = tags.length > 1 ? this.options.behavior() : 'move';
        let destination: string | undefined;
        let fallbackReason: string | undefined;
        if (choice !== 'add') {
            try {
                destination = resolvePlacement(this.app, file, tag, this.options.exclusions()).destination;
            } catch (error) {
                // Keep the normal additive drop when filing is excluded or a destination is blocked.
                choice = 'add';
                fallbackReason = error instanceof Error ? error.message : String(error);
            }
        }
        if (choice === 'ask') {
            const decision = await new Promise<TagDropDecision | null>(resolve => {
                this.modal = new TagDropModal(this.app, source, tag, resolve);
                this.modal.open();
            });
            this.modal = null;
            if (!decision || this.cancelled(generation)) return;
            if (!await current()) { this.options.notify(`${source}: note changed while the dialog was open; try the drop again.`); return; }
            choice = decision.choice;
            if (decision.remember) {
                try { await this.options.saveBehavior(choice); }
                catch { this.options.notify('Could not save your default. This choice applies to this note only.'); }
            }
        }
        if (!available()) return;
        const after = editDroppedNoteTags(before, tag, choice === 'move');
        if (choice === 'add') {
            if (after !== before) {
                await this.app.vault.process(file, content => {
                    if (!available() || content !== before) throw new Error('Note changed before the tag could be added; try again.');
                    return after;
                });
            }
            this.options.notify(fallbackReason
                ? `${source}: kept the folder and other tags. ${fallbackReason} #${tag} was added or already present.`
                : `${source}: #${tag} added or already present; folder and other tags kept.`);
            return;
        }
        const outcome = await this.mover.move({
            file, source, tag, destination: destination!, exclusions: this.options.exclusions,
            shouldCancel: () => this.cancelled(generation), isCurrent: current,
            renameFile: this.options.renameFile,
            ...(after !== before ? { contentChange: { before, after } } : {})
        });
        if (this.disposed) return;
        if (outcome.status === 'moved' || outcome.tagsUpdated) {
            this.options.notify(`${file.name}: kept only #${tag} and filed in ${tag}/.`);
            if (this.options.selectTag && !this.cancelled(generation)) {
                // Navigation failure must never undo a successful move or stop the remaining notes.
                let selected = false;
                try { selected = await this.options.selectTag(tag, () => this.cancelled(generation)); }
                catch { /* Keep the completed filing and report only the selection failure below. */ }
                if (!selected && !this.cancelled(generation)) {
                    this.options.notify(`${file.name} was filed, but Notebook Navigator could not select #${tag}.`);
                }
            }
        } else {
            this.options.notify(`${source}: ${outcome.reason ?? 'Not moved.'}`);
        }
    }
}
