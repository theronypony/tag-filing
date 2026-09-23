# Tag-based folders — version 2.0 implementation

This records the final scope after the decision to replace the plugin's automatic tag writer with Notebook Navigator's native new-note tagging. It supersedes the earlier plan to extend the old auto-tagger.

## Confirmed behavior

- Tag paths map directly from the vault root: `#work/meetings` → `work/meetings/`. Create missing parents automatically.
- Automatic filing uses the selected Navigator tag after Navigator tags and opens the new note. Users must select **Notebook Navigator: Create new note**, including for Command-N/Ctrl-N. Onboarding explains this and filing initially remains off.
- The manually initiated organizer scans all Markdown notes and moves those with exactly one distinct tag across frontmatter and body. Repetition, case differences and equivalent Unicode spellings count once; explicit parent and child tags count separately.
- Excluded source/destination folders and descendants are protected. Filenames stay unchanged. Existing targets, conflicting batch destinations and ambiguous folder capitalization are reported without overwrites.
- Every manual run requires a preview and two explicit whole-vault backup warnings. Previewing/cancelling creates no folders, moves or run logs. Exporting a preview is an explicit separate write.
- Moves revalidate the source, content fingerprint, tag, exclusions and target. Obsidian's move API handles links according to user preferences. Attachments and empty source folders stay in place; no automatic undo is provided.

## Implementation

| Module | Responsibility |
| --- | --- |
| `src/autoMover.ts` | Capture a concrete live NN selection on recent creation, require local opening and a matching frontmatter tag, then queue filing. No tag writes or stale-selection fallback. |
| `src/folderPlacement.ts` | Shared path/exclusion/collision checks, portable folder-name validation, folder creation and serialized checked moves. |
| `src/organizer/noteTags.ts` | Read current contents with Obsidian's frontmatter parser and code/HTML/comment-aware inline extraction; deduplicate tags and fingerprint content. |
| `src/organizer/singleTagOrganizer.ts` | Classify the whole vault, agree on new-folder spelling, reject batch collisions, revalidate and process confirmed candidates. |
| `src/organizer/moveLog.ts` | Per-run JSONL plan, incremental per-note states, completion/cancellation summary. Stop further work if logging fails. |
| `src/ui/` | Upgrade setup, paginated move preview, export, two backup warnings, progress/cancel and summary. |
| `src/main.ts`, `src/settings.ts` | Migration, event/command registration and shared manual-operation guard; preserve the converter. |

Tag counts use current file contents rather than trusting a potentially stale metadata-cache snapshot. Invalid/unreadable tag properties are skipped. The converter's optional filters do not apply to folder cleanup; numeric-only inline text is not counted as an Obsidian tag. The old auto-tagger and cached tag resolver are removed. No Navigator event subscription remains, eliminating the former incorrect unsubscribe call; the local folder-selection type now matches the API's `TFolder`.

## Notebook Navigator compatibility

Reviewed on 2026-09-22 against the latest published **3.4.1** release (2026-09-14), minimum Obsidian **1.11.0**, public API **2.0.0**. Its tag-based creation adds the selected tag before opening the editor, but uses the configured creation location. Inherit Tags supplies the subsequent folder placement.

Navigator's native selected-tag creation shipped in 2.4.0 and applies to its own actions. It does not generally add a tag to Obsidian's core Create new note command. Merely leaving Navigator open does not change the hotkey's command.

There is no public command/device provenance event for a created note. Automatic filing therefore uses recent creation + local file-open + matching frontmatter tag, within 30 seconds. Background sync alone is ignored. A recently synced note opened with the same selected tag, or another command creating and opening a pretagged note, can qualify. This limit is documented rather than claiming complete multi-device origin detection. Early renames or slow template/open workflows can leave notes unfiled for later manual organization.

Moving after creation retains Navigator's original template choice and allows the editor to settle briefly. Real template cursor, link-update and sync behavior still needs acceptance testing in Obsidian.

## Validation and deployment

Automated validation covers tag counting, path rules, conflicts, case consistency, changed/deleted notes, cancellation during reads and folder creation, logging failures, command/dialog gating, setup migration, NN API selection behavior, automatic filing, and the existing converter. Tests use Obsidian doubles, not a running Obsidian instance.

Run `npm test` and `npm run build`; install the built release in a separate environment and follow [the numbered acceptance checklist](FOLDER_PLACEMENT_TESTING.md). Upgrade the existing `inherit-tags` directory while retaining `data.json` and logs. Version 2.0.0 raises the manifest baseline to Obsidian 1.11.0 and preserves the plugin ID/name.

## References

- [Notebook Navigator 3.4.1 release](https://github.com/johansan/notebook-navigator/releases/tag/3.4.1), [manifest](https://github.com/johansan/notebook-navigator/blob/3.4.1/manifest.json), and [public API declarations](https://github.com/johansan/notebook-navigator/blob/3.4.1/src/api/public/notebook-navigator.d.ts).
- [Native tag-based creation](https://github.com/johansan/notebook-navigator/blob/3.4.1/src/services/FileSystemService.ts), [template creation](https://github.com/johansan/notebook-navigator/blob/3.4.1/src/utils/fileCreationUtils.ts), and [command setup](https://github.com/johansan/notebook-navigator/blob/3.4.1/README.md#9-commands).
- [Obsidian public API](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts) and [tag format](https://obsidian.md/help/tags).
