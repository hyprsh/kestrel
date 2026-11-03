// node docs-shots.mjs <setup|app> <out dir>
// The screenshots of docs/guide, in light and dark, as NN-<name>-<theme>.png in <out dir>.
// `make docs-shots` runs it through docs-shots.sh against the demo, which starts the right
// instance for each phase: `setup` on an unseeded one (the setup wizard), `app` on the seeded one.
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { demoURL, launch, open, wait } from './lib.mjs'

const [phase, out] = process.argv.slice(2)
if (!['setup', 'app'].includes(phase) || !out) {
  console.error('usage: node docs-shots.mjs <setup|app> <out dir>')
  process.exit(2)
}
mkdirSync(out, { recursive: true })
const themes = ['light', 'dark']
const PASSWORD = 'demo-password-123'

async function context(browser, theme, width = 1280, height = 800) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    colorScheme: theme,
  })
  await ctx.addInitScript((t) => localStorage.setItem('kestrel.theme', t), theme)
  return ctx
}

async function save(target, name, theme, opts = {}) {
  const path = `${out}/${name}-${theme}.png`
  await wait(500)
  await target.screenshot({ path, ...opts })
  console.log('saved', path)
}

// A search pass that has just ended shows "Search done" on the Overview for a minute, which shifts the
// Wanted list down; whether it is there depends on timing, so dismiss it for steady shots.
async function dismissSearchDone(page) {
  const row = page.locator('[data-search-done]')
  await wait(500)
  if (await row.count()) {
    await row.getByRole('button', { name: 'Dismiss' }).click()
    await row.waitFor({ state: 'detached' })
  }
}

// setup shoots the wizard: the empty account step, then, with the account made, the download client
// and indexer forms filled in the way the guide says.
async function setup() {
  const browser = await launch()
  try {
    // The empty account step first, in both themes: it is gone once an account exists.
    for (const theme of themes) {
      const ctx = await context(browser, theme)
      const page = await ctx.newPage()
      await page.goto(demoURL() + '/')
      await page.getByRole('button', { name: 'Create account' }).waitFor()
      await save(page.locator('section[aria-labelledby="wizard-account"]'), '01-setup-account', theme)
      await ctx.close()
    }

    for (const theme of themes) {
      const ctx = await context(browser, theme)
      const page = await ctx.newPage()
      await page.goto(demoURL() + '/')
      if (theme === 'light') {
        await page.getByRole('button', { name: 'Create account' }).waitFor()
        await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
        await page.getByLabel('Confirm password').fill(PASSWORD)
        await page.getByRole('button', { name: 'Create account' }).click()
      } else {
        // The account exists since the light pass: log in with it, and the wizard is still open.
        await page.evaluate(async (password) => {
          await fetch('api/v1/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password }),
          })
        }, PASSWORD)
        await page.goto(demoURL() + '/')
      }
      await page.locator('section[aria-labelledby="wizard-download-client"]').waitFor()

      const sab = page.locator('section[aria-labelledby="wizard-download-client"]')
      await sab.getByLabel('URL').fill('http://sabnzbd:8080')
      await sab.getByLabel('API key').fill('3f9a1c5d7b2e4f60a8c1d9e2b4a67f03')
      await save(sab, '02-setup-download-client', theme)

      const idx = page.locator('section[aria-labelledby="wizard-indexer"]')
      await idx.getByLabel('URL').fill('https://indexer.example')
      await idx.getByLabel('API key').fill('b71e0c93a5d84f26e8a1c37d905f2b64')
      await idx.getByLabel('API requests per day').fill('100')
      await save(idx, '03-setup-indexer', theme)
      await ctx.close()
    }
  } finally {
    await browser.close()
  }
}

