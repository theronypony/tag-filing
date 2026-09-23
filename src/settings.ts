import { App, PluginSettingTab, Setting } from 'obsidian';
import { tryCompileRegex } from './converter/tagExtractor';
import { FOLDER_SETUP_VERSION } from './ui/folderSetupModal';

/** Persisted plugin settings. */
export interface TagFilingSettings {
    autoMoveEnabled: boolean;
    onboardingVersion: number;
    /** Comma-separated folder paths excluded from automatic and manual filing. */
    excludeFolders: string;
    /** Feature B: skip hex-color-looking tokens (`#FF5733`) during conversion. */
    hexColorFilter: boolean;
    /** Feature B: skip short numeric tokens (`#1`–`#999`) during conversion. */
    skipShortNumericTags: boolean;
    /** Feature B: user-supplied regex; inline tags whose name matches are skipped. */
    customExcludeRegex: string;
    /** Feature B: only convert inline tags already established elsewhere in the vault. */
    convertExistingOnly: boolean;
    /** Feature B: when existing-only, also strip one-off inline tags (without adding them). */
    stripSingleNoteTags: boolean;
}

export const DEFAULT_SETTINGS: TagFilingSettings = {
    autoMoveEnabled: false,
    onboardingVersion: 0,
    excludeFolders: '',
    hexColorFilter: true,
    skipShortNumericTags: false,
    customExcludeRegex: '',
    convertExistingOnly: false,
    stripSingleNoteTags: false
};

/** Explicit migration retains converter preferences and exclusions but drops the removed auto-tagger switch. */
export function migrateSettings(raw: unknown): TagFilingSettings {
    const data = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const settings = { ...DEFAULT_SETTINGS };
    for (const key of ['excludeFolders', 'customExcludeRegex'] as const) {
        if (typeof data[key] === 'string') settings[key] = data[key] as string;
    }
    for (const key of ['hexColorFilter', 'skipShortNumericTags', 'convertExistingOnly', 'stripSingleNoteTags'] as const) {
        if (typeof data[key] === 'boolean') settings[key] = data[key] as boolean;
    }
    if (data.onboardingVersion === FOLDER_SETUP_VERSION) {
        settings.onboardingVersion = FOLDER_SETUP_VERSION;
        settings.autoMoveEnabled = data.autoMoveEnabled === true;
    }
    return settings;
}

/** Parses the comma-separated exclude-folders string into a trimmed, non-empty list. */
export function parseExcludeFolders(raw: string): string[] {
    return raw
        .split(',')
        .map(part => part.trim())
        .filter(part => part.length > 0);
}

/** Minimal surface the settings tab needs from the plugin (avoids a circular import). */
export interface TagFilingPluginLike {
    app: App;
    settings: TagFilingSettings;
    saveSettings(): Promise<void>;
    runConverter(): void;
    runOrganizer(): void;
    showSetup(): Promise<void>;
}

export class TagFilingSettingTab extends PluginSettingTab {
    constructor(
        app: App,
        private readonly plugin: TagFilingPluginLike
    ) {
        // PluginSettingTab expects a Plugin; TagFilingPlugin satisfies it at runtime.
        super(app, plugin as unknown as import('obsidian').Plugin);
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl).setName('Tag-based folders').setHeading();

        new Setting(containerEl).setDesc(
            'Use Notebook Navigator: Create new note. Navigator adds the selected tag; Tag Filing files the note. Obsidian’s standard Create new note command does not provide that tag.'
        );

        new Setting(containerEl).setName('Set up the Navigator command')
            .setDesc('Includes Command-N / Ctrl-N instructions. The automatic tag writer was removed in version 2.')
            .addButton(button => button.setButtonText('Show setup…').onClick(async () => {
                await this.plugin.showSetup();
                this.display();
            }));

