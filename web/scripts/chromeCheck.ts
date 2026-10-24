// The chrome lint check (ADR 0017). The conventions it enforces are written up at the top of
// src/layout/conventions.ts; this file only implements them. `chrome-check.ts` runs it over the SPA.
import ts from 'typescript'

export type Violation = { file: string; line: number; class?: string; message: string }

const LAYOUT_DIR = 'src/layout/'
const MARKER = /^\s*\/\/\s*chrome:\s*(.*?)\s*$/
const WAITING = /^waiting\s+hyprsh\/design#\d+$/

/** The utility part of a class token: the text after its last top-level `:` (variants like `hover:` and `[&_.x]:`). */
function utilityOf(token: string): string {
  let depth = 0
  let cut = -1
  for (let i = 0; i < token.length; i++) {
    const c = token[i]
    if (c === '[' || c === '(') depth++
    else if (c === ']' || c === ')') depth--
    else if (c === ':' && depth === 0) cut = i
  }
  return token.slice(cut + 1)
}

function isChrome(token: string): boolean {
  if (token.includes('[') && token.includes('.hy-')) return true
  const utility = utilityOf(token)
  if (/^!(?=[a-z[@-])/.test(utility)) return true
  return /^-?(rounded|border|shadow|ring|bg|divide)(-|$)/.test(utility)
}

/** The `// chrome: ...` marker in the comment block that opens the file, if any. */
function markerOf(lines: string[]): { line: number; value: string } | undefined {
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].trim()
    if (text !== '' && !/^(\/\/|\/\*|\*)/.test(text)) return undefined
    const m = MARKER.exec(lines[i])
    if (m) return { line: i + 1, value: m[1] }
  }
  return undefined
}

/** Every chrome class in the string literals of `source`, with its line. */
function chromeIn(file: string, source: string): { line: number; class: string }[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const found: { line: number; class: string }[] = []
  const scan = (node: ts.Node, text: string) => {
    for (const m of text.matchAll(/\S+/g)) {
      if (!isChrome(m[0])) continue
      const at = node.getStart(sf) + 1 + m.index
      found.push({ line: sf.getLineAndCharacterOfPosition(at).line + 1, class: m[0] })
    }
  }
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node)) scan(node, node.getText(sf).slice(1, -1))
    else if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) scan(node, node.rawText ?? '')
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

/** Checks one SPA source file. `file` is its path from the web directory, such as `src/log/Log.tsx`. */
export function checkSource(file: string, source: string): Violation[] {
  const marker = markerOf(source.split('\n'))
  const chrome = chromeIn(file, source)
  const out: Violation[] = []
  const fail = (line: number, message: string, cls?: string) => out.push({ file, line, class: cls, message: `${file}:${line}: ${message}` })
  const conventions = 'see the top comment of src/layout/conventions.ts'

  if (marker) {
    const kind = marker.value.split(/\s+/)[0]
    if (kind === 'layout') {
      if (!file.startsWith(LAYOUT_DIR)) fail(marker.line, `"chrome: layout" is only for files in ${LAYOUT_DIR}; ${conventions}`)
    } else if (kind === 'waiting') {
      if (!WAITING.test(marker.value)) fail(marker.line, `"chrome: waiting" must name the issue it waits for, as "chrome: waiting hyprsh/design#N"; ${conventions}`)
    } else if (kind === 'pending') {
      if (chrome.length === 0) fail(marker.line, `stale "chrome: pending" marker: the file has no chrome left, so remove the marker`)
    } else if (kind !== 'domain-visual') {
      fail(marker.line, `unknown marker "chrome: ${marker.value}"; ${conventions}`)
    }
    return out
  }

  for (const c of chrome) {
    fail(c.line, `"${c.class}" is chrome. Use a design component or a piece from ${LAYOUT_DIR} (${conventions})`, c.class)
  }
  return out
}
