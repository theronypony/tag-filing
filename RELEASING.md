# Publishing Tag Filing

Pushing code updates the repository. Publishing a release makes a particular version available to BRAT. A working release needs three attached files: `main.js`, `manifest.json`, and `styles.css`. GitHub's automatically generated source archives are not enough.

The example below uses **2.1.1** for the next release after 2.1.0. Substitute the version you intend to publish throughout. Use a bare version such as `2.1.1`, with no `v` prefix. The release tag must match the version in `manifest.json`. Keep the plugin ID as `inherit-tags` so existing installations continue to update.

1. **Open the project and check your changes.**

   ```sh
   cd /Users/rsberlo/Dropbox/Projects/auto-tags
   git status
   git branch --show-current
   ```

   These instructions assume you are on `main`. Review the changes before staging them. If you use GitHub Desktop, the equivalent is reviewing the Changes tab and confirming the Current Branch is `main`.

2. **Set the new version.**

   ```sh
   npm version 2.1.1 --no-git-tag-version
   ```

   This updates `package.json` and `package-lock.json`. The project's version script also updates `manifest.json` and `versions.json`, and stages those two files. It does not create a commit or Git tag. If the intended new version has already been set in all four files, skip this command. Add a short entry to `CHANGELOG.md` describing the change.

3. **Validate and build.**

   ```sh
   npm ci
   npm test
   npm run build
   ```

   Stop if any command fails. Use the Node version in `.nvmrc` when preparing the build; with nvm installed, `nvm install` followed by `nvm use` selects it. Test functionality in a copied vault using [the acceptance checklist](FOLDER_PLACEMENT_TESTING.md). The generated `main.js` stays out of Git and is attached to the release by the workflow.

4. **Commit and push the reviewed changes.**

   ```sh
   git add -A
   git diff --cached --stat
   git diff --cached
   git commit -m "Release 2.1.1"
   git push origin main
   ```

   `git add -A` stages all changes that Git does not ignore, so check the displayed diff before committing. In GitHub Desktop, select the intended files, enter the commit message, choose **Commit to main**, then **Push origin**. Check the [repository](https://github.com/theronypony/tag-filing) to confirm the new commit and manifest version are present.

5. **Create the release on GitHub.**

   Open [Releases → Draft a new release](https://github.com/theronypony/tag-filing/releases/new). Choose **Create new tag** and enter `2.1.1`, with `main` as the target. Use `Tag Filing 2.1.1` as the title, add the release notes, and publish it as the latest normal release. Leave prerelease unchecked for the usual BRAT update path.

   Creating the new tag starts the **Release** workflow. The workflow builds the plugin and attaches its files to the release you created. You do not need to upload files yourself during a normal release. If the tag already has a release, edit that release instead of creating another one.

6. **Wait for the files and confirm the release is ready.**

   Open [Actions → Release](https://github.com/theronypony/tag-filing/actions/workflows/release.yml) and wait for that version's run to finish successfully. Then refresh the release page. Under **Assets**, confirm `main.js`, `manifest.json`, and `styles.css` are listed separately. Download `manifest.json` and check that its version matches the tag and its ID remains `inherit-tags`.

   Until those files appear, BRAT may report a manifest error even though the release page is visible. A ZIP containing the files does not replace the individual assets.

7. **Check the update through BRAT.**

   Run BRAT's plugin update check in Obsidian. Confirm the installed Tag Filing version matches the release, existing settings remain, and the changed feature works. An existing installation can update normally; a project-name change does not require reinstalling while the plugin ID stays the same.

If you prefer to publish from the terminal, complete steps 1–4, then use these commands **instead of step 5**:

```sh
git tag 2.1.1
git push origin 2.1.1
```

The workflow creates the release and attaches the files. Continue with steps 6–7. Use one publishing route for each version.

If a release is missing its files, open the failed Actions run and read the failed step. Correct the cause before retrying. With the updated workflow, an existing release is supported: rerunning uploads the assets and preserves its title and notes. A run tied to an older tag still uses that tag's older workflow; rerunning the original 2.1.0 job, for example, would repeat its old release-creation error. The 2.1.0 assets were repaired separately.

For a manual repair, use a clean checkout of the **exact release tag**, run `npm ci`, `npm test`, and `npm run build`, then edit that release on GitHub and attach `main.js`, `manifest.json`, and `styles.css` from the build. Do not build an old release from a newer `main` branch. With GitHub CLI, the equivalent upload command is:

```sh
gh release upload 2.1.1 main.js manifest.json styles.css --repo theronypony/tag-filing
```

That command refuses duplicate filenames. Add `--clobber` only when deliberately replacing incorrect assets with a verified build of the same tag; it deletes the existing matching assets before uploading replacements. Publish code changes under a new version instead of moving an existing release tag.

The version command's behavior is documented in [npm's version reference](https://docs.npmjs.com/cli/v11/commands/npm-version/). GitHub documents [creating and editing releases](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository) and [uploading release assets](https://cli.github.com/manual/gh_release_upload).
