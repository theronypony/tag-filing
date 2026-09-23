# Changelog

## 2.0.0

- Remove automatic tag writing. Notebook Navigator now supplies the selected tag through its own **Create new note** command.
- Add first-run/upgrade onboarding explaining the required Navigator command and Command-N/Ctrl-N assignment. Automatic filing starts off until enabled; retain existing converter and exclusion preferences.
- File new Navigator notes in vault-relative folders matching the selected tag, creating missing parents automatically.
- Add a manual organizer for notes with exactly one distinct frontmatter/body tag, with preview/export, two required vault-backup warnings, progress/cancellation, revalidation, and incremental recovery logs.
- Protect excluded sources/destinations; preserve filenames; report conflicts, invalid paths and case ambiguities without overwriting notes.
- Keep the manual inline tag converter and its existing workflow.
- Review the integration against Notebook Navigator 3.4.1 / public API 2.0.0; require Obsidian 1.11.0 or later. Real Obsidian/device acceptance remains a deployment check.
