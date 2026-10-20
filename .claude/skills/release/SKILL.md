---
name: release
description: Release Kestrel. Curates the open release-please PR's notes (a description, upgrade steps and user-facing changes), then merges it and checks the published release. Use when the user says to release, cut or ship a version.
---

The user decides when to release; you write the notes and ship. Their request to release is the go-ahead to merge.

release-please keeps one release PR open (label `autorelease: pending`, branch `release-please--branches--main--components--kestrel`, title `chore(main): release X.Y.Z`). On merge it creates the `vX.Y.Z` tag and GitHub release **from the PR description**: the notes are the text between its first and last `---` lines. The header and footer around them come from `release-please-config.json`.

## Steps

1. **Find the release PR.** `gh pr list --label "autorelease: pending" --state open`. No PR: tell the user there is nothing unreleased and stop. Done when you have its number and version.

2. **Gather every change since the last release.** The last tag is `gh release view --json tagName -q .tagName`. Read `git log <tag>..origin/main`, the PRs merged since then, and the issues they close. Read the generated notes in the PR description: they are your checklist. Done when you know, for each `feat`, `fix`, `perf` and breaking commit, what a person running Kestrel sees change.

3. **Write the notes** by the rules under [Notes](#notes). Done when every `feat`, `fix`, `perf` and breaking commit is covered by a bullet or left out by one of those rules.

4. **Put the notes in both places.**
   - `CHANGELOG.md` on the release branch: replace the top entry (its `## [X.Y.Z]` heading down to the next `## [` heading) with the notes. Commit as `chore(main): curate the X.Y.Z release notes` and push to the release branch.
   - The PR description: keep the header and footer, and replace everything between the first and last `---` lines with the notes (`gh pr edit <n> --body-file`).

   Done when `gh pr view <n> --json body` shows the notes between the delimiters, starting with the version heading.

5. **Merge.** Wait for the PR's checks to pass (`gh pr checks <n> --watch`). Re-read the description first: a push to `main` makes release-please rebuild it, and then you redo step 4. Merge with `gh pr merge <n> --squash --subject "chore(main): release X.Y.Z" --body ""`.

6. **Verify the release.** Watch the Release workflow run for the merge commit (`gh run list --workflow release.yml --branch main`, then `gh run watch`). Done when both of its jobs, `release-please` and `publish`, are green and `gh release view vX.Y.Z` shows your notes and the assets. If the notes differ, set them with `gh release edit vX.Y.Z --notes-file`.

Report the version, the release URL and the description.

## Notes

```markdown
## [X.Y.Z](https://github.com/hyprsh/kestrel/compare/vA.B.C...vX.Y.Z) (YYYY-MM-DD)

> What this release gives someone running Kestrel, in one or two sentences.

### Upgrade Steps

* **[ACTION REQUIRED]** What to change beyond pulling the new image.

### Breaking Changes

* What breaks, and the step that migrates it.

### New Features

* **scope:** what it does, and when to use it ([#97](https://github.com/hyprsh/kestrel/pull/97)), closes [#91](https://github.com/hyprsh/kestrel/issues/91)

### Bug Fixes

* **scope:** what now works as expected.

### Performance Improvements

### Other Changes
```

- **Heading:** copy the generated version heading exactly. release-please reads the version from it.
- **Description:** lead with the change a user would upgrade for, in plain words. Link the README section or ADR that explains it.
- **Upgrade Steps:** concrete steps beyond `docker compose pull`, such as a new environment variable, a compose change or a manual migration. Also say when upgrading fixes a known problem in older releases.
- **New Features:** say when to use the feature and any caveats.
- **One bullet per user-visible change:** a feature built over many commits is one bullet, linking its PR and the issues it closes.
- **Left out:** fixes for bugs introduced since the last release, and refactors, tests, CI and docs that a user wouldn't notice.
- **Other Changes:** only what a user notices and fits no other section.
- **Sections:** use only the ones that have bullets, in the order above.
- **Delimiters:** a line that is exactly `---` ends the notes, so the notes never contain one.
- **Attribution:** the notes end with the last bullet.
