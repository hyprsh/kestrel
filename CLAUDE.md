## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `hyprsh/kestrel`, using the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the five default triage labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Checks

The check command is `make check` (gofmt, vet, the generated-code drift check, Go tests with the race detector, SPA tests and the compose check). In a fresh worktree run `npm --prefix web ci` first. Commit generated output before running it: the drift check fails on uncommitted changes. `make help` lists the narrower targets, such as `make test` and `make generate`.

## Commits and PR titles

commitlint (`commitlint.config.js`) checks every commit header, merge commits included, and the PR title: start the subject lower-case (`feat: title page, …`) and keep the header within 100 characters. Check a PR title before opening the PR: `printf '%s\n' "<title>" | npx --no-install commitlint`.
