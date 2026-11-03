---
name: demo
description: Run Kestrel with a seeded Library against fake TMDB, TheTVDB, indexer and SABnzbd, drive it in a headless browser, and publish before/after screenshots for a PR. Use when a PR needs screenshots, or to see a UI change in the running app with realistic data.
---

`scripts/demo` runs a real Kestrel binary against `fake.py`, one local server standing in for TMDB, TheTVDB, a Newznab indexer, SABnzbd, plex.tv and a Plex server, and seeds it with Paddington and a Breaking Bad with files in both Slots, a Grab downloading, two recent Imports and two Requests. `demo.sh` builds, starts and stops; `lib.mjs` drives the SPA through Playwright; `publish.sh` puts the screenshots on GitHub. Kestrel reaches the fake through `KESTREL_TMDB_API_URL`, `KESTREL_TMDB_IMAGE_URL`, `KESTREL_TVDB_API_URL`, `KESTREL_PLEX_TV_URL` and `KESTREL_PLEX_APP_URL`.

Keep every binary, scenario and screenshot in your scratchpad (`$S` below). Run the scripts from the repo root.

## Steps

1. **Set up.** `npm ci --prefix scripts/demo`. The browser is an installed Google Chrome, `$DEMO_CHROME`, or Playwright's Chromium after `npx --prefix scripts/demo playwright-core install chromium`. Done when `scripts/demo/node_modules/playwright-core` exists.

