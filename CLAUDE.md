## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `hyprsh/kestrel`, using the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the five default triage labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Checks

The check command is `make check` (gofmt, vet, the dead-code, prettier and chrome checks in `make lint-go` and `make lint-web`, the generated-code drift check, Go tests with the race detector, SPA tests and the compose check). In a fresh worktree run `npm --prefix web ci` first. Commit generated output before running it: the drift check fails on uncommitted changes. `make help` lists the narrower targets, such as `make test` and `make generate`.

A change under `web/src` also runs the demo sweep for the screens it touches; see the demo skill.

## Commits and PR titles

`scripts/check-commit-header.sh` checks the PR title in CI, and each commit header once `make hooks` is run: a type from `feat fix docs style refactor perf test build ci chore revert`, an optional scope, a subject that starts lower-case (`feat: title page, …`) without a trailing full stop, and at most 100 characters. Squash merges use the PR title as the header on main. Check a PR title before opening the PR: `printf '%s\n' "<title>" | make commit-check`.
