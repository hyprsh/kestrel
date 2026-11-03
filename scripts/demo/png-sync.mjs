// Copies the PNGs of one directory into another, but only those whose decoded pixels differ from the
// file already there beyond a small threshold, so re-shooting an unchanged UI leaves the tree clean.
//
//   node png-sync.mjs <new shots dir> <target dir>
//
// A pixel differs when any channel moves by more than CHANNEL; a file is replaced when more than
// SHARE of its pixels differ, when its size changed, or when the old file is missing or unreadable.
import { copyFileSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { inflateSync } from 'node:zlib'

const CHANNEL = 16
// Run-to-run noise (free disk space, uptime, clocks) moves up to about 0.6% of a shot; set DOCS_SHOTS_SHARE=0 to take every change.
const SHARE = Number(process.env.DOCS_SHOTS_SHARE ?? 0.01)

// decode reads a non-interlaced 8-bit PNG (what Chrome writes) into { width, height, channels, data }.
export function decode(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let width = 0
  let height = 0
  let type = 0
  const idat = []
  let plte = null
  for (let off = 8; off < buf.length;) {
    const len = buf.readUInt32BE(off)
    const name = buf.toString('latin1', off + 4, off + 8)
    const body = buf.subarray(off + 8, off + 8 + len)
    if (name === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      if (body[8] !== 8 || body[12] !== 0) throw new Error('only 8-bit non-interlaced PNGs')
      type = body[9]
    } else if (name === 'PLTE') plte = body
    else if (name === 'IDAT') idat.push(body)
    off += 12 + len
  }
  const bpp = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type]
  if (!bpp) throw new Error(`unsupported colour type ${type}`)
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * bpp
  const out = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]
    const src = y * (stride + 1) + 1
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0
      const b = y > 0 ? out[(y - 1) * stride + x] : 0
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0
      let v = raw[src + x]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      out[y * stride + x] = v & 255
    }
  }
  if (type === 3) {
    const rgb = Buffer.alloc(width * height * 3)
    for (let i = 0; i < width * height; i++) plte.copy(rgb, i * 3, out[i] * 3, out[i] * 3 + 3)
    return { width, height, channels: 3, data: rgb }
  }
  return { width, height, channels: bpp, data: out }
}

// changed says whether the new file should replace the old one.
export function changed(oldPath, newPath) {
  if (!existsSync(oldPath)) return true
  try {
    const a = decode(readFileSync(oldPath))
    const b = decode(readFileSync(newPath))
    if (a.width !== b.width || a.height !== b.height || a.channels !== b.channels) return true
    let diff = 0
    for (let i = 0; i < a.data.length; i += a.channels) {
      for (let c = 0; c < a.channels; c++) {
        if (Math.abs(a.data[i + c] - b.data[i + c]) > CHANNEL) {
          diff++
          break
        }
      }
    }
    return diff / (a.width * a.height) > SHARE
  } catch {
    return true
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [from, to] = process.argv.slice(2)
  if (!from || !to) {
    console.error('usage: png-sync.mjs <new shots dir> <target dir>')
    process.exit(2)
  }
  let n = 0
  for (const f of readdirSync(from).filter((f) => f.endsWith('.png'))) {
    const dest = join(to, basename(f))
    if (changed(dest, join(from, f))) {
      copyFileSync(join(from, f), dest)
      console.log(`updated ${f}`)
      n++
    }
  }
  console.log(`docs-shots: ${n} image(s) changed`)
}
