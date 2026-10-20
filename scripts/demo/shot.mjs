// node shot.mjs <out.png> [title] [--full] [--dark] [--width N] [--height N]
// One screenshot of the demo Kestrel: the Library, or the Title whose row contains
// [title]. Also prints the page's text, to find what to click next.
import { open } from './lib.mjs'

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const num = (name, def) => (argv.includes(name) ? Number(argv[argv.indexOf(name) + 1]) : def)
const [out, title] = argv.filter((a, i) => !a.startsWith('--') && !['--width', '--height'].includes(argv[i - 1]))
if (!out) {
  console.error('usage: node shot.mjs <out.png> [title] [--full] [--dark] [--width N] [--height N]')
  process.exit(2)
}
const h = await open({ theme: flag('--dark') ? 'dark' : 'light', width: num('--width', 1440), height: num('--height', 900) })
try {
  if (title) await h.openTitle(title)
  await h.shot(out, { full: flag('--full') })
  console.log(await h.page.evaluate(() => document.body.innerText.slice(0, 3000)))
} finally {
  await h.close()
}
