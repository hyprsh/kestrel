import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkLinks, idsOf, internalLinks, readPages } from './docsAnchors.ts'

function site(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'docs-anchors-'))
  for (const [f, html] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true })
    writeFileSync(join(dir, f), html)
  }
  return dir
}

describe('docs link check', () => {
  it('reads ids and internal links only', () => {
    expect(idsOf('<h2 id="a">A</h2><a name="b"></a>')).toEqual(new Set(['a', 'b']))
    expect(internalLinks('<a href="/kestrel/x">x</a><a class="c" href="https://e.com">e</a><a href="#top">t</a>')).toEqual(['/kestrel/x', '#top'])
  })

  it('passes links to pages, clean URLs, files and anchors that exist', () => {
    const dir = site({
      'index.html': '<a href="/kestrel/guide/a#s">a</a><a href="/kestrel/adr/">adr</a><a href="/kestrel/api/openapi.yaml">spec</a>',
      'guide/a.html': '<h2 id="s">S</h2><a href="#s">self</a><a href="../index">home</a>',
      'adr/index.html': '<a href="/kestrel/guide/a">a</a>',
      'api/openapi.yaml': 'openapi: 3.0.0',
    })
    expect(checkLinks(dir, '/kestrel/', readPages(dir))).toEqual([])
  })

  it('fails on a missing page, a missing anchor and a link outside the base', () => {
    const dir = site({
      'index.html': '<a href="/kestrel/gone">x</a><a href="/kestrel/guide/a#nope">y</a><a href="/other">z</a>',
      'guide/a.html': '<h2 id="s">S</h2>',
    })
    expect(checkLinks(dir, '/kestrel/', readPages(dir))).toEqual([
      'index.html: /kestrel/gone has no page or file',
      'index.html: /kestrel/guide/a#nope has no element with id "nope"',
      'index.html: /other is outside /kestrel/',
    ])
  })
})