// app shoots the seeded Library: a Series with both Slots, the add panel, Upcoming and
// Settings > Slots & Profiles.
async function app() {
  for (const theme of themes) {
    const h = await open({ theme, width: 1280, height: 800 })
    try {
      await h.clickAria('Library')
      await h.page
        .locator('[id^="title-"]')
        .filter({ hasText: /^\s*Breaking Bad/ })
        .first()
        .click()
      await wait(1000)
      await save(h.page, '04-series', theme)

      await h.page.goto(h.base + '/', { waitUntil: 'domcontentloaded' })
      await dismissSearchDone(h.page)
      await h.page.locator('[aria-label^="Search or Add"]').locator('visible=true').first().click()
      await h.page.getByText('Add Title…', { exact: true }).click()
      await h.page.keyboard.type('paddington')
      await h.waitText('Paddington in Peru')
      await save(h.page, '05-add-title', theme)

      await h.page.goto(h.base + '/upcoming', {
        waitUntil: 'domcontentloaded',
      })
      await wait(1500)
      await save(h.page, '06-upcoming', theme)

      await h.page.goto(h.base + '/settings/slots-profiles', {
        waitUntil: 'domcontentloaded',
      })
      await wait(1500)
      await h.page
        .getByRole('heading', { name: 'Profiles', exact: true })
        .first()
        .evaluate((el) => el.scrollIntoView())
      await save(h.page, '07-profiles', theme)

      // A Profile's sheet: where Upgrades stop, the size limits and the qualities.
      await h.page
        .getByRole('button', { name: /^Edit / })
        .first()
        .click()
      await h.page.getByLabel('Good enough at').waitFor()
      await h.page.getByText('Size per Movie', { exact: true }).evaluate((el) => el.scrollIntoView({ block: 'end' }))
      await save(h.page, '13-profile-sheet', theme)

      await h.page.goto(h.base + '/', { waitUntil: 'domcontentloaded' })
      await h.page.getByRole('heading', { name: 'Needs attention' }).waitFor()
      await dismissSearchDone(h.page)
      await wait(1500)
      await save(h.page, '08-overview', theme)

      // Manual search of a Wanted Movie, with the fake indexer's Releases on for the moment only: a search pass would grab them.
      const releases = (state) => execFileSync(`${dirname(fileURLToPath(import.meta.url))}/demo.sh`, ['releases', state], { stdio: 'ignore' })
      const titles = await h.page.evaluate(async () => (await fetch('api/v1/titles')).json())
      const movie = (Array.isArray(titles) ? titles : titles.items).find((t) => t.title === 'Paddington 2')
      const version = movie.slot_states[0].version_id
      releases('on')
      try {
        await h.page.goto(`${h.base}/library/${movie.id}/search?version=${version}`, { waitUntil: 'domcontentloaded' })
        await h.page.getByText('Best fit').waitFor()
        await save(h.page, '09-manual-search', theme)
      } finally {
        releases('off')
      }

      // A failed Grab in Activity, opened to show its steps.
      await h.page.goto(h.base + '/activity', {
        waitUntil: 'domcontentloaded',
      })
      await h.page
        .getByText(/Failed · the download failed/)
        .first()
        .click()
      await h.page.getByRole('list', { name: 'What happened' }).waitFor()
      await save(h.page, '10-grab-steps', theme)

      // The Log, with an error opened: its details and "Same error before".
      await h.page.goto(h.base + '/log', { waitUntil: 'domcontentloaded' })
      await h.page
        .getByRole('button', { name: /^Open event: Download failed/ })
        .first()
        .click()
      await h.page.getByText('Same error before').waitFor()
      await h.page
        .getByText(/^Last \d+ days$/)
        .first()
        .evaluate((el) => el.scrollIntoView({ block: 'start' }))
      await save(h.page, '11-log', theme)

      await h.page.goto(h.base + '/health', { waitUntil: 'domcontentloaded' })
      await wait(2000)
      await save(h.page, '12-health', theme)
    } finally {
      await h.close()
    }
  }
}

await (phase === 'setup' ? setup() : app())