2. **Build the pair of binaries.** `scripts/demo/demo.sh build origin/main $S/kestrel-before`, then `scripts/demo/demo.sh build . $S/kestrel-after` for the working tree as it is (or name the PR's ref). A ref without the provider URLs (`git grep -q KESTREL_TMDB_API_URL <ref> -- internal/config` fails) reaches the real TMDB and shows an empty Library. `build .` reuses `web/node_modules` and runs `npm ci` there only when it is missing or older than `package-lock.json` (so it does not break a dev server or tests that are using it); a ref is built from a temporary copy with its own `npm ci`. Done when both binaries exist.

3. **Plan the shots.** List every user-visible change of the PR and the screen that shows it. Each change gets a before/after pair, named `NN-<what>-before.png` and `NN-<what>-after.png`; new UI with nothing to compare gets an after shot alone. Done when every change has a named shot and you know which seeded data shows it (see [Demo data](#demo-data)).

4. **Write the scenario.** One script in `$S`, run once per label, that opens the screens and saves the shots:

   ```js
   // node $S/scenario.mjs <before|after> <out dir>
   import { open, wait } from '<repo>/scripts/demo/lib.mjs'
   const [label, out] = process.argv.slice(2)
   const h = await open()                       // 1440x900, light theme, logged in
   await h.openTitle('Breaking Bad')
   await h.shot(`${out}/01-series-${label}.png`)
   await h.clickAria('Add Title (⌘ K)')
   await h.page.keyboard.type('paddington')
   await h.waitText('Paddington in Peru')
   await h.shot(`${out}/02-add-search-${label}.png`)
   await h.close()
   ```

   `h.page` is a Playwright page for everything the helpers in `lib.mjs` don't cover. To find what to click, `node scripts/demo/shot.mjs $S/look.png [title]` saves one screenshot and prints the page's text. Done when the scenario saves every planned shot.

5. **Shoot.** For each label: `scripts/demo/demo.sh start $S/kestrel-<label>`, then `node $S/scenario.mjs <label> $S/shots`. `start` wipes and reseeds, so both runs see the same data. Open every PNG and look at it. Done when each shot shows the change it was planned for, with no error toast, spinner or half-loaded list in it.

6. **Stop.** `scripts/demo/demo.sh stop`. Done when nothing listens on the demo ports.

7. **Publish.** `scripts/demo/publish.sh <PR> $S/shots` commits the images to the folder `<PR>/` of the orphan branch `pr-assets`, which holds every PR's screenshots, and prints a raw URL per image, pinned to that commit. Embed them in the PR body's Evidence section, one Before/After table per change, with alt text saying what the shot shows:

   ```markdown
   - **Before:** what the screen did. **After:** what it does now.

     | Before | After |
     |---|---|
     | ![Series page before](<url of 01-series-before.png>) | ![Series page with coverage bars in the Versions card](<url of 01-series-after.png>) |
   ```

   Done when `gh pr view <PR>` shows every planned shot linked.

## A big Library

`DEMO_TITLES=4000 demo.sh start …` grows the seeded Library to that many Titles, for measuring lists, filters and endpoints at scale. `seed_big.py` writes them straight into SQLite (about 10 seconds for 4,000): three Movies to one Series, named from word lists; of the Movies about 55 % have a Standard file, 12 % a 4K one too, 23 % are Wanted and 10 % are not monitored; a Series has 2 to 6 Seasons of 6 to 12 episodes, mostly with a Standard file per aired episode, some with 4K, some missing the newest ones; plus 400 finished Grabs. The new Titles have no posters and sort after the six seeded ones under "Newest added" (they are all dated 200 days back). Without `DEMO_TITLES` nothing changes.

## Sweep

`node scripts/demo/sweep.mjs <out dir> [screen…] [--dark]` shoots every screen of a running demo at 390x844 and 1440x900 (`<screen>-390.png`, `<screen>-1440.png`, `-dark` variants with `--dark`) and prints one line per screen: Overview, Library, a Movie and a Series Title page, Upcoming, Requests, Activity, Health, Log, every Settings section, About, and the phone More sheet (390 only). A page whose `scrollWidth` exceeds the viewport is reported as OVERFLOW and the exit code is 1. `--list` names the screens.

When a change touches `web/src`, start the demo on the working tree (steps 1, 2 and 5), run the sweep for the touched screens (all of them for a shared piece such as `layout/` or `shell/`) with the shots in `$S`, and look at every 390 shot before reporting done. Done when no screen overflows and no 390 shot has clipped text, a cut-off control or a control hidden behind the tab bar.

## Guide screenshots

`make docs-shots` runs this demo for `docs/guide/images/`: `scripts/demo/docs-shots.sh` builds the working tree, shoots the setup screen on an unseeded demo (`DEMO_SEED=0 demo.sh start`) and the Library on a seeded one, in light and dark, with `docs-shots.mjs`, and rewrites only the PNGs whose decoded pixels differ from the committed ones beyond a small threshold (`png-sync.mjs`), so a second run leaves the tree clean (it runs in the fixed `/tmp/kd-shots`, so the paths in the shots do not change, and takes a `/tmp/kd-shots.lock`; `DOCS_SHOTS_SHARE=0` takes every change). Each must stay under 200 KB. Add a screen by adding its shot to `docs-shots.mjs`, and reference it from a guide.

## Demo data

The fake's catalogue (titles, which searches match, the slow and the broken Series) is in `fake.py`'s docstring; what the seed adds is in `seed.py`'s. Plex sign-in is on, with the fake's friend Ellie: log out and "Sign in with Plex" on the login page signs in as her (the fake's sign-in page authorises the PIN as Ellie and sends the browser back), and her Requests show as source `plex`. A ref without `KESTREL_PLEX_TV_URL` (`git grep -q KESTREL_PLEX_TV_URL <ref> -- internal/config` fails) has no Plex sign-in and the seed fails on it. Anything else a shot needs, the scenario sets up first, through the API with the page's session (`h.page.evaluate(() => fetch('api/v1/...'))`) or by clicking.

- **Overview's sections:** the seed fills Happening now and Activity's pipeline with one Grab, Paddington in Peru's Blu-ray, which the fake SABnzbd holds at 40 % (made through the API with the indexer's releases on for that moment). Recently added and Activity's Done stage list two Imports of the last days, Paddington and Breaking Bad S05E07-E08 as one Import of two files. Recent requests and the Requests screen list two Requests from Ellie through Plex: Paddington (Completed) and Paddington 2 (Searching, nothing to find). Happening now also has one Long Missing group row, Paddington 2 (Wanted and Long Missing). `DEMO_SEED=0` seeds none of this.
- **Indexer releases:** none until `scripts/demo/demo.sh releases on`; `start` turns them off again.
- **Unlisted episodes and seasons:** with releases on, `scripts/demo/demo.sh unlisted on` also lets the fake offer Breaking Bad Releases TheTVDB doesn't list: the episode after the last one of the season asked for, and the season after the last (a pack and episode 1). It shows Placeholder Episodes (`episode_not_listed`, `season_not_listed`). `unlisted off` removes them, and `start` turns them off again.
- **Login:** `demo` / `demo-password-123`.
- **Paths in shots:** files live under `$DEMO_DIR`, which defaults to a short `/tmp/kd-<8 hex digits>` derived from the worktree's path, which keeps the paths in path popovers and the Overview's Health panel short. A `DEMO_DIR` of your own should be short too for any shot that shows Health: a long one wraps the data dir and root folder paths over two lines and shows the local user's directory.
- **Several demos at once:** each worktree has its own demo. The directory, the Kestrel port (`20000` plus an even offset below 2000) and the fake's port (the next one) all derive from a hash of the worktree's path, so two worktrees never clash, and `stop`, `status` and a second `start` in the same worktree find the same run (`stop` stops only that one). `demo.sh port` prints the Kestrel port; `lib.mjs` asks it when `DEMO_PORT` is unset. To override, export `DEMO_DIR`, `DEMO_PORT` and `DEMO_FAKE_PORT` for every `demo.sh` call and the scenario. `start` refuses a `DEMO_DIR` it did not create, and a taken port stops it with a message (a hash collision with another worktree is possible but rare: set `DEMO_PORT`).
- **Seed failures:** `seed.py` writes files straight into SQLite. When a migration changes `titles`, `versions`, `episodes`, `files` (including its `grab_id` and `imported_at` columns), `file_episodes`, `title_release_dates`, `grabs`, `grab_episodes` or `plugin_instances`, fix `seed.py` in the same PR.
- **Logs:** `$DEMO_DIR/logs/kestrel.log` and `fake.log`.
