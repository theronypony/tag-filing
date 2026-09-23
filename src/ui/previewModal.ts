import { App, Modal, Setting } from 'obsidian';
import { FilePreview } from '../converter/inlineTagConverter';

export type PreviewAction = 'proceed' | 'cancel';

/**
 * Shows the dry-run preview report. Resolves with the chosen action.
 * `onExport` is invoked when the user exports the report; the modal stays open.
 */
export function showPreview(app: App, previews: FilePreview[], onExport: () => Promise<void>): Promise<PreviewAction> {
    return new Promise(resolve => {
        new PreviewModal(app, previews, onExport, resolve).open();
    });
}

class PreviewModal extends Modal {
    private resolved = false;

    constructor(
        app: App,
        private readonly previews: FilePreview[],
        private readonly onExport: () => Promise<void>,
        private readonly resolve: (action: PreviewAction) => void
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'Inline tag conversion — preview' });

        const fileCount = this.previews.length;
        const tagCount = this.previews.reduce((sum, p) => sum + p.removedTokenCount, 0);

        if (fileCount === 0) {
            contentEl.createEl('p', { text: 'No inline tags were found in the selected notes. Nothing to convert.' });
            new Setting(contentEl).addButton(button =>
                button
                    .setButtonText('Close')
                    .setCta()
                    .onClick(() => this.finish('cancel'))
            );
            return;
        }

        contentEl.createEl('p', {
            text: `${fileCount} ${fileCount === 1 ? 'file' : 'files'} would be modified; ${tagCount} inline ${tagCount === 1 ? 'tag' : 'tags'} would be removed and merged into frontmatter.`
        });

        const list = contentEl.createDiv({ cls: 'tag-filing-preview-list' });

        for (const preview of this.previews) {
            const item = list.createDiv({ cls: 'tag-filing-preview-item' });
            item.createEl('div', { text: preview.path, cls: 'tag-filing-preview-path' });

            const addLine = item.createEl('div', { cls: 'tag-filing-detail' });
            if (preview.tagsToAdd.length > 0) {
                addLine.setText(`add to frontmatter: ${preview.tagsToAdd.join(', ')}`);
            } else {
                // No new frontmatter tags: either already present, or one-off tags being discarded.
                addLine.setText('no new frontmatter tags (inline tokens will still be removed)');
            }

            const removeLine = item.createEl('div', { cls: 'tag-filing-detail-muted' });
            removeLine.setText(`remove ${preview.removedTokenCount} inline ${preview.removedTokenCount === 1 ? 'token' : 'tokens'} from body`);
        }

        new Setting(contentEl)
            .addButton(button =>
                button.setButtonText('Cancel').onClick(() => this.finish('cancel'))
            )
            .addButton(button =>
                button.setButtonText('Export report').onClick(async () => {
                    button.setDisabled(true);
                    try {
                        await this.onExport();
                    } finally {
                        button.setDisabled(false);
                    }
                })
            )
            .addButton(button =>
                button
                    .setButtonText('Proceed to conversion')
                    .setCta()
                    .onClick(() => this.finish('proceed'))
            );
    }

    private finish(action: PreviewAction): void {
        this.resolved = true;
        this.resolve(action);
        this.close();
    }

    onClose(): void {
        this.contentEl.empty();
        if (!this.resolved) {
            this.resolve('cancel');
        }
    }
}
