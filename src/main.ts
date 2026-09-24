import { Notice, Plugin, TFile } from 'obsidian';
import { TagFilingSettings, TagFilingSettingTab, DEFAULT_SETTINGS, migrateSettings, parseExcludeFolders } from './settings';
import { AutoMover } from './autoMover';
import { getNotebookNavigatorApi } from './nnApi';
import { FolderMover } from './folderPlacement';
import { ExtractorSettings, tryCompileRegex } from './converter/tagExtractor';
import { ConversionResult, ExistingOnlyContext, buildPreviewMarkdown, buildVaultTagFileMap, convertFiles, dryRunScan } from './converter/inlineTagConverter';
import { ConversionLog, writeConversionLog } from './transactionLog';
import { ScopeSelection, promptScope } from './ui/scopeDialog';
import { showPreview } from './ui/previewModal';
import { confirmConversion, confirmFolderMoves } from './ui/confirmDialog';
import { ProgressModal } from './ui/progressModal';
import { showSummary } from './ui/summaryModal';
import { FOLDER_SETUP_VERSION, showFolderSetup } from './ui/folderSetupModal';
import { showMovePreview, showMoveSummary } from './ui/moveModals';
import { buildMoveReport, executeMoves, initialMoveResults, MoveResult, scanSingleTagNotes } from './organizer/singleTagOrganizer';
import { createMoveLog } from './organizer/moveLog';
import { TagDropFiler } from './tagDrop/tagDropFiler';
import { NavigatorDropListener } from './tagDrop/navigatorDrop';

export default class TagFilingPlugin extends Plugin {
    settings: TagFilingSettings = DEFAULT_SETTINGS;
    private autoMover!: AutoMover;
    private folderMover!: FolderMover;
    private tagDropFiler!: TagDropFiler;
    private tagDropListener!: NavigatorDropListener;
    private manualRunning = false;
    private setupRunning = false;
    private disposed = false;

    async onload(): Promise<void> {
        await this.loadSettings();

        this.folderMover = new FolderMover(this.app);
        this.autoMover = new AutoMover(
            this.app,
            this.folderMover,
            () => getNotebookNavigatorApi(this.app),
            () => !this.disposed && !this.manualRunning && !this.tagDropFiler?.busy && this.settings.autoMoveEnabled,
            () => parseExcludeFolders(this.settings.excludeFolders),
            message => new Notice(`Tag Filing: ${message}`)
        );
        const dropEnabled = (): boolean => !this.disposed && !this.manualRunning && this.settings.tagDropEnabled;
        this.tagDropFiler = new TagDropFiler(this.app, this.folderMover, {
            enabled: dropEnabled,
            exclusions: () => parseExcludeFolders(this.settings.excludeFolders),
            behavior: () => this.settings.tagDropBehavior,
            saveBehavior: async choice => {
                const previous = this.settings.tagDropBehavior;
                this.settings.tagDropBehavior = choice;
                try { await this.saveSettings(); }
                catch (error) { this.settings.tagDropBehavior = previous; throw error; }
            },
            notify: message => new Notice(`Tag Filing: ${message}`)
        });
        this.tagDropListener = new NavigatorDropListener(this.app, () => getNotebookNavigatorApi(this.app), dropEnabled, drop => {
            this.autoMover.clearPending();
            void this.tagDropFiler.enqueue(drop.files, drop.tag).catch(error => {
                console.error('[tag-filing] Tag drop failed:', error);
                new Notice('Tag Filing: tag drop failed; check the note and try again.');
            });
        });

        this.addSettingTab(new TagFilingSettingTab(this.app, this));

        this.addCommand({
            id: 'convert-inline-tags',
            name: 'Convert inline tags to frontmatter',
            callback: () => this.runConverter()
        });

        this.addCommand({ id: 'move-single-tag-notes', name: 'Move single-tag notes to matching folders', callback: () => this.runOrganizer() });
        this.addCommand({ id: 'folder-setup', name: 'Show folder filing setup', callback: () => this.showSetup() });

        // Register the create listener only after layout is ready. During initial vault load Obsidian
        // fires 'create' for every existing file; deferring avoids treating those as new notes.
        this.app.workspace.onLayoutReady(() => {
            if (this.disposed) return;
            this.registerEvent(this.app.vault.on('create', file => this.autoMover.handleCreate(file)));
            this.registerEvent(this.app.workspace.on('file-open', file => this.autoMover.handleOpen(file)));
            this.registerInterval(window.setInterval(() => this.autoMover.prune(), 5000));
            this.attachDropDocuments();
            this.registerEvent(this.app.workspace.on('layout-change', () => this.attachDropDocuments()));
            this.registerEvent(this.app.workspace.on('window-open', (_workspaceWindow, win) => this.tagDropListener.attach(win.document)));
            this.registerEvent(this.app.workspace.on('window-close', (_workspaceWindow, win) => this.tagDropListener.detach(win.document)));
            if (this.settings.onboardingVersion !== FOLDER_SETUP_VERSION) this.showSetup();
        });
    }

