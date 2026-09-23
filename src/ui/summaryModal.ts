import { App, Modal, Setting } from 'obsidian';
import { ConversionResult } from '../converter/inlineTagConverter';

export interface SummaryData {
    results: ConversionResult[];
    cancelled: boolean;
    logPath: string | null;
}

/** Shows the post-conversion summary with stats and a failures list. */
export function showSummary(app: App, data: SummaryData): void {
    new SummaryModal(app, data).open();
}

class SummaryModal extends Modal {
    constructor(
        app: App,
        private readonly data: SummaryData
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        const { results, cancelled, logPath } = this.data;

        const ok = results.filter(r => r.status === 'ok');
        const skipped = results.filter(r => r.status === 'skipped');
        const failed = results.filter(r => r.status === 'failed');
        const tagsConverted = ok.reduce((sum, r) => sum + r.extractedTags.length, 0);

        contentEl.createEl('h2', { text: cancelled ? 'Conversion cancelled' : 'Conversion complete' });

        contentEl.createEl('p', {
            text:
                `Converted ${tagsConverted} inline ${tagsConverted === 1 ? 'tag' : 'tags'} across ${ok.length} ` +
                `${ok.length === 1 ? 'file' : 'files'}. ${skipped.length} skipped (no inline tags). ` +
                `${failed.length} failed.`
        });

        if (failed.length > 0) {
            contentEl.createEl('h3', { text: 'Failures' });
            const list = contentEl.createDiv({ cls: 'tag-filing-summary-failures' });
            for (const failure of failed) {
                const row = list.createEl('div', { cls: 'tag-filing-detail' });
                row.setText(`${failure.path} — ${failure.error ?? 'unknown error'}`);
            }
        }

        if (logPath) {
            const note = contentEl.createEl('p', { cls: 'tag-filing-detail-muted' });
            note.setText(`Transaction log written to: ${logPath}`);
        }

        new Setting(contentEl).addButton(button =>
            button
                .setButtonText('Close')
                .setCta()
                .onClick(() => this.close())
        );
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
