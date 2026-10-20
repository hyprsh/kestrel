// node posters.mjs <out dir> < titles: draws a poster per "kind<TAB>tmdb id<TAB>title<TAB>year"
// line (fake.py --titles) as <out dir>/<kind>-<tmdb id>.jpg, 500x750.
import { readFileSync } from 'node:fs'
import { launch } from './lib.mjs'

const [out] = process.argv.slice(2)
const rows = readFileSync(0, 'utf8').trim().split('\n').map((l) => l.split('\t'))
const palettes = [
  ['#1d3557', '#e63946'], ['#2a9d8f', '#264653'], ['#f4a261', '#9c2c13'], ['#3a0ca3', '#4cc9f0'],
  ['#2b2d42', '#8d99ae'], ['#606c38', '#283618'], ['#7f5539', '#ddb892'], ['#0b090a', '#a4161a'],
]
const esc = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 500, height: 750 } })
for (const [i, [kind, id, title, year]] of rows.entries()) {
  const [a, b] = palettes[i % palettes.length]
  await page.setContent(`<body style="margin:0;width:500px;height:750px;background:linear-gradient(160deg,${a},${b});font-family:Georgia,serif;color:#fff;display:flex;flex-direction:column;justify-content:flex-end">
  <div style="position:absolute;top:60px;left:0;right:0;text-align:center;font-size:200px;opacity:.18">${kind === 'movie' ? '&#9733;' : '&#9670;'}</div>
  <div style="padding:40px"><div style="font-size:56px;line-height:1.05;font-weight:bold;text-shadow:0 2px 8px rgba(0,0,0,.4)">${esc(title)}</div>
  <div style="margin-top:14px;font-size:26px;letter-spacing:6px;opacity:.85">${esc(year)}</div></div></body>`)
  await page.screenshot({ path: `${out}/${kind}-${id}.jpg`, type: 'jpeg', quality: 85 })
}
await browser.close()
console.log(`posters: ${rows.length} in ${out}`)
