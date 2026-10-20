---
name: demo
description: Run Kestrel with a seeded Library against fake TMDB, TheTVDB, indexer and SABnzbd, drive it in a headless browser, and publish before/after screenshots for a PR. Use when a PR needs screenshots, or to see a UI change in the running app with realistic data.
---

`scripts/demo` runs a real Kestrel binary against `fake.py`, one local server standing in for TMDB, TheTVDB, a Newznab indexer and SABnzbd, and seeds it with Paddington and a Breaking Bad with files in both Slots. `demo.sh` builds, starts and stops; `lib.mjs` drives the SPA through Playwright; `publish.sh` puts the screenshots on GitHub. Kestrel reaches the fake through `KESTREL_TMDB_API_URL`, `KESTREL_TMDB_IMAGE_URL` and `KESTREL_TVDB_API_URL`.

Keep every binary, scenario and screenshot in your scratchpad (`$S` below). Run the scripts from the repo root.

## Steps

1. **Set up.** `npm ci --prefix scripts/demo`. The browser is an installed Google Chrome, `$DEMO_CHROME`, or Playwright's Chromium after `npx --prefix scripts/demo playwright-core install chromium`. Done when `scripts/demo/node_modules/playwright-core` exists.

2. **Build the pair of binaries.** `scripts/demo/demo.sh build origin/main $S/kestrel-before`, then `scripts/demo/demo.sh build . $S/kestrel-after` for the working tree as it is (or name the PR's ref). A ref without the provider URLs (`git grep -q KESTREL_TMDB_API_URL <ref> -- internal/config` fails) reaches the real TMDB and shows an empty Library. Done when both binaries exist.

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
     | ![Series page before](<url of 01-series-before.png>) | ![Series page with coverage lines](<url of 01-series-after.png>) |
   ```

   Done when `gh pr view <PR>` shows every planned shot linked.

## Demo data

The fake's catalogue (titles, which searches match, the slow and the broken Series) is in `fake.py`'s docstring; what the seed adds is in `seed.py`'s. Anything else a shot needs, the scenario sets up first, through the API with the page's session (`h.page.evaluate(() => fetch('api/v1/...'))`) or by clicking.

- **Indexer releases:** none until `scripts/demo/demo.sh releases on`; `start` turns them off again.
- **Login:** `demo` / `demo-password-123`.
- **Paths in shots:** files live under `$DEMO_DIR`, default `/tmp/kestrel-demo`, which keeps the paths in path popovers short.
- **Several demos at once:** a taken port is usually another agent's demo; leave it running and give yours its own `DEMO_DIR`, `DEMO_PORT` (default 7677) and `DEMO_FAKE_PORT` (default 7690), exported for every `demo.sh` call and the scenario (`lib.mjs` reads `DEMO_PORT`). `start` refuses a `DEMO_DIR` it did not create.
- **Seed failures:** `seed.py` writes files straight into SQLite. When a migration changes `titles`, `versions`, `files` or `file_episodes`, fix `seed.py` in the same PR.
- **Logs:** `$DEMO_DIR/logs/kestrel.log` and `fake.log`.
