# Changelog

## 2.1.2 — Keep the folder tree unchanged after tag drops

- Run tag-drop renames inside Notebook Navigator's move context so its active-file auto-reveal does not expand or select the destination folder. Keep the existing folder expansion state and select the destination tag after filing.
- Scope the move context to the final rename, after prompts and safety checks. Continue using Obsidian's file manager for link updates; ordinary moves and Navigator settings keep their existing behavior.
- Guard the internal move adapter checked against Navigator 3.4.3. If unavailable, use normal filing and tag selection. Never retry a failed rename; preserve existing tag recovery on failure.

## 2.1.1 — Select the destination tag after filing

- After a successful note-to-tag drop, select and expand the destination tag in Notebook Navigator using its public navigation API. This includes single-tag replacement and the multi-tag **Yes** choice.
- Apply selection after the move's queued UI handlers, and cancel pending selection when filing is disabled or the plugin unloads. Add-only, excluded, cancelled and failed moves do not request tag navigation.
- Keep successful filing intact if Navigator cannot select the tag, report the selection failure, and continue remaining notes.
- Recheck the navigation API and drag adapter against Notebook Navigator 3.4.3 / API 2.0.0.

## 2.1.0 — File notes dropped onto tags

- Add desktop note-to-tag drop filing in Notebook Navigator. Count distinct frontmatter and inline tags before the drop: zero/single-tag notes switch to the target tag and move automatically; notes already having multiple tags ask first.
- Add **Yes** / **No, just add the tag**, a save-default checkbox, and settings for **Ask every time**, **Move and remove all other tags**, or **Just add the tag**. Dismissing a dialog cancels that note. A separate toggle restores normal Navigator drops.
- Remove other tags from properties and body text only for the move choice, preserving protected code/comments and unrelated property values. Process multiple dragged notes sequentially.
- Reuse vault-root folder mapping, exclusions, automatic folder creation and filename-conflict protection. When filing is initially blocked, only add the target tag and keep existing tags and location.
- Revalidate notes after dialogs, prevent concurrent manual tools, cancel pending drops on disable/unload, and restore original content after failed moves when no intervening edit prevents safe recovery.
- Review the desktop drop adapter against Notebook Navigator 3.4.1 / API 2.0.0, including same-vault multi-note payloads and pop-out document listeners. Real Obsidian acceptance remains required.
- Retain the `inherit-tags` plugin ID, new-note command onboarding, and both backup warnings for each manual bulk tool.

## 2.0.1 — Tag Filing

- Rename the plugin to **Tag Filing** throughout settings, commands, notices, onboarding, documentation, source identifiers, package metadata, and release titles.
- Rename the GitHub project to `theronypony/tag-filing` and update the installation links.
- Keep the internal plugin ID and installation directory as `inherit-tags` so existing settings, hotkeys and installations continue to update in place.
- Preserve the existing folder filing and converter behavior, including the two backup confirmations.

## 2.0.0

- Remove automatic tag writing. Notebook Navigator now supplies the selected tag through its own **Create new note** command.
- Add first-run/upgrade onboarding explaining the required Navigator command and Command-N/Ctrl-N assignment. Automatic filing starts off until enabled; retain existing converter and exclusion preferences.
- File new Navigator notes in vault-relative folders matching the selected tag, creating missing parents automatically.
- Add a manual organizer for notes with exactly one distinct frontmatter/body tag, with preview/export, two required vault-backup warnings, progress/cancellation, revalidation, and incremental recovery logs.
- Protect excluded sources/destinations; preserve filenames; report conflicts, invalid paths and case ambiguities without overwriting notes.
- Keep the manual inline tag converter and its existing workflow.
- Review the integration against Notebook Navigator 3.4.1 / public API 2.0.0; require Obsidian 1.11.0 or later. Real Obsidian/device acceptance remains a deployment check.
