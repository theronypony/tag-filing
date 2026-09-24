import { App, Modal, Setting } from 'obsidian';

export const FOLDER_SETUP_VERSION = 2;

/** Upgrade/first-run onboarding; accepting confirms the new command workflow, not a bulk move. */
export function showFolderSetup(app: App): Promise<boolean> {
    return new Promise(resolve => new FolderSetupModal(app, resolve).open());
}

class FolderSetupModal extends Modal {
    private resolved = false;
    constructor(app: App, private readonly resolve: (enable: boolean) => void) { super(app); }

    onOpen(): void {
        this.contentEl.createEl('h2', { text: 'Set up tag-based folders' });
        this.contentEl.createEl('p', { text: 'Tag Filing does not add tags to new notes. Notebook Navigator adds the tag; Tag Filing files the note in its matching folder.' });
        const list = this.contentEl.createEl('ol');
        list.createEl('li', { text: 'Install and enable Notebook Navigator 3.4.1 or later (API 2.x), on Obsidian 1.11 or later.' });
        list.createEl('li', { text: 'Open Settings → Hotkeys and search “Create new note”. Remove Command-N (Mac) or Ctrl-N (Windows/Linux) from Obsidian’s Create new note command.' });
        list.createEl('li', { text: 'Assign that shortcut to Notebook Navigator: Create new note. You must use Navigator’s command for automatic tagging and folder placement.' });
        list.createEl('li', { text: 'Select a tag in Navigator and run its Create new note command. For example, #work/meetings files the new note in work/meetings/ inside your vault.' });
        this.contentEl.createEl('p', { text: 'Missing folders are created automatically. Excluded folders are skipped. A filename conflict leaves the note where it is. Existing notes are organized separately with a preview and two backup warnings.' });
        this.contentEl.createEl('p', { text: 'On desktop, dropping an existing note onto a Navigator tag also files it. Notes with zero or one tag switch to the target tag automatically; notes already having multiple tags ask first. You can turn tag-drop filing off or save a multi-tag default in settings, independently of new-note filing.' });
        new Setting(this.contentEl)
            .addButton(button => button.setButtonText('Keep automatic filing off').onClick(() => this.finish(false)))
            .addButton(button => button.setButtonText('NN command configured — enable filing').setCta().onClick(() => this.finish(true)));
    }

    private finish(enabled: boolean): void {
        this.resolved = true;
        this.resolve(enabled);
        this.close();
    }
    onClose(): void {
        this.contentEl.empty();
        if (!this.resolved) this.resolve(false);
    }
}
