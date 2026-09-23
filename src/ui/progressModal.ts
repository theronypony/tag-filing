import { App, Modal, Setting } from 'obsidian';
import { ProgressInfo } from '../converter/inlineTagConverter';

/**
 * Non-blocking progress modal for the conversion run. Exposes a cancel flag the converter polls.
 * Closing the modal (button, Escape, or click-away) requests cancellation.
 */
export class ProgressModal extends Modal {
    private cancelled = false;
    private startTime = 0;
    private statusEl: HTMLElement | null = null;
    private etaEl: HTMLElement | null = null;
    private barFill: HTMLElement | null = null;
    /** Set true by the owner once the run finishes, so the auto-close doesn't read as a cancel. */
    private completed = false;

    constructor(app: App, private readonly title = 'Converting inline tags to frontmatter', private readonly showTags = true) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        this.startTime = Date.now();
        contentEl.createEl('h2', { text: this.title });

        this.statusEl = contentEl.createEl('p', { text: 'Starting…' });

        const barTrack = contentEl.createDiv({ cls: 'tag-filing-progress-track' });
        this.barFill = barTrack.createDiv({ cls: 'tag-filing-progress-fill' });

        this.etaEl = contentEl.createEl('p', { text: '', cls: 'tag-filing-detail-muted' });

        new Setting(contentEl).addButton(button =>
            button.setButtonText('Cancel').setWarning().onClick(() => {
                this.cancelled = true;
                this.close();
            })
        );
    }

    /** Polled by the converter; returns true once cancellation has been requested. */
    isCancelled(): boolean {
        return this.cancelled;
    }

    /** Called by the owner immediately before closing on normal completion. */
    markCompleted(): void {
        this.completed = true;
    }

    update(info: ProgressInfo): void {
        const { processed, total, tagsFound, currentPath } = info;
        if (this.statusEl) {
            this.statusEl.setText(`Processing file ${processed} of ${total}…${this.showTags ? ` (${tagsFound} tags found so far)` : ''}`);
        }
        if (this.barFill) {
            const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
            this.barFill.setCssStyles({ width: `${pct}%` });
        }
        if (this.etaEl) {
            this.etaEl.setText(this.formatEta(processed, total, currentPath));
        }
    }

    private formatEta(processed: number, total: number, currentPath: string): string {
        if (processed === 0) {
            return currentPath;
        }
        const elapsed = Date.now() - this.startTime;
        const rate = processed / elapsed; // files per ms
        const remainingFiles = total - processed;
        const remainingMs = rate > 0 ? remainingFiles / rate : 0;
        return `~${formatDuration(remainingMs)} remaining · ${currentPath}`;
    }

    onClose(): void {
        // Closing before completion (Escape / click-away / Cancel) requests cancellation.
        if (!this.completed) {
            this.cancelled = true;
        }
        this.contentEl.empty();
    }
}

function formatDuration(ms: number): string {
    const totalSeconds = Math.max(0, Math.round(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
}
