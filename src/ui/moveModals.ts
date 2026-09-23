import { App, Modal, Setting } from 'obsidian';
import { MovePreview, MoveResult } from '../organizer/singleTagOrganizer';

export function showMovePreview(app: App, rows: MovePreview[], onExport: () => Promise<void>): Promise<boolean> {
    return new Promise(resolve => new MovePreviewModal(app, rows, onExport, resolve).open());
}

class MovePreviewModal extends Modal {
    private resolved = false;
    private page = 0;
    private readonly pageSize = 100;
    constructor(app: App, private readonly rows: MovePreview[], private readonly onExport: () => Promise<void>,
        private readonly resolve: (proceed: boolean) => void) { super(app); }

    onOpen(): void { this.render(); }
    private render(): void {
        const content = this.contentEl;
        content.empty();
        content.createEl('h2', { text: 'Move single-tag notes — preview' });
        const ready = this.rows.filter(row => row.status === 'ready').length;
        content.createEl('p', { text: `${ready} notes ready to move; ${this.rows.length - ready} skipped. No notes or folders have been changed.` });
        const list = content.createDiv({ cls: 'inherit-tags-preview-list' });
        const ordered = [...this.rows.filter(row => row.status === 'ready'), ...this.rows.filter(row => row.status !== 'ready')];
        for (const row of ordered.slice(this.page * this.pageSize, (this.page + 1) * this.pageSize)) {
            const item = list.createDiv({ cls: 'inherit-tags-preview-item' });
            item.createEl('div', { text: row.source, cls: 'inherit-tags-preview-path' });
            item.createEl('div', { text: row.status === 'ready' ? `#${row.tag} → ${row.destination}` : `Skip: ${row.reason}`, cls: 'inherit-tags-detail' });
            if (row.status === 'ready' && row.missingFolders.length) {
                item.createEl('div', { text: `Create folders: ${row.missingFolders.join(', ')}`, cls: 'inherit-tags-detail-muted' });
            }
        }
        const pageCount = Math.max(1, Math.ceil(this.rows.length / this.pageSize));
        if (pageCount > 1) {
            new Setting(content).setName(`Page ${this.page + 1} of ${pageCount}`)
                .addButton(button => button.setButtonText('Previous').setDisabled(this.page === 0).onClick(() => { this.page--; this.render(); }))
                .addButton(button => button.setButtonText('Next').setDisabled(this.page + 1 === pageCount).onClick(() => { this.page++; this.render(); }));
        }
        new Setting(content)
            .addButton(button => button.setButtonText(ready ? 'Cancel' : 'Close').onClick(() => this.finish(false)))
            .addButton(button => button.setButtonText('Export report').onClick(async () => {
                button.setDisabled(true);
                try { await this.onExport(); } finally { button.setDisabled(false); }
            }))
            .addButton(button => button.setButtonText(`Proceed to move ${ready} notes…`).setCta().setDisabled(ready === 0).onClick(() => this.finish(true)));
    }
    private finish(proceed: boolean): void {
        this.resolved = true;
        this.resolve(proceed);
        this.close();
    }
    onClose(): void {
        this.contentEl.empty();
        if (!this.resolved) this.resolve(false);
    }
}

export function showMoveSummary(app: App, results: MoveResult[], cancelled: boolean, logPath: string | null, error?: string): void {
    const modal = new Modal(app);
    modal.contentEl.createEl('h2', { text: error ? 'Folder moves stopped' : cancelled ? 'Folder moves cancelled' : 'Folder moves complete' });
    const count = (status: MoveResult['status']): number => results.filter(row => row.status === status).length;
    modal.contentEl.createEl('p', { text: `${count('moved')} moved, ${count('skipped')} skipped, ${count('failed')} failed, ${count('pending') + count('moving')} unprocessed or incomplete.` });
    if (error) modal.contentEl.createEl('p', { text: error });
    const problems = results.filter(row => row.status === 'failed' || (row.status === 'skipped' && row.destination));
    if (problems.length) {
        const list = modal.contentEl.createDiv({ cls: 'inherit-tags-summary-failures' });
        for (const row of problems.slice(0, 100)) list.createEl('p', { text: `${row.source}: ${row.reason ?? 'Skipped'}` });
        if (problems.length > 100) list.createEl('p', { text: 'See the log for the remaining entries.' });
    }
    if (logPath) modal.contentEl.createEl('p', { text: `Log: ${logPath}${error ? ' (check for incomplete entries)' : ''}`, cls: 'inherit-tags-detail-muted' });
    new Setting(modal.contentEl).addButton(button => button.setButtonText('Close').onClick(() => modal.close()));
    modal.open();
}
