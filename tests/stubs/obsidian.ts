// Obsidian has no Node runtime. These test doubles exercise our logic and dialog wiring.
// Frontmatter fixtures use JSON (valid YAML); YAML parsing itself belongs to Obsidian.
export class App {}
export class TAbstractFile {
    path = '';
    name = '';
    parent: TFolder | null = null;
}
export class TFile extends TAbstractFile {
    extension = 'md';
    basename = '';
    stat = { ctime: Date.now(), mtime: Date.now(), size: 0 };
}
export class TFolder extends TAbstractFile { children: TAbstractFile[] = []; }

export class TestElement {
    children: TestElement[] = [];
    buttons: TestButton[] = [];
    text = '';
    styles: Record<string, string> = {};
    createEl(_tag: string, options: { text?: string } = {}) {
        const child = new TestElement();
        child.text = options.text ?? '';
        this.children.push(child);
        return child;
    }
    createDiv(options = {}) { return this.createEl('div', options); }
    empty() { this.children = []; this.buttons = []; }
    setText(text: string) { this.text = text; }
    setCssStyles(styles: Record<string, string>) { this.styles = styles; }
    addClass() {}
    toggle() {}
    appendText(text: string) { this.text += text; }
    allText(): string { return [this.text, ...this.children.map(child => child.allText())].join('\n'); }
    allButtons(): TestButton[] { return [...this.buttons, ...this.children.flatMap(child => child.allButtons())]; }
}
export class TestButton {
    text = '';
    disabled = false;
    cta = false;
    warning = false;
    callback: () => unknown = () => {};
    setButtonText(text: string) { this.text = text; return this; }
    setDisabled(disabled: boolean) { this.disabled = disabled; return this; }
    setCta() { this.cta = true; return this; }
    setWarning() { this.warning = true; return this; }
    onClick(callback: () => unknown) { this.callback = callback; return this; }
    async click() { if (!this.disabled) await this.callback(); }
}
export class Setting {
    settingEl: TestElement;
    controlEl: TestElement;
    constructor(container: TestElement) {
        this.settingEl = container.createDiv();
        this.controlEl = this.settingEl.createDiv();
    }
    setName(name: string) { this.settingEl.createEl('div', { text: name }); return this; }
    setDesc(desc: string) { this.settingEl.createEl('div', { text: desc }); return this; }
    setHeading() { return this; }
    addButton(callback: (button: TestButton) => unknown) {
        const button = new TestButton();
        this.controlEl.buttons.push(button);
        callback(button);
        return this;
    }
}
export class Modal {
    static opened: Modal[] = [];
    contentEl = new TestElement();
    constructor(public app: App) {}
    onOpen() {}
    onClose() {}
    open() { Modal.opened.push(this); this.onOpen(); }
    close() {
        Modal.opened = Modal.opened.filter(modal => modal !== this);
        this.onClose();
    }
}
export class Plugin {
    commands: { id: string; callback: () => unknown }[] = [];
    storedData: unknown = null;
    intervals: number[] = [];
    constructor(public app: App, public manifest = { id: 'inherit-tags', dir: '.obsidian/plugins/inherit-tags' }) {}
    addSettingTab() {}
    addCommand(command: { id: string; callback: () => unknown }) { this.commands.push(command); }
    registerEvent() {}
    registerInterval(id: number) { this.intervals.push(id); }
    async loadData() { return this.storedData; }
    async saveData(data: unknown) { this.storedData = structuredClone(data); }
}
export class PluginSettingTab {
    containerEl = new TestElement();
    constructor(public app: App, public plugin: Plugin) {}
}
export class Notice {
    static messages: string[] = [];
    constructor(message: string) { Notice.messages.push(message); }
}

export function parseYaml(text: string): unknown { return text.trim() ? JSON.parse(text) : null; }
export function getFrontMatterInfo(text: string) {
    const opening = /^---[ \t]*\r?\n/.exec(text);
    const closing = opening && /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(text.slice(opening[0].length));
    if (!opening || !closing) return { exists: false, frontmatter: '', from: 0, to: 0, contentStart: 0 };
    const from = opening[0].length;
    const to = from + closing.index;
    return { exists: true, frontmatter: text.slice(from, to), from, to, contentStart: to + closing[0].length };
}
