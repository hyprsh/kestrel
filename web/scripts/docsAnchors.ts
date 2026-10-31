// The docs build's link check beyond VitePress's own: every internal link in the built HTML must reach
// a page, a file or an element id that exists. VitePress checks Markdown links to pages; this also
// catches a `#heading` that no longer exists and links in raw HTML.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export type Page = { file: string; html: string }

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")

/** The ids a page offers as anchors. */
export function idsOf(html: string): Set<string> {
  return new Set([...html.matchAll(/\s(?:id|name)="([^"]+)"/g)].map((m) => decode(m[1])))
}

/** The internal hrefs on a page, as written (site-absolute, relative or a bare `#fragment`). */
export function internalLinks(html: string): string[] {
  return [...html.matchAll(/<a\s[^>]*?href="([^"]*)"/g)].map((m) => decode(m[1])).filter((h) => h !== '' && !/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(h))
}

/**
 * Checks every internal link of `pages` (file paths relative to `dir`, e.g. `guide/concepts.html`)
 * against what is on disk under `dir`. `base` is the site's base path, such as `/kestrel/`.
 */
export function checkLinks(dir: string, base: string, pages: Page[]): string[] {
  const ids = new Map<string, Set<string>>()
  const idsFor = (file: string) => {
    let set = ids.get(file)
    if (!set) ids.set(file, (set = idsOf(readFileSync(join(dir, file), 'utf8'))))
    return set
  }
  const problems: string[] = []
  for (const page of pages) {
    for (const href of internalLinks(page.html)) {
      const [target, fragment] = href.split('#')
      let path: string
      if (target === '') path = page.file
      else {
        const url = new URL(target, `http://site${base}${page.file.replace(/(^|\/)index\.html$/, '$1').replace(/\.html$/, '')}`)
        if (!url.pathname.startsWith(base)) {
          problems.push(`${page.file}: ${href} is outside ${base}`)
          continue
        }
        const rel = decodeURIComponent(url.pathname.slice(base.length))
        const candidates = [rel, `${rel}.html`, join(rel, 'index.html')]
        const found = candidates.find((c) => existsSync(join(dir, c)) && statSync(join(dir, c)).isFile())
        if (!found) {
          problems.push(`${page.file}: ${href} has no page or file`)
          continue
        }
        path = found
      }
      if (fragment && path.endsWith('.html') && !idsFor(path).has(decodeURIComponent(fragment))) {
        problems.push(`${page.file}: ${href} has no element with id "${fragment}"`)
      }
    }
  }
  return problems
}

/** Every built page under `dir`, skipping the API reference (Scalar's own page). */
export function readPages(dir: string): Page[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter((f) => f.endsWith('.html') && !f.startsWith('api/reference/') && f !== '404.html')
    .sort()
    .map((file) => ({ file, html: readFileSync(join(dir, file), 'utf8') }))
}
