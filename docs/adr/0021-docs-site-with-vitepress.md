# The docs are a VitePress site built from the repo's Markdown

Kestrel's user guides, glossary, ADRs and changelog are Markdown files that stay where they are: `docs/guide/`, `GLOSSARY.md`, `docs/adr/`, `CHANGELOG.md` and `CONTRIBUTING.md`. A VitePress site renders them to HTML and a GitHub Actions workflow publishes it to GitHub Pages at `https://hyprsh.github.io/kestrel/`. Nothing is moved or copied, so the release skill (which writes `CHANGELOG.md`) and the domain docs (which read `GLOSSARY.md` and `docs/adr/`) work unchanged, and each file is still readable on GitHub.

VitePress is a devDependency in `web/package.json`, pinned to an exact version, so npm stays in `web/` and nothing needs a global install. Its config lives in `web/docs-site/.vitepress/`. It maps each source file to a page (`rewrites.ts`), turns a link to a repo file that is not a page (`CLAUDE.md`, `api/openapi.yaml`) into a GitHub link, and slugs headings the way GitHub does so a `#anchor` link works in both places. The default theme carries the Kestrel logo and accent colour, and its local search runs in the browser with no external service. `docs/agents/`, `docs/research/`, `CLAUDE.md` and the README are not on the site.

The API reference is one static Scalar page over `api/openapi.yaml`, the renderer the app serves at `{base}/api/docs`, plus a short page on authentication with `X-Api-Key`. There is no Markdown page per endpoint.

`make docs` builds the site under the `/kestrel/` base path and fails on a dead link or anchor in any page, and `make check` and CI run it. `make docs-dev` serves it with hot reload. The workflow `docs.yml` deploys on `release: published`, so the docs match `:latest`, and on `workflow_dispatch` for a docs-only fix. It does not run on a push to `main`, unlike the `:edge` image.

## Considered Options

- **hyprsh/design's own generator** (its ADR 0001), which has no dependencies. Rejected: it renders that repo's pages, and Kestrel would have to grow search, navigation, link checking and a Markdown dialect to match. Owning little code beats matching the house style here.
- **MkDocs Material.** Rejected because it adds Python and its own dependency pinning next to the Node toolchain already in CI.
- **Starlight (Astro) and Hugo.** Rejected: VitePress fits the Node toolchain with the fewest moving parts, and its default theme and local search are enough.
- **Moving the sources into a `site/` directory.** Rejected: it would break the release skill and the domain docs, or leave two copies of each fact.
- **Publishing on every push to `main`.** Rejected: it would document features before they ship. Versioned docs stay out while versions are `0.x`.
- **A custom domain.** Not now: `hyprsh.github.io/kestrel` needs no DNS, and the site respects the base path, so a domain can come later.
- **Generated Markdown pages per endpoint.** Rejected: one Scalar page shows every operation and is the renderer a running Kestrel already serves.

## Consequences

- A change to what a person sees or sets is a change to a guide, and the same PR carries it. A dead link in any rendered Markdown fails `make docs` and CI, including a source that links to a heading that no longer exists.
- Source Markdown must render on both GitHub and VitePress. The config copes with raw HTML and `<name>`-style text in the changelog and the ADRs, and with the guides' `<picture>` screenshots. A new kind of Markdown may need a config change.
- A maintainer sets Settings > Pages > Source to "GitHub Actions" once, and the repository's homepage URL to the site.
- Screenshots are refreshed by hand with `make docs-shots`, not in CI.
- The API reference page loads Scalar from a CDN, as the app's does, so it needs network access in the reader's browser.
