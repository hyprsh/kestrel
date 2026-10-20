// The demo's headless browser: open() logs in to the demo Kestrel and returns a
// page with helpers. Scenario scripts import it from anywhere:
//
//   import { open, wait } from '<repo>/scripts/demo/lib.mjs'
//   const h = await open()                 // 1440x900, light theme, logged in as demo
//   await h.openTitle('Breaking Bad')
//   await h.shot(`${out}/01-series-${label}.png`)
//   await h.close()
//
// The browser is $DEMO_CHROME if set, else an installed Google Chrome, else
// Playwright's own Chromium (npx --prefix scripts/demo playwright-core install chromium).
import { chromium } from 'playwright-core'

export const wait = (ms) => new Promise((r) => setTimeout(r, ms))

export const demoURL = () => process.env.DEMO_URL || `http://127.0.0.1:${process.env.DEMO_PORT || 7677}`

export async function launch() {
  const args = ['--force-color-profile=srgb']
  if (process.env.DEMO_CHROME) return chromium.launch({ executablePath: process.env.DEMO_CHROME, args })
  try {
    return await chromium.launch({ channel: 'chrome', args })
  } catch {
    return chromium.launch({ args })
  }
}

// open starts a browser on the demo Kestrel. theme is 'light' or 'dark'.
export async function open({ base = demoURL(), width = 1440, height = 900, theme = 'light' } = {}) {
  const browser = await launch()
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: theme })
  const page = await context.newPage()
  await page.goto(base + '/ping')
  const status = await page.evaluate(async (theme) => {
    localStorage.setItem('kestrel.theme', theme)
    const r = await fetch('api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'demo', password: 'demo-password-123' }),
    })
    return r.status
  }, theme)
  if (status >= 300) throw new Error(`login as demo answered ${status}: is the demo seeded (demo.sh start)?`)
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
  await page.locator('[aria-label="Library"]').first().waitFor()
  await wait(600)

  const h = {
    browser, context, page, base,
    // clickAria clicks the visible element with that aria-label.
    async clickAria(name) {
      await page.locator(`[aria-label="${name}"]`).locator('visible=true').first().click()
    },
    // clickText clicks the visible control whose whole text is text.
    async clickText(text, sel = 'button, label, [role=option], [role=menuitem], [role=tab], li, a') {
      const exact = new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`)
      await page.locator(sel).filter({ hasText: exact }).locator('visible=true').first().click()
    },
    // waitText waits until the page's text matches the regular expression source re.
    async waitText(re, timeout = 15000) {
      await page.waitForFunction((r) => new RegExp(r).test(document.body.innerText), re, { timeout })
    },
    // openTitle opens the Library and the first Title row containing name.
    async openTitle(name) {
      await h.clickAria('Library')
      await page.locator('[id^="title-"]').filter({ hasText: name }).first().click()
      await wait(800)
    },
    // shot moves the mouse out of the way (unless move is false) and saves a PNG.
    async shot(path, { full = false, move = true } = {}) {
      if (move) await page.mouse.move(5, page.viewportSize().height - 5)
      await wait(500)
      await page.screenshot({ path, fullPage: full })
      console.log('saved', path)
    },
    async close() {
      await browser.close()
    },
  }
  return h
}
