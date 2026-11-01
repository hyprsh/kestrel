// node sweep.mjs <out dir> [screen…] [--dark]
// Shoots every screen of the demo Kestrel at a phone (390x844) and a desktop (1440x900) width
// as <screen>-390.png and <screen>-1440.png (<screen>-390-dark.png with --dark), prints one line
// per screen and exits 1 when a page scrolls sideways. Start the demo first (demo.sh start).
// Naming screens shoots only those; `node sweep.mjs --list` prints the names.
import { mkdirSync } from 'node:fs'
import { open, wait } from './lib.mjs'

// The Settings pages; an old section id (indexers, plex, security…) also opens its page.
const settings = ['general', 'profiles', 'library', 'downloads', 'media-servers', 'account', 'access', 'about']
const widths = [
  { w: 390, h: 844 },
  { w: 1440, h: 900 },
]

// A screen is an address, or an object with the address (a function of the Title ids), a step that
// gets the screen to its state, and phoneOnly for the More sheet, which only a phone has.
const screens = {
  overview: '/',
  library: '/library',
  'title-movie': { path: (ids) => `/library/${ids.movie}` },
  'title-series': { path: (ids) => `/library/${ids.series}` },
  // A Movie with a Version downloading, which the Versions card and the Files row both show.
  'title-movie-downloading': { path: (ids) => `/library/${ids.downloading ?? ids.movie}` },
  upcoming: '/upcoming',
  requests: '/requests',
  activity: '/activity',
  health: '/health',
  log: '/log',
  ...Object.fromEntries(settings.map((s) => [`settings-${s}`, `/settings/${s}`])),
  // The command menu with a query no Library Title matches, which leads with Add.
  'menu-add': {
    path: '/',
    prepare: async (h) => {
      await h.page.locator('[aria-label^="Search or add"]').locator('visible=true').first().click()
      await h.page.keyboard.type('qqzxv')
    },
  },
  more: { path: '/', phoneOnly: true, prepare: async (h) => h.page.getByRole('button', { name: 'More' }).click() },
}

const argv = process.argv.slice(2)
if (argv.includes('--list')) {
  console.log(Object.keys(screens).join('\n'))
  process.exit(0)
}
const dark = argv.includes('--dark')
const [out, ...names] = argv.filter((a) => a !== '--dark')
if (!out) {
  console.error('usage: node sweep.mjs <out dir> [screen…] [--dark]   (--list names the screens)')
  process.exit(2)
}
const unknown = names.filter((n) => !(n in screens))
if (unknown.length) {
  console.error(`unknown screen ${unknown.join(', ')}; --list names them`)
  process.exit(2)
}
mkdirSync(out, { recursive: true })

const h = await open({ theme: dark ? 'dark' : 'light' })
let overflowed = 0
try {
  const titles = await h.page.evaluate(async () => (await fetch('api/v1/titles')).json())
  const list = Array.isArray(titles) ? titles : (titles.titles ?? titles.items ?? [])
  const ids = { movie: list.find((t) => t.kind === 'movie')?.id, series: list.find((t) => t.kind === 'series')?.id, downloading: list.find((t) => t.title === 'Paddington in Peru')?.id }
  if (!ids.movie || !ids.series) throw new Error('the demo has no Movie and Series Title; is it seeded (demo.sh start)?')

  for (const name of names.length ? names : Object.keys(screens)) {
    const s = typeof screens[name] === 'string' ? { path: screens[name] } : screens[name]
    const cells = []
    for (const { w, h: ht } of widths) {
      if (s.phoneOnly && w > 390) continue
      await h.page.setViewportSize({ width: w, height: ht })
      await h.page.goto(h.base + (typeof s.path === 'function' ? s.path(ids) : s.path), { waitUntil: 'domcontentloaded' })
      await h.page.locator('[aria-label^="Search or add"]').first().waitFor()
      await wait(800)
      if (s.prepare) {
        await s.prepare(h)
        await wait(500)
      }
      const [scroll, inner] = await h.page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
      const over = scroll > inner
      if (over) overflowed++
      await h.shot(`${out}/${name}-${w}${dark ? '-dark' : ''}.png`)
      cells.push(`${w}: ${over ? `OVERFLOW ${scroll}>${inner}` : 'ok'}`)
    }
    console.log(`${name.padEnd(24)} ${cells.join('   ')}`)
  }
} finally {
  await h.close()
}
if (overflowed) {
  console.error(`${overflowed} shot(s) scroll sideways`)
  process.exit(1)
}