    onunload(): void {
        this.disposed = true;
        this.autoMover?.dispose();
        this.tagDropListener?.dispose();
        this.tagDropFiler?.dispose();
    }

    private attachDropDocuments(): void {
        if (this.disposed) return;
        if (typeof document !== 'undefined') this.tagDropListener.attach(document);
        this.app.workspace.iterateAllLeaves(leaf => this.tagDropListener.attach(leaf.view.containerEl.ownerDocument));
    }

    private getExtractorSettings(): ExtractorSettings {
        return {
            hexColorFilter: this.settings.hexColorFilter,
            skipShortNumericTags: this.settings.skipShortNumericTags,
            customExcludePattern: tryCompileRegex(this.settings.customExcludeRegex).pattern
        };
    }

    async showSetup(): Promise<void> {
        if (this.setupRunning || this.disposed) return;
        this.setupRunning = true;
        try {
            const enable = await showFolderSetup(this.app);
            if (this.disposed) return;
            this.settings.autoMoveEnabled = enable;
            this.settings.onboardingVersion = FOLDER_SETUP_VERSION;
            await this.saveSettings();
            const api = getNotebookNavigatorApi(this.app);
            if (enable && !api) {
                new Notice('Tag Filing: enable Notebook Navigator before using automatic filing.');
            } else if (enable && api?.getVersion?.().split('.')[0] !== '2') {
                new Notice('Tag Filing: automatic filing requires Notebook Navigator API 2.x. Version 3.4.1 is supported.');
            }
        } catch (error) {
            console.error('[tag-filing] Setup could not be saved:', error);
            new Notice('Tag Filing: setup could not be saved.');
        } finally { this.setupRunning = false; }
    }

    // ── Feature B entry point ─────────────────────────────────────────────────

    runConverter(): void {
        if (this.manualRunning || this.tagDropFiler.busy || this.disposed) {
            new Notice('Tag Filing: finish the current filing operation or dialog first.');
            return;
        }
        // Fire-and-forget; internal errors are surfaced via Notice.
        void this.runConverterFlow();
    }

    private async runConverterFlow(): Promise<void> {
        this.manualRunning = true;
        this.autoMover.clearPending();
        try {
            const scope = await promptScope(this.app);
            if (!scope) {
                return;
            }

            const files = this.collectFiles(scope);
            if (files.length === 0) {
                new Notice('Tag Filing: no markdown files found in the selected scope.');
                return;
            }

            const settings = this.getExtractorSettings();

            // Warn once if the user typed a custom exclusion regex that doesn't compile (it's ignored).
            const regexCheck = tryCompileRegex(this.settings.customExcludeRegex);
            if (this.settings.customExcludeRegex.trim().length > 0 && regexCheck.error) {
                new Notice(`Tag Filing: ignoring invalid custom exclusion regex (${regexCheck.error}).`);
            }

            // Snapshot the vault's tag→files index once (before any edits) for existing-tags-only mode.
            const existingOnly: ExistingOnlyContext | null = this.settings.convertExistingOnly
                ? { tagFiles: buildVaultTagFileMap(this.app), stripSingleNote: this.settings.stripSingleNoteTags }
                : null;

            new Notice(`Tag Filing: scanning ${files.length} ${files.length === 1 ? 'file' : 'files'}…`);
            const previews = await dryRunScan(this.app, files, settings, {}, existingOnly);

            const scopeLabel = scope.type === 'all' ? 'all' : `folder:${scope.folder}`;
            const onExport = async () => {
                // Mirror transactionLog.getLogPath's fallback: manifest.dir is optional in the API.
                const dir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
                const path = `${dir}/conversion-preview.md`;
                try {
                    await this.app.vault.adapter.write(path, buildPreviewMarkdown(previews, scopeLabel));
                    new Notice(`Preview report written to ${path}`);
                } catch (error) {
                    console.error('[tag-filing] Failed to export preview:', error);
                    new Notice('Tag Filing: failed to export preview report (see console).');
                }
            };

            const action = await showPreview(this.app, previews, onExport);
            if (action !== 'proceed' || previews.length === 0) {
                return;
            }

            const confirmed = await confirmConversion(this.app, previews.length);
            if (!confirmed || this.disposed) {
                return;
            }

            const targetFiles = previews
                .map(preview => this.app.vault.getAbstractFileByPath(preview.path))
                .filter((file): file is TFile => file instanceof TFile);

            const progress = new ProgressModal(this.app);
            progress.open();

            const results = await convertFiles(this.app, targetFiles, settings, {
                onProgress: info => progress.update(info),
                shouldCancel: () => progress.isCancelled() || this.disposed
            }, existingOnly);

            const cancelled = progress.isCancelled();
            progress.markCompleted();
            progress.close();

            const log = this.buildLog(scopeLabel, files.length, results);
            // null when the write failed; the summary omits the log line in that case, so don't
            // substitute a path that doesn't exist on disk.
            const logPath = await writeConversionLog(this, log);

            const ok = results.filter(r => r.status === 'ok').length;
            const failed = results.filter(r => r.status === 'failed').length;
            new Notice(`Tag Filing: converted ${ok} ${ok === 1 ? 'file' : 'files'}${failed > 0 ? `, ${failed} failed` : ''}.`);

            showSummary(this.app, { results, cancelled, logPath });
        } catch (error) {
            console.error('[tag-filing] Converter failed:', error);
            new Notice('Tag Filing: conversion failed unexpectedly (see console).');
        } finally {
            this.manualRunning = false;
        }
    }

