# Kestrel

One app that replaces Radarr and Sonarr for usenet. Movies and Series are two kinds of Title, each with up to two Slots (Standard and 4K) holding one Version apiece. See [`GLOSSARY.md`](GLOSSARY.md) for the terms and [`docs/adr/`](docs/adr/) for the decisions behind the design. The spec is [hyprsh/kestrel#22](https://github.com/hyprsh/kestrel/issues/22).

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

Bootstrap settings are environment variables. Everything else lives in SQLite and is set in the UI, unless a [Config File](#the-config-file) declares it: a Config File may declare sections, and overrides the UI for those sections ([ADR 0014](docs/adr/0014-config-file-declares-sections.md)).

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
| `KESTREL_API_KEY` | empty | A fixed full-access API key, for deployments that wire Kestrel up from a script. It must look like a generated key: `kst_` followed by at least 32 characters from `A-Z` and `2-7` (`echo kst_$(LC_ALL=C tr -dc A-Z2-7 </dev/urandom \| head -c 52)`); anything else stops startup. While set it replaces the key from Settings > Security, which is deleted, and rotating in the UI is disabled. Removed again, there is no key until one is generated in the UI. |
| `KESTREL_CONFIG_FILE` | empty | Path of a [Config File](#the-config-file), which declares sections the UI then can't change. Unset, everything is set in the UI. |

The image has a `HEALTHCHECK` on the unauthenticated `GET {base}/ping`.

Before each schema migration of an existing database Kestrel copies it to `backups/kestrel-<schema>-<timestamp>.db` and keeps the newest five. Kestrel never downgrades: if the database is newer than the binary, it refuses to start and names the backup to restore.

### The Config File

For a deployment that wants Kestrel set up the same way every time. `KESTREL_CONFIG_FILE` names a YAML file that declares sections: the account, the language and region, the root folders, the Profiles, plugin instances, the reverse proxy, Plex sign-in for Requesters and the GitHub update check. On every start, after the database opens and before Kestrel serves or runs its loops, Kestrel checks the whole file with the rules the API uses and then brings each declared section to the file's state, writing only what differs. A file that fails a check stops startup before anything is written. The error names the file, the field and, where it can, the line, and never carries a secret.

This file declares every section:

```yaml kestrel.yaml
# Every section is optional: leave one out and it stays in the UI.
account:
  username: admin
  password_env: KESTREL_ADMIN_PASSWORD # a secret is named by its environment variable, never written here

language_region:
  primary_language: de # en, de or fr
  release_date_country: DE

root_folders: # the first of each list is the default
  movies: [/data/media/movies, /data/media/movies-kids]
  series: [/data/media/tv]

profiles: # all six or none, each with all four fields
  hd-primary: { enabled: true, original_language: accept, default_movies: true, default_series: true }
  hd-original: { enabled: true, original_language: reject, default_movies: false, default_series: false }
  any-primary: { enabled: false, original_language: reject, default_movies: false, default_series: false }
  any-original: { enabled: false, original_language: reject, default_movies: false, default_series: false }
  4k-primary: { enabled: true, original_language: accept, default_movies: false, default_series: false }
  4k-original: { enabled: false, original_language: reject, default_movies: false, default_series: false }

plugin_instances: # known by name
  - name: SABnzbd
    plugin_id: sabnzbd
    enabled: true # optional: leave it out and the UI switches the instance on and off
    config:
      url: http://sabnzbd:8080
      api_key_env: SABNZBD_API_KEY
      movie_category: movies
      tv_category: tv
  - name: Indexer
    plugin_id: newznab
    priority: 0 # lower wins a tie between otherwise equal Releases
    config:
      url: https://indexer.example
      api_key_env: INDEXER_API_KEY
      api_requests_per_day: 100
  - name: Jellyfin
    plugin_id: jellyfin
    enabled: true
    config:
      url: http://jellyfin:8096
      api_key_env: JELLYFIN_API_KEY
  - name: Plex
    plugin_id: plex
    config:
      url: http://plex:32400
      token_env: PLEX_TOKEN

reverse_proxy: # all three fields, as in Settings > Security
  enabled: false
  trusted_proxies: [172.16.0.0/12]
  header: Remote-User

plex_sign_in: # Requesters sign in with Plex; see "Requesters (Plex sign-in)"
  enabled: true
  instance: Plex # the name of a plex plugin instance, which holds the server and its owner's token
  users: [anna, ben] # optional: only these Plex users may request; leave it out or empty for everyone with access
  user_root_folders: # optional: where a user's Requests for new Titles go, instead of the first Root folder
    anna: { movies: /data/media/movies-kids }
    ben: { series: /data/media/tv }

check_github_updates: true
```

Add it to the `kestrel` service in `compose.yaml`, and keep the secrets in a `.env` file next to it. Mount the file outside `/config`: the entrypoint `chown`s `/config`, which fails on a read-only mount. The file must be readable by `PUID`.

```yaml
services:
  kestrel:
    environment:
      - KESTREL_CONFIG_FILE=/kestrel.yaml
      - KESTREL_ADMIN_PASSWORD=${KESTREL_ADMIN_PASSWORD}
      - SABNZBD_API_KEY=${SABNZBD_API_KEY}
      - INDEXER_API_KEY=${INDEXER_API_KEY}
      - JELLYFIN_API_KEY=${JELLYFIN_API_KEY}
      - PLEX_TOKEN=${PLEX_TOKEN}
    volumes:
      - ./kestrel.yaml:/kestrel.yaml:ro
```

With every section declared, setup is completed at startup and the first page is the login. Setup completes as soon as nothing is left to do, from the file or from the UI: an account, the language, an enabled download client, an enabled indexer and the root folders.

How it behaves:

- **Every section is optional.** A section the file leaves out stays in the UI, exactly as without a file. A section key with nothing under it (`profiles:` alone) fails startup: leave the key out instead. An unknown key fails startup with its line.
- **Declared sections are read-only.** The UI shows them disabled, and the API answers `409 conflict` naming the file to every write to a declared section, a declared instance or the declared account, including the password change and `POST /setup/account`. GET responses report `from_config_file`. `kestrel reset-password` refuses a declared account. To change a declared value, change the file and restart.
- **A section dropped from the file keeps its last value** and is the UI's to change again.
- **Secrets are never in the file.** A secret field is given only as `<field>_env`, naming the environment variable that holds it. A secret written inline, an unset or empty variable, or a value that isn't a variable name fails startup.
- **`account`**: created when there is none. The username is set from the file, and the password from its variable on every start. A password that changes ends the admin's sessions, and leaves the Requesters' alone.
- **`language_region`**: `primary_language` is `en`, `de` or `fr`, and `release_date_country` a two-letter uppercase code. A new Primary Language re-scores the files, as it does in Settings.
- **`root_folders`**: `movies` and `series`, each a list whose first folder is the default. Every folder must exist and be writable.
- **`profiles`** must list every Profile: `hd-primary`, `hd-original`, `any-primary`, `any-original`, `4k-primary` and `4k-original`, each with `enabled`, `original_language`, `default_movies` and `default_series`. `original_language` says what a Profile does with a Release that has the Title's Original Language but no Primary-Language audio: `reject` it, `offer` it for approval in Needs attention, or `accept` it. The older `original_fallback` still works in its place (`true` is `accept`, `false` is `reject`). The rules of Settings > Profiles hold across the six: an Original-Language Profile (`*-original`) always rejects, a default must be enabled, a Slot has at most one default per kind, and the Standard Slot has exactly one for Movies and one for Series. The 4K Slot may have none.
- **`plugin_instances`**: each has a `name` and a `plugin_id`, and may set `enabled`, `priority` (default `0`) and `config`. A new instance starts enabled when the file leaves `enabled` out. The plugin's defaults fill the config fields left out.
  - Instances are known by name, and a name is declared once. A declared instance is created when missing and updated in place when it differs.
  - Renaming an instance in the file (or changing its `plugin_id`) deletes it and creates a new one. Don't rename a download client while Grabs are in flight: a Grab belongs to the instance it was sent to, and the new one is a different instance.
  - An instance removed from the file is deleted on the next start. `plugin_instances: []` declares none, and deletes the instances the file declared before. Leaving `plugin_instances` out instead hands its instances back to the UI, and once the section returns they count as instances created in the UI.
  - Instances created in the UI are never touched. On the first start that declares a name, an instance created in the UI with that exact name and the same plugin is taken over instead of duplicated. A name the UI uses for another plugin, or for two instances, fails startup.
  - A declared instance can be tested in the UI but not changed or removed, except that the UI can switch it on and off when the file leaves its `enabled` out (Kestrel keeps that value across restarts), and its name can't be given to an instance in the UI: creating or renaming one to it answers `409 conflict`. Instances created in the UI may still share names with each other.
  - An `enabled` the file sets is enforced, so switching that instance off is a file change and a restart, and a toggle in the UI answers `409 conflict`. A file that would exceed a contract's cap on enabled instances (one download client) fails startup, counting the enabled instances created in the UI and the stored `enabled` of declared instances whose `enabled` the file leaves out.
  - After applying the file, Kestrel tests the connection of each enabled declared instance. An instance that can't connect at startup is only logged as a warning, and Kestrel starts anyway.
- **`reverse_proxy`**: `enabled`, `trusted_proxies` and `header`, all three, checked as in Settings > Security. `trusted_proxies` alone makes Kestrel believe `X-Forwarded-For` and `X-Forwarded-Proto` from those addresses, so the login throttle counts each client behind the proxy on its own; `enabled` only adds login from `header`, and needs at least one trusted proxy. Keep `enabled: false` unless an SSO portal sets the header.
  - **Upgrading:** Kestrel no longer believes `X-Forwarded-Proto` from an address outside `trusted_proxies`. Behind a proxy that terminates TLS with `trusted_proxies` empty, the session cookie used to get its `Secure` flag from that header and now silently doesn't. List the proxy in `trusted_proxies` (in Settings > Security or here), with `enabled: false` if you want no header login.
- **`plex_sign_in`**: `enabled`, and when it is `true` the `instance` (the name of a `plex` plugin instance, declared in the same file or made in the UI). `users` and `user_root_folders` are optional and default to none. `user_root_folders` is a map from a Plex user to `movies` and `series`, each optional and one of that kind's Root folders. Users are unique ignoring case, in both `users` and the map's keys. Checked with the rules of `PUT /settings/plex-sign-in`, against the instances and Root folders the file declares. Applied after the plugin instances and the Root folders.
- **`check_github_updates`**: `true` or `false`.
- **Not in the file:** TRaSH's daily update (`trash.auto_update`) and the TMDB and TheTVDB key overrides stay in the UI. Use `KESTREL_TMDB_API_KEY` and `KESTREL_TVDB_API_KEY` for your own keys, and `KESTREL_API_KEY` for the API key.

The plugins' config fields (secrets are given as `<field>_env`):

| `plugin_id` | Fields |
|---|---|
| `sabnzbd` | `url`, `api_key` (secret), `movie_category` (default `movies`), `tv_category` (default `tv`) |
| `newznab` | `url`, `api_key` (secret), `movie_categories` (default `2000`), `tv_categories` (default `5000`), `api_requests_per_day` (empty for no limit) |
| `jellyfin` | `url`, `api_key` (secret) |
| `plex` | `url`, `token` (secret) |
| `silo` | `url`, `api_key` (secret, the admin API key) |

### Requesters (Plex sign-in)

People who share your Plex server can ask for Movies and Series in Kestrel without an app like Seerr in front of it ([ADR 0018](docs/adr/0018-requesters-sign-in-with-plex.md)). Switch it on in Settings (or declare `plex_sign_in` in the Config File) and pick the Plex instance whose server and owner token decide who may sign in. The login page then offers "Sign in with Plex": Kestrel sends the browser to plex.tv, plex.tv sends it back to Kestrel's login page with `?plex=1`, and Kestrel finishes the sign-in there. The browser that started a sign-in is the only one that can finish it.

- **Who may sign in:** the server's owner, members of the owner's Plex Home, and friends whose share includes this server, read with the owner's token from the Plex instance. A list of `users` narrows that to those Plex usernames (or names, for a Home user without one), ignoring case. The Requester's own Plex token is used once, to learn who they are, and never stored.
- **What a Requester can do:** search Titles, make a Request and see their own Requests, and nothing else; every other route answers `403 forbidden`. A Request asks for the Standard Slot under Profile resolution, goes in the kind's first Root folder unless `user_root_folders` names another for that user, and shows up in the Requests screen and the Log like any other, with the source `plex`.
- **Sessions:** a Requester's session lasts 30 days from the last use, like the admin's. At most once an hour it is checked again against the owner's list, and it ends when the account lost access, left `users`, or Plex sign-in was switched off. A plex.tv outage does not end sessions. Changing the admin password ends the other admin sessions only; Log out everywhere ends every session.
- **Network:** Kestrel calls plex.tv (`https://plex.tv`) to create and read PINs, learn an account and read the owner's shared users, and it identifies itself with a client identifier it generates once per instance. It needs outbound access to plex.tv, and the browser needs to reach `https://app.plex.tv`.
- **Behind a TLS proxy:** the redirect back to Kestrel is built from the request: `https` when the request is secure, the `Host` header and the base URL. List the proxy in `trusted_proxies` (Settings > Security, or `reverse_proxy` in the Config File), so Kestrel believes its `X-Forwarded-Proto` and `X-Forwarded-For`, the session and PIN cookies get `Secure`, and the proxy passes the `Host` header on unchanged.

### The API

The REST API is defined by [`api/openapi.yaml`](api/openapi.yaml) ([ADR 0009](docs/adr/0009-spec-first-openapi.md)). A running instance serves it at `{base}/api/v1/openapi.json` and the interactive docs (Scalar, loaded from a CDN) at `{base}/api/docs`.

Scripts authenticate with the single full-access key from Settings > Security (or `KESTREL_API_KEY`), sent as `X-Api-Key: kst_...` (header only). Bad keys are throttled like failed logins.

### Forgot your password

The only CLI command resets the admin password and logs every session out. It works while Kestrel is running:

```sh
docker exec -it kestrel kestrel reset-password
```

Pass `--password-stdin` to read the new password from stdin instead of prompting.

It refuses an account the [Config File](#the-config-file) declares: change the password's environment variable and restart instead.

## Develop

Needs Go, Node and `make`. Docker is only for the image and the compose check. Every other tool is pinned (Go `tool` directives in `go.mod`, devDependencies in `web/package.json`), so nothing needs a global install.

```sh
make help          # list every command
make dev-api       # Go server on :7676, config in .dev/config
make dev-web       # Vite dev server with hot reload; proxies /api to :7676
make test          # Go tests (race detector) and SPA tests
make generate      # regenerate code from api/openapi.yaml and the SQL
make check         # everything CI checks except the image build and the PR-title check
make build         # bin/kestrel with the SPA embedded
make build-silo    # bin/kestrel-silo, the Silo request router plugin
make docker        # build the image as kestrel:dev
make hooks         # check commit headers on commit (.githooks/commit-msg)
```

Run `make dev-api` and `make dev-web` in two terminals, then open the Vite URL.

Without a TMDB key, search and add answer `502 upstream_unavailable`. For development set `KESTREL_TMDB_API_KEY`. A release build embeds the project's keys at link time: `make build TMDB_API_KEY=... TVDB_API_KEY=...` (or `--build-arg TMDB_API_KEY=...` for `make docker`'s Dockerfile). The default build embeds none.

To see a change with realistic data, no keys and no network, run Kestrel against the fakes in `scripts/demo` (TMDB, TheTVDB, a Newznab indexer and SABnzbd, seeded with a Library); the [demo skill](.claude/skills/demo/SKILL.md) walks through it, including before/after screenshots for a PR.

### Layout

| Path | What lives there |
|---|---|
| `cmd/kestrel` | `main`: reads config, opens the store, starts `internal/app`, serves HTTP and runs the loops. |
| `internal/app` | The composition root: builds every module, wires them through their interfaces and hands the API the ones it calls. `cmd/kestrel` and the API tests both start Kestrel through it. |
| `internal/<module>` | One package per module of the architecture (PRD #22). Calls only go downwards and only `jobs` strings modules together. The modules: `store`, `settings`, `history`, `health`, `metadata`, `release`, `scoring` (with `profiles` and the TRaSH snapshot service `trashsync`), `library`, `indexers`, `downloads`, `acquire`, `imports` (Import, Adoption, Clean up, naming, renames, media-server refresh), `requests`, `jobs`, `api` and `plugin/...`; plus the leaf packages `resolution`, `probe`, `updates`, `silo`, `notices`, `plextv`, `config` and `version`. |
| `internal/release` | Release name parsing: a Go port of Radarr's (Movies) and Sonarr's (Series) parsers, with the upstream commit recorded in each ported file. Its tests replay Radarr's and Sonarr's own fixtures and golden `/api/v3/parse` files from `testdata/`, see its README. |
| `internal/scoring` | `Evaluate`: scores a Release with TRaSH's Custom Formats and applies the Profile's language, resolution and minimum-Score rules. The TRaSH snapshot (MIT, with its licence and commit) is embedded from `trash/`; refresh it with `scripts/update-trash-snapshot.sh`. Its tests replay golden matched-Custom-Format sets recorded from pinned Radarr and Sonarr (`testdata/`, `scripts/regen-cf-golden.sh`). |
| `internal/resolution` | The SD/HD/UHD resolution classes shared by scoring and probe (a Slot is its own type in `internal/slot`). |
| `internal/metadata` | The TMDB and TheTVDB clients (search, Movie and Series details, release dates, certifications and aliases), the TMDB to TheTVDB bridge, provider key precedence and the poster cache. `metadatatest` is a fake TMDB serving hand-written fixtures; no key is needed to run the tests. |
| `internal/plextv` | The plex.tv client behind Requesters' Plex sign-in: PINs, the account behind a token, the owner's shared users, the Plex server's identity, and the access rule built from them. `plextvtest` is a fake plex.tv and Plex server for tests. |
| `internal/library` | Titles (Movies and Series with seasons and episodes), Versions, files, monitoring and search state, plus the add panel's preselection (`Suggest`). |
| `scripts/` | Dev-only tools: fixture extraction, golden-file regeneration for the parser port and the Custom Format parity harness, TRaSH snapshot refresh (Docker, never run in CI), and the demo: fake providers, seed data and a headless-browser driver (`scripts/demo`). |
| `api/openapi.yaml` | The hand-written API contract and the source of truth. |
| `internal/api/oapi` | Generated Go server interface and models (oapi-codegen, strict server). Do not edit. |
| `internal/store/migrations` | goose migrations, embedded in the binary. Also the schema sqlc reads. |
| `internal/<module>/queries.sql` | sqlc queries, generated into `internal/<module>/db`. Register new modules in `sqlc.yaml`. |
| `web/` | The React + Vite + Tailwind SPA (Geist style). `web/src/api/schema.gen.ts` is generated (openapi-typescript). |
| `web/dist` | The built SPA, embedded by `web/embed.go`. Empty in the repo apart from `.keep`, so Go builds and tests never need Node. |
| `docker/`, `Dockerfile` | The image: Alpine with ffmpeg, tzdata and su-exec. |

### Releases

Releases are cut by asking Claude Code to release ([`.claude/skills/release`](.claude/skills/release/SKILL.md)). It picks the version from the Conventional Commits since the last tag (versions stay `0.x`), shows the notes for approval, writes them into `CHANGELOG.md` through a PR, and publishes the `vX.Y.Z` GitHub release with `gh release create`. Publishing the release starts the [release workflow](.github/workflows/release.yml): [GoReleaser](.goreleaser.yaml) attaches the Silo plugin binaries (`kestrel-silo-linux-amd64`, `-linux-arm64`, `-darwin-arm64`), `checksums.txt`, `silo-repository.json` and `THIRD_PARTY_NOTICES.md` to that release, and the workflow pushes the multi-arch image `ghcr.io/hyprsh/kestrel` (`X.Y.Z`, `X.Y`, `X`, `latest`); every push to `main` also publishes `:edge`. Binaries, checksums and the image carry build-provenance attestations. Silo users add `https://github.com/hyprsh/kestrel/releases/latest/download/silo-repository.json` as a plugin repository.

`make release-dry-run` runs all of it except publishing. `make notices` regenerates `internal/notices/THIRD_PARTY_NOTICES.md` (Go and npm dependency licences, the ported Radarr and Sonarr code, TRaSH data); do it when dependencies or the embedded TRaSH snapshot change. The repository needs a `TMDB_API_KEY` and a `TVDB_API_KEY` Actions secret to embed the project's keys in the image.

Once a day, unless Settings > Updates > "Check GitHub for updates" is off, Kestrel asks GitHub (unauthenticated) for the latest release and the published security advisories of `hyprsh/kestrel`. A newer release shows in the health strip and About. An advisory whose vulnerable range covers the running version raises the "Security fix available" Warning in Needs attention. `dev` and `edge` builds never compare versions. Publish a GHSA to announce a security fix.

### Conventions

- **Spec first.** Add an endpoint to `api/openapi.yaml`, run `make generate`, then implement the generated `StrictServerInterface` method. CI fails when generated Go or TypeScript differs from what the spec produces.
- **Tests at the seams.** Go: the store, and the `api` module through HTTP against a real temp-dir SQLite, with every response validated against the spec (kin-openapi). SPA: Vitest and Testing Library with MSW handlers typed from the spec (`web/src/test/handlers.ts`), so a handler that drifts from the spec does not compile.
- **Migrations.** Add `internal/store/migrations/NNNNN_name.sql` in goose format. Migrations only go forward.
- **Commits** are [Conventional Commits](https://www.conventionalcommits.org/) with all types allowed (`feat fix docs style refactor perf test build ci chore revert`), checked by `scripts/check-commit-header.sh` on PR titles (squash merges take the PR title as the header) and, after `make hooks`, on each commit. Only `feat`, `fix` and `perf` reach the changelog.
- **Base URL.** `web/index.html` carries `<base href="/" />` and the server rewrites it to `KESTREL_BASE_URL`, so the SPA uses relative URLs and the API client resolves against `document.baseURI`.
