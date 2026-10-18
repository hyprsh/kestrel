# Kestrel

One app that replaces Radarr and Sonarr for usenet. Movies and Series are two kinds of Title, each with up to three Slots (SD, HD, UHD) holding one Version apiece. See [`GLOSSARY.md`](GLOSSARY.md) for the terms and [`docs/adr/`](docs/adr/) for the decisions behind the design. The spec is [hyprsh/kestrel#22](https://github.com/hyprsh/kestrel/issues/22).

Kestrel ships as one Docker image holding a single Go binary (`CGO_ENABLED=0`) with the web UI embedded.

## Run it

`compose.yaml`, with Kestrel next to SABnzbd on the [TRaSH](https://trash-guides.info/File-and-Folder-Structure/) `/data` layout. Both containers see the same `/data`, so Imports can hardlink.

```yaml compose.yaml
services:
  kestrel:
    image: ghcr.io/hyprsh/kestrel:latest
    container_name: kestrel
    environment:
      - PUID=1000
      - PGID=1000
      - UMASK=002
      - TZ=Europe/Berlin
    volumes:
      - ./kestrel:/config # SQLite database, migration backups, poster cache
      - /srv/data:/data # media library and downloads
    ports:
      - 7676:7676
    restart: unless-stopped

  sabnzbd:
    image: lscr.io/linuxserver/sabnzbd:latest
    container_name: sabnzbd
    environment:
      - PUID=1000
      - PGID=1000
      - UMASK=002
      - TZ=Europe/Berlin
    volumes:
      - ./sabnzbd:/config
      - /srv/data:/data
    ports:
      - 8080:8080
    restart: unless-stopped
```

Open <http://localhost:7676>.

### Configuration

Bootstrap settings are environment variables. Everything else lives in SQLite and is set in the UI.

| Variable | Default | Purpose |
|---|---|---|
| `PUID` / `PGID` | `1000` | User and group the entrypoint drops to. It `chown`s the config dir, never the data dir. Skipped if the container is started non-root (compose `user:`). |
| `UMASK` | `002` | Applied by the binary at startup. |
| `TZ` | `UTC` | Log timestamps and "today" boundaries. |
| `KESTREL_PORT` | `7676` | Listen port. |
| `KESTREL_BASE_URL` | empty | Routing prefix such as `/kestrel`. It prefixes every route, including `/ping` and the API. |
| `KESTREL_LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. Text to stdout. |
| `KESTREL_CONFIG_DIR` | `/config` | Holds `kestrel.db`, its `backups/` and the poster cache in `cache/posters/`. |
| `KESTREL_DATA_DIR` | `/data` | Prefills the root folders and is the mount the disk checks watch. |
| `KESTREL_TMDB_API_KEY` | empty | Your own [TMDB](https://www.themoviedb.org/settings/api) API key (v3). It outranks the key embedded in the build and is outranked by one saved in the UI. |
| `KESTREL_TVDB_API_KEY` | empty | Your own TheTVDB key, same precedence. |

The image has a `HEALTHCHECK` on the unauthenticated `GET {base}/ping`.

Before each schema migration of an existing database Kestrel copies it to `backups/kestrel-<schema>-<timestamp>.db` and keeps the newest five. Kestrel never downgrades: if the database is newer than the binary, it refuses to start and names the backup to restore.

### The API

The REST API is defined by [`api/openapi.yaml`](api/openapi.yaml) ([ADR 0009](docs/adr/0009-spec-first-openapi.md)). A running instance serves it at `{base}/api/v1/openapi.json` and the interactive docs (Scalar, loaded from a CDN) at `{base}/api/docs`.

Scripts authenticate with the single full-access key from Settings > Security, sent as `X-Api-Key: kst_...` (header only). Bad keys are throttled like failed logins.

### Forgot your password

The only CLI command resets the admin password and logs every session out. It works while Kestrel is running:

```sh
docker exec -it kestrel kestrel reset-password
```

Pass `--password-stdin` to read the new password from stdin instead of prompting.

## Develop

Needs Go, Node and `make`. Docker is only for the image and the compose check. Every other tool is pinned (Go `tool` directives in `go.mod`, devDependencies in `package.json`), so nothing needs a global install.

```sh
make help          # list every command
make dev-api       # Go server on :7676, config in .dev/config
make dev-web       # Vite dev server with hot reload; proxies /api to :7676
make test          # Go tests (race detector) and SPA tests
make generate      # regenerate code from api/openapi.yaml and the SQL
make check         # everything CI checks except the image build and commitlint
make build         # bin/kestrel with the SPA embedded
make build-silo    # bin/kestrel-silo, the Silo request router plugin
make docker        # build the image as kestrel:dev
make hooks         # install the commitlint commit-msg hook
```

Run `make dev-api` and `make dev-web` in two terminals, then open the Vite URL.

Without a TMDB key, search and add answer `502 upstream_unavailable`. For development set `KESTREL_TMDB_API_KEY`. A release build embeds the project's key at link time: `make build TMDB_API_KEY=...` (or `--build-arg TMDB_API_KEY=...` for `make docker`'s Dockerfile). The default build embeds none.

### Layout

| Path | What lives there |
|---|---|
| `cmd/kestrel` | `main`: reads config, opens the store, wires modules, serves HTTP. |
| `internal/<module>` | One package per module of the architecture (PRD #22). Calls only go downwards. Today: `store`, `settings`, `release`, `api`, `config`, `version`. |
| `internal/release` | Release name parsing: a Go port of Radarr's (Movies) and Sonarr's (Series) parsers, with the upstream commit recorded in each ported file. Its tests replay Radarr's and Sonarr's own fixtures and golden `/api/v3/parse` files from `testdata/`, see its README. |
| `internal/scoring` | `Evaluate`: scores a Release with TRaSH's Custom Formats and applies the Profile's language, resolution and minimum-Score rules. The TRaSH snapshot (MIT, with its licence and commit) is embedded from `trash/`; refresh it with `scripts/update-trash-snapshot.sh`. Its tests replay golden matched-Custom-Format sets recorded from pinned Radarr and Sonarr (`testdata/`, `scripts/regen-cf-golden.sh`). |
| `internal/resolution` | The SD/HD/UHD resolution classes shared by scoring and probe. |
| `internal/metadata` | The TMDB client (search, Movie details with release dates, certifications and aliases), provider key precedence and the poster cache. `metadatatest` is a fake TMDB serving hand-written fixtures; no key is needed to run the tests. |
| `internal/library` | Titles, Versions, files and search state, plus the add panel's preselection (`Suggest`). Movies only so far; the schema already holds seasons and episodes. |
| `scripts/` | Dev-only tools: fixture extraction, golden-file regeneration for the parser port and the Custom Format parity harness, TRaSH snapshot refresh (Docker, never run in CI). |
| `api/openapi.yaml` | The hand-written API contract and the source of truth. |
| `internal/api/oapi` | Generated Go server interface and models (oapi-codegen, strict server). Do not edit. |
| `internal/store/migrations` | goose migrations, embedded in the binary. Also the schema sqlc reads. |
| `internal/<module>/queries.sql` | sqlc queries, generated into `internal/<module>/db`. Register new modules in `sqlc.yaml`. |
| `web/` | The React + Vite + Tailwind SPA (Geist style). `web/src/api/schema.gen.ts` is generated (openapi-typescript). |
| `web/dist` | The built SPA, embedded by `web/embed.go`. Empty in the repo apart from `.keep`, so Go builds and tests never need Node. |
| `docker/`, `Dockerfile` | The image: Alpine with ffmpeg, tzdata and su-exec. |

### Releases

[release-please](release-please-config.json) keeps a release PR open on `main`; merging it tags `vX.Y.Z` (versions stay `0.x`) and writes `CHANGELOG.md` from `feat`, `fix` and `perf` commits. The release workflow then runs [GoReleaser](.goreleaser.yaml), which attaches the Silo plugin binaries (`kestrel-silo-linux-amd64`, `-linux-arm64`, `-darwin-arm64`), `checksums.txt`, `silo-repository.json` and `THIRD_PARTY_NOTICES.md` to that release, and pushes the multi-arch image `ghcr.io/hyprsh/kestrel` (`X.Y.Z`, `X.Y`, `X`, `latest`); every push to `main` also publishes `:edge`. Binaries, checksums and the image carry build-provenance attestations. Silo users add `https://github.com/hyprsh/kestrel/releases/latest/download/silo-repository.json` as a plugin repository.

`make release-dry-run` runs all of it except publishing. `make notices` regenerates `internal/notices/THIRD_PARTY_NOTICES.md` (Go and npm dependency licences, the ported Radarr and Sonarr code, TRaSH data); do it when dependencies or the embedded TRaSH snapshot change. The repository needs a `TMDB_API_KEY` Actions secret to embed the project's key in the image.

Once a day, unless Settings > Updates > "Check GitHub for updates" is off, Kestrel asks GitHub (unauthenticated) for the latest release and the published security advisories of `hyprsh/kestrel`. A newer release shows in the health strip and About. An advisory whose vulnerable range covers the running version raises the "Security fix available" Warning in Needs attention. `dev` and `edge` builds never compare versions. Publish a GHSA to announce a security fix.

### Conventions

- **Spec first.** Add an endpoint to `api/openapi.yaml`, run `make generate`, then implement the generated `StrictServerInterface` method. CI fails when generated Go or TypeScript differs from what the spec produces.
- **Tests at the seams.** Go: the store, and the `api` module through HTTP against a real temp-dir SQLite, with every response validated against the spec (kin-openapi). SPA: Vitest and Testing Library with MSW handlers typed from the spec (`web/src/test/handlers.ts`), so a handler that drifts from the spec does not compile.
- **Migrations.** Add `internal/store/migrations/NNNNN_name.sql` in goose format. Migrations only go forward.
- **Commits** are [Conventional Commits](https://www.conventionalcommits.org/) with all types allowed (`feat fix docs style refactor perf test build ci chore revert`), checked by commitlint on PR titles and locally by `make hooks`. Only `feat`, `fix` and `perf` reach the changelog.
- **Base URL.** `web/index.html` carries `<base href="/" />` and the server rewrites it to `KESTREL_BASE_URL`, so the SPA uses relative URLs and the API client resolves against `document.baseURI`.
