import { App, Modal, Setting } from 'obsidian';

export type TagDropChoice = 'move' | 'add';
export type TagDropBehavior = 'ask' | TagDropChoice;
export interface TagDropDecision { choice: TagDropChoice; remember: boolean }

export class TagDropModal extends Modal {
    private resolved = false;
    private remember = false;

    constructor(app: App, private readonly path: string, private readonly tag: string,
        private readonly resolve: (decision: TagDropDecision | null) => void) { super(app); }

    onOpen(): void {
        this.contentEl.createEl('h2', { text: `Move to #${this.tag} and remove all other tags?` });
        this.contentEl.createEl('p', { text: this.path });
        this.contentEl.createEl('p', {
            text: `Yes keeps only #${this.tag}, removes other tags from properties and note text, and moves this note to ${this.tag}/. No adds the tag and keeps the current folder and other tags.`
        });
        const label = this.contentEl.createEl('label', { cls: 'tag-filing-remember-choice' });
        const checkbox = label.createEl('input', { type: 'checkbox' });
        checkbox.addEventListener('change', () => { this.remember = checkbox.checked; });
        label.appendText(' Save my choice as the default for multi-tag notes');
        this.contentEl.createEl('p', { text: 'Change this later in Tag Filing settings. Closing this dialog cancels this note’s drop.', cls: 'tag-filing-detail-muted' });
        new Setting(this.contentEl)
            .addButton(button => button.setButtonText('Yes').onClick(() => this.finish('move')))
            .addButton(button => button.setButtonText('No, just add the tag').setCta().onClick(() => this.finish('add')));
    }

    private finish(choice: TagDropChoice): void {
        this.resolved = true;
        this.resolve({ choice, remember: this.remember });
        this.close();
    }

    onClose(): void {
        if (!this.resolved) this.resolve(null);
        this.contentEl.empty();
    }
}
