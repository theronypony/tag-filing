import { App, Modal, Setting } from 'obsidian';

interface ConfirmOptions {
    title: string;
    body: string;
    cancelText: string;
    confirmText: string;
}

/**
 * Shows a single confirmation dialog. Cancel is the default (safe) action.
 * Resolves true only if the user clicks the confirm button.
 */
function confirmOnce(app: App, options: ConfirmOptions): Promise<boolean> {
    return new Promise(resolve => {
        new ConfirmDialog(app, options, resolve).open();
    });
}

/**
 * Shows the two sequential safety dialogs required before destructive conversion. Resolves true only
 * if the user confirms both. Resolves false if either is cancelled.
 */
export async function confirmConversion(app: App, fileCount: number): Promise<boolean> {
    const first = await confirmOnce(app, {
        title: 'Convert inline tags?',
        body:
            `This will modify ${fileCount} markdown ${fileCount === 1 ? 'note' : 'notes'}. ` +
            'Inline #tag text will be moved to frontmatter, and the original inline tags will be ' +
            'removed from the body.\n\nBack up your vault before proceeding. Do you understand and wish to continue?',
        cancelText: 'Cancel',
        confirmText: 'I understand, continue'
    });
    if (!first) {
        return false;
    }

    return confirmOnce(app, {
        title: 'Are you absolutely sure?',
        body: 'This operation cannot be undone without a backup. Have you backed up your vault?',
        cancelText: 'Cancel',
        confirmText: 'Yes, I have backed up — proceed'
    });
}

/** Both backup confirmations are required for every manual move run. */
export async function confirmFolderMoves(app: App, fileCount: number): Promise<boolean> {
    if (fileCount <= 0) return false;
    const first = await confirmOnce(app, {
        title: 'Move notes to matching folders?',
        body: `This will move ${fileCount} Markdown notes and create missing folders. ` +
            'Obsidian may update links according to your settings.\n\n' +
            'Back up your entire vault before proceeding.',
        cancelText: 'Cancel',
        confirmText: 'I understand, continue'
    });
    if (!first) return false;
    return confirmOnce(app, {
        title: 'Are you absolutely sure?',
        body: 'This tool has no automatic undo. Have you backed up your entire vault before moving these notes?',
        cancelText: 'Cancel',
        confirmText: 'Yes, I have backed up — proceed'
    });
}

class ConfirmDialog extends Modal {
    private resolved = false;

    constructor(
        app: App,
        private readonly options: ConfirmOptions,
        private readonly resolve: (value: boolean) => void
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: this.options.title });
        // Preserve paragraph breaks from the body text.
        for (const paragraph of this.options.body.split(/\n\n|\\n\\n/)) {
            contentEl.createEl('p', { text: paragraph });
        }

        new Setting(contentEl)
            .addButton(button =>
                button
                    .setButtonText(this.options.cancelText)
                    .setCta()
                    .onClick(() => this.finish(false))
            )
            .addButton(button =>
                button.setButtonText(this.options.confirmText).setWarning().onClick(() => this.finish(true))
            );
    }

    private finish(value: boolean): void {
        this.resolved = true;
        this.resolve(value);
        this.close();
    }

    onClose(): void {
        this.contentEl.empty();
        if (!this.resolved) {
            this.resolve(false);
        }
    }
}
