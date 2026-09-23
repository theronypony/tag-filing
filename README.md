# Inherit Tags 2.0

File new [Notebook Navigator](https://github.com/johansan/notebook-navigator) notes in folders that match the selected tag, organize existing single-tag notes, and convert inline tags to frontmatter.

**Version 2 removes this plugin's automatic tag writer. Use “Notebook Navigator: Create new note” so Navigator supplies the tag.** Obsidian's standard “Create new note” command does not supply the selected Navigator tag, even when Navigator is open and active.

## Install or upgrade

Requires **Obsidian 1.11.0 or later**. Automatic filing requires Notebook Navigator; its **3.4.1 release / API 2.0.0** was reviewed for this version. The two manual tools work without Navigator.

1. Back up your vault. First try the update in a copy of it.
2. Disable Inherit Tags, then copy `main.js`, `manifest.json`, and `styles.css` from the release into `<vault>/.obsidian/plugins/inherit-tags/`. If your vault uses another configuration directory, use that directory instead. Preserve your existing `data.json` and logs.
3. Enable the plugin. The first-run/upgrade setup explains the new command workflow. Existing converter preferences and excluded folders are preserved. Automatic filing starts **off** until enabled in setup or settings.
4. In **Settings → Hotkeys**, search for **Create new note**. Remove **Command-N** (Mac) or **Ctrl-N** (Windows/Linux) from Obsidian's command and assign it to **Notebook Navigator: Create new note**. Configure this on each device where you use the workflow.
5. Return to **Inherit Tags → Show setup…** or run **Inherit Tags: Show folder filing setup**, then select **NN command configured — enable filing**. Select a tag in Navigator and use its new-note command.

The plugin name and ID remain **Inherit Tags / `inherit-tags`**, so this replaces the previous version in the same plugin folder. Setup explains the shortcut change; it does not change your hotkeys automatically. On mobile, invoke Navigator's command from the command palette or a shortcut assigned to that command.

## Automatically file new Navigator notes

With `#work/meetings` selected, Navigator adds `work/meetings` to the new note's frontmatter. Inherit Tags then moves that note to **`work/meetings/` relative to the vault root**, creating missing parent folders as needed. The selected tag determines the destination even when a template supplies additional tags. Automatic filing does not change tag properties or inline tag text.

- Only newly created Markdown notes are considered. Existing notes are not processed at startup or when their tags change.
- Filing happens after Navigator tags and opens the note; there may be a brief visible move from Obsidian's configured new-note location.
- A current folder, property, “Tagged,” “Untagged,” or collection selection does not reuse an old tag. The live selection API may retain a concrete tag when the pane is closed.
- Excluded sources and destinations are skipped. If a filename conflicts, the new note remains in its original location and a notice explains why. Filenames are never changed to make a move fit.
- Folder templates are selected by Navigator at the original creation location. Moving the note does not reapply a template from the destination folder.

The integration reads Navigator's public selection API and Obsidian creation/open events. It requires a recent creation, a local file-open, and the selected tag already present in frontmatter. A background sync/import alone does not trigger a move. Obsidian does not provide a creation-device/command ID through these events: a recently synced note opened locally within 30 seconds with the same selected tag can qualify. A core-created note prefilled with that same tag by another plugin can also qualify. This is not an absolute origin guarantee.

Notes opened after the 30-second creation window, renamed before the pending move, or created while a manual tool is running may remain at their original location. Use the manual organizer to file eligible notes later. Check the workflow with your actual templates, devices and sync service before relying on automatic filing in the live vault.

## Manually organize single-tag notes

Run **Inherit Tags: Move single-tag notes to matching folders**, or choose **Preview moves…** in settings. This is a manually initiated operation; it never runs on a schedule and can be run again when needed.

It scans all Markdown notes, including the vault root, and considers only notes with **exactly one distinct tag across frontmatter and the body**. Repeated occurrences count once, ignoring capitalization and equivalent Unicode spelling. `#work/meetings` is one tag; explicitly writing both `#work` and `#work/meetings` is two. Notes with no tags or multiple distinct tags are skipped.

The scan reads current file contents, uses Obsidian's YAML parser for frontmatter, and uses the existing inline-tag parser with code, HTML and Obsidian-comment exclusions. It recognizes `tags`, case variants such as `Tags`, and legacy `tag` properties. Invalid or unreadable tag properties are reported and skipped. Purely numeric inline text such as `#2024` is not an Obsidian tag; converter filters do not otherwise affect this count. See [Obsidian's tag format](https://obsidian.md/help/tags).

Every run follows these steps:

1. **Preview:** show proposed source → destination moves, missing folders, and skipped notes with reasons. Nothing is moved or created. **Export report** explicitly saves a Markdown preview in the plugin directory.
2. **First backup warning:** explain the number of notes to move and remind you to back up the entire vault. **I understand, continue** opens the second warning.
3. **Second backup warning:** remind you that the tool has no automatic undo and ask whether the entire vault is backed up. Only **Yes, I have backed up — proceed** starts processing. Cancel, Escape, or dismissing either warning aborts the run. Both warnings are required every time.
4. **Move with progress and cancellation:** re-read each candidate and skip it if its contents, path, exclusions or destination have changed since the preview. Create folders and move notes sequentially. A failure on one note is reported; a logging failure stops further moves.
5. **Summary and recovery log:** show moved, skipped, failed and unprocessed counts. Cancelling retains completed moves and created folders. Rerunning skips notes already correctly filed.

Automatic filing pauses while the organizer or inline converter is open. Only one manual operation can run at a time.

## Folder rules

| Situation | Behavior |
| --- | --- |
| Tag `work/meetings` | Destination is `<vault>/work/meetings/`, regardless of the note's source folder. |
| Note tagged `work` in `work/archive/` | Move up to `work/`. A note already directly in `work/` is skipped. |
| Missing parent folders | Create automatically after any required confirmations. |
| Existing folder `Work/Meetings` | Reuse its unambiguous capitalization. |
| Different case spellings for a missing folder | The manual preview chooses one spelling for the batch; new folder spelling otherwise follows the tag. |
| Multiple folders differing only by case | Skip and report the ambiguity. |
| Excluded folder | Protect both source and destination, including descendants. Excluding `Arch` does not exclude `Archive`. |
| Existing destination filename | Leave the note in place. Never overwrite, merge, or automatically rename it. |
| Several preview candidates targeting the same filename | Skip every member of that conflict group. |
| Invalid path, reserved folder name, or file where a folder is required | Skip and report the reason. |

Moves use Obsidian's `FileManager.renameFile`, so link updates follow **Settings → Files and links → Automatically update internal links**. Check links, embeds and attachment references in your vault. Attachments and empty source folders stay in place. Link maintenance may change note content and timestamps; this tool does not promise timestamp preservation for moves.

### Recovery logs

Each confirmed manual run writes a separate `folder-moves-<timestamp>-<id>.jsonl` file under the plugin directory, normally `.obsidian/plugins/inherit-tags/`. No run log is created during preview or either backup warning. Exported previews are separate.

The log is plain text with one JSON record per nonblank line: an initial `plan` contains original paths, planned destinations and initial statuses; `result` entries record each attempted move; a final `summary` records counts and cancellation/errors. For a note, the latest `result` supersedes its initial status. Writes are incremental so a large run does not repeatedly rewrite the entire plan.

`moving` without a later outcome is indeterminate after a crash: check the actual source and destination before restoring or moving anything. An interrupted disk write may leave a partial line; earlier complete lines remain useful. Logs aid manual recovery and **do not replace a vault backup or provide automatic undo**. If a log write fails, processing stops and the summary identifies the incomplete log.

## Inline tag converter

The existing converter remains available through **Inherit Tags: Convert inline tags to frontmatter** and plugin settings. It converts inline `#tag` text into frontmatter and removes the original inline tags. Its folder/vault scope selection, preview/export, two backup warnings, progress/cancel, and separate conversion log remain in place.

It ignores code, HTML, headings and frontmatter when extracting inline tags. Its filters apply only to conversion:

- **Hex color filter** — skip `#FF5733`-style tokens, including 3–8 digit numbers (default on).
- **Skip short numeric tags** — skip 1–3 digit numbers such as `#1` (default off).
- **Custom tag exclusion (regex)** — ignore tag names matching a pattern, without the leading `#`.
- **Convert existing tags only** — convert tags already used in another note or this note's frontmatter.
- **Strip single-note inline tags** — when the preceding option is enabled, also remove one-off inline tags without adding them to frontmatter.

**Exclude folders** applies to automatic and manual folder filing. The converter keeps its separate scope selection. The converter writes frontmatter before removing inline tags, making an interruption between those steps recoverable by rerunning it.

## Development and validation

```sh
npm ci
npm test
npm run build
```

The production build produces `main.js`. Tests use in-memory Obsidian/API and dialog doubles; JSON frontmatter fixtures are valid YAML, while YAML parsing itself remains an Obsidian responsibility. These tests do not launch Obsidian or verify real sync, link updates or template cursor behavior. Follow [the numbered deployment and acceptance checklist](FOLDER_PLACEMENT_TESTING.md) in a separate test vault.

Compatibility was reviewed on 2026-09-22 against the latest published [Notebook Navigator 3.4.1 release](https://github.com/johansan/notebook-navigator/releases/tag/3.4.1), its [API declarations](https://github.com/johansan/notebook-navigator/blob/3.4.1/src/api/public/notebook-navigator.d.ts), [native tag-based creation](https://github.com/johansan/notebook-navigator/blob/3.4.1/src/services/FileSystemService.ts), and [command instructions](https://github.com/johansan/notebook-navigator/blob/3.4.1/README.md#9-commands). This is source/API compatibility review, with runtime acceptance still required.

## AI disclosure

Earlier versions were co-authored with Claude Opus 4.8. Version 2.0 was developed with assistance from OpenAI Codex.
