// A guard on the rule that every button and menu item reads in Title Case ("Manual Search…", "Delete Files…"):
// the plain text between the tags of a Button, MenuItem or ModalAction. Headings, descriptions and body text stay
// sentence case, and so do the labels of the design components that Kestrel does not write.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SMALL = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'to', 'for', 'by', 'from'])

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'test' ? [] : sources(path)
    return /\.tsx$/.test(name) && !/\.test\./.test(name) ? [path] : []
  })
}

/** The words of a label that should start with a capital letter and do not. */
function lowercased(label: string): string[] {
  return label.split(/\s+/).filter((w, i) => i > 0 && /^[a-z]/.test(w) && !SMALL.has(w))
}

describe('Title Case on buttons and menu items', () => {
  it('writes the text of every Button, MenuItem and ModalAction in Title Case', () => {
    const found: string[] = []
    for (const file of sources(join(__dirname))) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(/>\s*([A-Z][^<>{}]*?)\s*<\/(?:Button|MenuItem|ModalAction)>/g)) {
        const label = m[1].replace(/\s+/g, ' ')
        if (lowercased(label).length > 0) found.push(`${file.slice(__dirname.length + 1)}: ${label}`)
      }
    }
    expect(found).toEqual([])
  })
})