        new Setting(containerEl)
            .setName('Automatically file new Navigator notes')
            .setDesc('Move newly created notes to the selected tag’s folder after Navigator tags and opens them. Missing folders are created automatically.')
            .addToggle(toggle =>
                toggle.setValue(this.plugin.settings.autoMoveEnabled).onChange(async value => {
                    if (value && this.plugin.settings.onboardingVersion !== FOLDER_SETUP_VERSION) {
                        toggle.setValue(false);
                        await this.plugin.showSetup();
                        this.display();
                        return;
                    }
                    this.plugin.settings.autoMoveEnabled = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName('Exclude folders')
            .setDesc('Source and destination folders excluded from automatic and manual filing, including subfolders (e.g. "Templates, Archive").')
            .addText(text =>
                text
                    .setPlaceholder('Templates, Archive')
                    .setValue(this.plugin.settings.excludeFolders)
                    .onChange(async value => {
                        this.plugin.settings.excludeFolders = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl).setName('Organize existing notes')
            .setDesc('Preview notes with exactly one distinct tag across frontmatter and body. Requires two backup confirmations before moving anything. Works without Navigator.')
            .addButton(button => button.setButtonText('Preview moves…').onClick(() => this.plugin.runOrganizer()));

        new Setting(containerEl).setName('Inline tag converter').setHeading();

        new Setting(containerEl)
            .setName('Hex color filter')
            .setDesc('Skip tokens that look like hex colors (e.g. #FF5733) when converting inline tags. Note: this also filters out 3–8 digit numbers, including years like #2024.')
            .addToggle(toggle =>
                toggle.setValue(this.plugin.settings.hexColorFilter).onChange(async value => {
                    this.plugin.settings.hexColorFilter = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName('Skip short numeric tags')
            .setDesc('Ignore inline tags that are just 1–3 digit numbers (#1–#999), e.g. "Session #1". Leaves 4-digit years like #2024 untouched.')
            .addToggle(toggle =>
                toggle.setValue(this.plugin.settings.skipShortNumericTags).onChange(async value => {
                    this.plugin.settings.skipShortNumericTags = value;
                    await this.plugin.saveSettings();
                })
            );

        this.addCustomRegexSetting(containerEl);

        new Setting(containerEl)
            .setName('Convert existing tags only')
            .setDesc(
                'Only convert inline tags that already exist elsewhere in your vault (in another note) or ' +
                'in this note’s frontmatter. One-off inline tags found only in this note are left alone.'
            )
            .addToggle(toggle =>
                toggle.setValue(this.plugin.settings.convertExistingOnly).onChange(async value => {
                    this.plugin.settings.convertExistingOnly = value;
                    await this.plugin.saveSettings();
                    updateStripVisibility();
                })
            );

        const stripSetting = new Setting(containerEl)
            .setName('Strip single-note inline tags')
            .setDesc(
                'Also remove one-off inline tags (found only in this note) from the body without adding them ' +
                'to frontmatter. Off = leave them in place.'
            )
            .addToggle(toggle =>
                toggle.setValue(this.plugin.settings.stripSingleNoteTags).onChange(async value => {
                    this.plugin.settings.stripSingleNoteTags = value;
                    await this.plugin.saveSettings();
                })
            );
        // Render as a sub-option of "Convert existing tags only": indented, and only shown when on.
        stripSetting.settingEl.addClass('tag-filing-sub-setting');
        const updateStripVisibility = (): void => {
            stripSetting.settingEl.toggle(this.plugin.settings.convertExistingOnly);
        };
        updateStripVisibility();

        new Setting(containerEl)
            .setName('Convert inline tags to frontmatter')
            .setDesc('Scan notes for inline #tags and move them into frontmatter. Includes a dry-run preview and confirmation. Back up your vault first.')
            .addButton(button =>
                button
                    .setButtonText('Run converter…')
                    .setCta()
                    .onClick(() => this.plugin.runConverter())
            );
    }

    /** Custom-regex exclusion field with a help link and live "invalid regex" validation. */
    private addCustomRegexSetting(containerEl: HTMLElement): void {
        const desc = createFragment(frag => {
            frag.appendText(
                'Inline tags whose name matches this regular expression are ignored. The leading # is ' +
                'not part of the match — write the pattern for the tag name only (e.g. '
            );
            frag.createEl('code', { text: '^\\d+$' });
            frag.appendText('). ');
            frag.createEl('a', {
                text: 'Regex guide ↗',
                href: 'https://coderpad.io/blog/development/the-complete-guide-to-regular-expressions-regex/'
            });
        });

        let errorEl: HTMLElement | null = null;
        const showError = (message: string | null): void => {
            if (!errorEl) {
                return;
            }
            errorEl.setText(message ? `Invalid regex: ${message}` : '');
            errorEl.toggle(message !== null);
        };

        const setting = new Setting(containerEl)
            .setName('Custom tag exclusion (regex)')
            .setDesc(desc)
            .addText(text =>
                text
                    .setPlaceholder('e.g. ^\\d+$')
                    .setValue(this.plugin.settings.customExcludeRegex)
                    .onChange(async value => {
                        this.plugin.settings.customExcludeRegex = value;
                        showError(tryCompileRegex(value).error);
                        await this.plugin.saveSettings();
                    })
            );

        errorEl = setting.controlEl.createDiv({ cls: 'tag-filing-regex-error' });
        showError(tryCompileRegex(this.plugin.settings.customExcludeRegex).error);
    }
}