    runOrganizer(): void {
        if (this.manualRunning || this.tagDropFiler.busy || this.disposed) {
            new Notice('Tag Filing: finish the current filing operation or dialog first.');
            return;
        }
        void this.runOrganizerFlow();
    }

    private async runOrganizerFlow(): Promise<void> {
        this.manualRunning = true;
        this.autoMover.clearPending();
        let progress: ProgressModal | null = null;
        try {
            progress = new ProgressModal(this.app, 'Scanning notes for folder placement', false);
            progress.open();
            const scanProgress = progress;
            const previews = await scanSingleTagNotes(this.app, parseExcludeFolders(this.settings.excludeFolders), {
                shouldCancel: () => this.disposed || scanProgress.isCancelled(),
                onProgress: (processed, total, currentPath) => scanProgress.update({ processed, total, currentPath, tagsFound: 0 })
            });
            const scanCancelled = this.disposed || progress.isCancelled();
            progress.markCompleted();
            progress.close();
            progress = null;
            if (scanCancelled) return;

            const proceed = await showMovePreview(this.app, previews, async () => {
                const dir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
                try {
                    await this.app.vault.adapter.write(`${dir}/folder-moves-preview.md`, buildMoveReport(previews));
                    new Notice(`Preview report saved to ${dir}/folder-moves-preview.md`);
                } catch (error) {
                    console.error('[tag-filing] Could not export move preview:', error);
                    new Notice('Tag Filing: could not export the preview report.');
                }
            });
            const count = previews.filter(row => row.status === 'ready').length;
            if (!proceed || !count || this.disposed) return;
            if (!await confirmFolderMoves(this.app, count) || this.disposed) return;

            const results = initialMoveResults(previews);
            const record = createMoveLog(this, results);
            let logSaved = false;
            let error: string | undefined;
            const checkpoint = async (result?: MoveResult): Promise<void> => { await record.save(result); logSaved = true; };
            progress = new ProgressModal(this.app, 'Moving notes to matching folders', false);
            progress.open();
            const moveProgress = progress;
            try {
                await executeMoves(this.app, this.folderMover, previews, results, () => parseExcludeFolders(this.settings.excludeFolders), {
                    shouldCancel: () => this.disposed || moveProgress.isCancelled(),
                    onProgress: (processed, total, currentPath) => moveProgress.update({ processed, total, currentPath, tagsFound: 0 })
                }, checkpoint);
            } catch (cause) {
                error = `Processing stopped: ${cause instanceof Error ? cause.message : String(cause)}. No further notes were moved.`;
            }
            record.log.cancelled = this.disposed || progress.isCancelled();
            record.log.finishedAt = new Date().toISOString();
            record.log.error = error;
            try { await checkpoint(); } catch {
                error = `${error ? error + ' ' : ''}The final log could not be saved; the last saved log may be incomplete.`;
            }
            progress.markCompleted();
            progress.close();
            progress = null;
            if (!this.disposed) showMoveSummary(this.app, results, record.log.cancelled, logSaved ? record.path : null, error);
        } catch (error) {
            console.error('[tag-filing] Folder organizer failed:', error);
            new Notice('Tag Filing: folder organizer stopped unexpectedly (see console).');
        } finally {
            progress?.markCompleted();
            progress?.close();
            this.manualRunning = false;
        }
    }

    private collectFiles(scope: ScopeSelection): TFile[] {
        const all = this.app.vault.getMarkdownFiles();
        if (scope.type === 'all') {
            return all;
        }
        const folder = scope.folder.replace(/^\/+|\/+$/g, '');
        if (folder === '' || folder === '/') {
            return all; // vault root
        }
        return all.filter(file => file.path === folder || file.path.startsWith(folder + '/'));
    }

    private buildLog(scopeLabel: string, totalFiles: number, results: ConversionResult[]): ConversionLog {
        const modifiedFiles = results.filter(r => r.status === 'ok').length;
        const failedFiles = results.filter(r => r.status === 'failed').length;
        return {
            timestamp: new Date().toISOString(),
            scope: scopeLabel,
            totalFiles,
            modifiedFiles,
            failedFiles,
            files: results.map(r => ({
                path: r.path,
                extractedTags: r.extractedTags,
                status: r.status,
                ...(r.error ? { error: r.error } : {})
            }))
        };
    }

    async loadSettings(): Promise<void> {
        this.settings = migrateSettings(await this.loadData());
    }

    async saveSettings(): Promise<void> {
        if (!this.settings.autoMoveEnabled) this.autoMover?.clearPending();
        if (!this.settings.tagDropEnabled) this.tagDropFiler?.cancelPending();
        await this.saveData(this.settings);
    }
}
