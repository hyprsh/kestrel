---
name: release
description: Release Kestrel. Picks the next version, writes the notes (a description, upgrade steps and user-facing changes) into CHANGELOG.md and publishes the GitHub release, then checks the published assets. Use when the user says to release, cut or ship a version, or asks to preview the next release's notes.
---

The user decides when to release and approves the notes; you pick the version, write the notes and publish. Their approval of the preview is the go-ahead to merge the changelog and publish.

Publishing a `vX.Y.Z` GitHub release starts `.github/workflows/release.yml`, which attaches the Silo assets and pushes the image. Nothing else releases Kestrel.

## Steps

1. **Gather every change since the last release.** The last tag is `gh release view --json tagName -q .tagName`. Read `git log <tag>..origin/main`, the PRs merged since then, and the issues they close. No `feat`, `fix`, `perf` or breaking commit and no version named by the user: tell the user there is nothing to release and stop. Done when you know, for each `feat`, `fix`, `perf` and breaking commit, what a person running Kestrel sees change.

2. **Pick the version.** A version the user names wins. Otherwise bump the last tag: while Kestrel is 0.x, a breaking change or a `feat` bumps the minor (0.3.0 → 0.4.0), and `fix` or `perf` alone bumps the patch (0.3.0 → 0.3.1). From 1.0 on, a breaking change bumps the major.

3. **Write the notes** by the rules under [Notes](#notes), into a file outside the repo. Done when every `feat`, `fix`, `perf` and breaking commit is covered by a bullet or left out by one of those rules.

4. **Preview.** Show the user the version and the notes exactly as they will be published, and say which commits you left out and why. Then wait. Edits they ask for go into the notes, and you show the result again. Done when the user approves. A user who asked only for a preview stops here.

5. **Merge the changelog.** On a branch `chore/release-X.Y.Z` from `origin/main`, put the notes at the top of `CHANGELOG.md`, above the newest `## [` entry. Commit as `chore(release): X.Y.Z`, push, and open a PR with that title and the notes as its description. Wait for its checks (`gh pr checks <n> --watch`) and merge with `gh pr merge <n> --squash --subject "chore(release): X.Y.Z" --body ""`. Done when the PR is merged and you have the merge commit's SHA.

6. **Publish.** `gh release create vX.Y.Z --target <merge SHA> --title vX.Y.Z --notes-file <notes>`. This creates the tag and starts the Release workflow.

7. **Verify.** Watch the Release workflow's run for the tag (`gh run list --workflow release.yml`, then `gh run watch`). Done when its `publish` job is green and `gh release view vX.Y.Z` shows your notes and six assets: the three `kestrel-silo-*` binaries, `checksums.txt`, `silo-repository.json` and `THIRD_PARTY_NOTICES.md`.

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

- **Heading:** the new version, a compare link from the last tag, and today's date.
- **Description:** lead with the change a user would upgrade for, in plain words. Link the README section or ADR that explains it.
- **Upgrade Steps:** concrete steps beyond `docker compose pull`, such as a new environment variable, a compose change or a manual migration. Also say when upgrading fixes a known problem in older releases.
- **New Features:** say when to use the feature and any caveats.
- **One bullet per user-visible change:** a feature built over many commits is one bullet, linking its PR and the issues it closes.
- **Left out:** fixes for bugs introduced since the last release, and refactors, tests, CI and docs that a user wouldn't notice.
- **Other Changes:** only what a user notices and fits no other section.
- **Sections:** use only the ones that have bullets, in the order above.
- **Attribution:** the notes end with the last bullet.
