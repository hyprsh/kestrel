// The chrome lint check (ADR 0017). The conventions it enforces are written up at the top of
// src/layout/conventions.ts; this file only implements them. `chrome-check.ts` runs it over the SPA.
import ts from 'typescript'

export type Violation = { file: string; line: number; class?: string; message: string }

const LAYOUT_DIR = 'src/layout/'
const MARKER = /^\s*\/\/\s*chrome:\s*(.*?)\s*$/
const WAITING = /^waiting\s+hyprsh\/design#\d+$/
const EXEMPT = /^\s*(?:\/\/|\{\/\*)\s*chrome-ok:(.*?)\s*(?:\*\/\})?\s*$/

/** Intrinsic JSX tags a design component replaces, with what to use instead. `ul`, `ol`, `li`, `img`, `nav` and `header` are a judgement call (CODING_STANDARDS.md). */
const TAGS: Record<string, string> = {
  button: 'Button, or Entity as="button"',
  a: 'Link or ButtonLink',
  input: 'Input, Checkbox, Radio, Toggle or Switch',
  select: 'Select',
  textarea: 'Textarea',
  label: 'Label',
  table: 'Table',
  hr: 'Separator',
  dialog: 'Modal or Sheet',
  progress: 'Progress',
  kbd: 'Kbd or KeyboardInput',
  code: 'Code or Snippet',
  pre: 'CodeBlock',
  svg: 'Icon',
}

/** `role` values on an intrinsic element that a design component provides. */
const ROLES: Record<string, string> = {
  dialog: 'Modal',
  alertdialog: 'DestructiveActionModal',
  switch: 'Toggle',
  tab: 'Tabs',
  tablist: 'Tabs',
  menu: 'Menu',
  menuitem: 'Menu',
  listbox: 'Select or Combobox',
  option: 'Select or Combobox',
  progressbar: 'Progress',
  tooltip: 'Tooltip',
  alert: 'Error',
}

const CALLS: Record<string, string> = {
  'window.confirm': 'Modal or DestructiveActionModal',
  'window.alert': 'Modal or DestructiveActionModal',
  'window.prompt': 'Modal or DestructiveActionModal',
  createPortal: 'Toast, Popover or Sheet',
  'ReactDOM.createPortal': 'Toast, Popover or Sheet',
}

type Hit = { line: number; message: string; class?: string }

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

function isSubtle(token: string): boolean {
  return /^[a-z][a-z0-9-]*-subtle$/.test(utilityOf(token))
}

function isChrome(token: string): boolean {
  if (token.includes('[') && token.includes('.hy-')) return true
  const utility = utilityOf(token)
  if (isSubtle(token)) return true
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

/** Every chrome class, hand-built element and forbidden call in `source`, with its line. */
function hitsIn(file: string, source: string): Hit[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const found: Hit[] = []
  const conventions = 'see the top comment of src/layout/conventions.ts'
  const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1
  const scan = (node: ts.Node, text: string) => {
    for (const m of text.matchAll(/\S+/g)) {
      if (!isChrome(m[0])) continue
      const line = lineOf(node.getStart(sf) + 1 + m.index)
      if (isSubtle(m[0])) {
        found.push({ line, class: m[0], message: `"${m[0]}" is a subtle hue. Use the hue plus contrast="low" (ADR 0017)` })
      } else {
        found.push({ line, class: m[0], message: `"${m[0]}" is chrome. Use a design component or a piece from ${LAYOUT_DIR} (${conventions})` })
      }
    }
  }
  const roleOf = (attr: ts.JsxAttribute): string | undefined => {
    let init = attr.initializer
    if (init && ts.isJsxExpression(init) && init.expression) init = init.expression as typeof init
    return init && (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) ? init.text : undefined
  }
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node)) scan(node, node.getText(sf).slice(1, -1))
    else if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) scan(node, node.rawText ?? '')
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName
      if (ts.isIdentifier(tag) && /^[a-z]/.test(tag.text)) {
        const line = lineOf(node.getStart(sf))
        if (Object.hasOwn(TAGS, tag.text)) found.push({ line, message: `<${tag.text}> is hand-built markup. Use ${TAGS[tag.text]}` })
        for (const attr of node.attributes.properties) {
          if (!ts.isJsxAttribute(attr) || attr.name.getText(sf) !== 'role') continue
          const role = roleOf(attr)
          if (role !== undefined && Object.hasOwn(ROLES, role)) {
            found.push({ line: lineOf(attr.getStart(sf)), message: `role="${role}" on <${tag.text}> is hand-built. Use ${ROLES[role]}` })
          }
        }
      }
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf)
      if (Object.hasOwn(CALLS, callee)) found.push({ line: lineOf(node.getStart(sf)), message: `${callee}() is hand-built. Use ${CALLS[callee]}` })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

/**
 * Applies the `chrome-ok: <reason>` line exemptions: each one covers the line directly below it. Returns the hits
 * left over, plus a violation for every exemption with no reason or with nothing to exempt.
 */
function applyExemptions(source: string, hits: Hit[]): Hit[] {
  const out: Hit[] = []
  const exempt = new Set<number>()
  source.split('\n').forEach((text, i) => {
    const m = EXEMPT.exec(text)
    if (!m) return
    const line = i + 1
    if (m[1].trim() === '') {
      out.push({ line, message: `"chrome-ok:" needs a reason, as "chrome-ok: <why no design component fits>"` })
      return
    }
    if (hits.some((h) => h.line === line + 1)) exempt.add(line + 1)
    else out.push({ line, message: `stale "chrome-ok" exemption: the next line has nothing to exempt, so remove it` })
  })
  return [...hits.filter((h) => !exempt.has(h.line)), ...out]
}

const toViolations = (file: string, hits: Hit[]): Violation[] =>
  hits
    .sort((a, b) => a.line - b.line)
    .map((h) => ({ file, line: h.line, class: h.class, message: `${file}:${h.line}: ${h.message}` }))

/** Checks one SPA source file. `file` is its path from the web directory, such as `src/log/Log.tsx`. */
export function checkSource(file: string, source: string): Violation[] {
  const marker = markerOf(source.split('\n'))
  const hits = hitsIn(file, source)
  const conventions = 'see the top comment of src/layout/conventions.ts'

  if (marker) {
    const fail = (message: string) => toViolations(file, [{ line: marker.line, message }])
    const kind = marker.value.split(/\s+/)[0]
    if (kind === 'layout') {
      if (!file.startsWith(LAYOUT_DIR)) return fail(`"chrome: layout" is only for files in ${LAYOUT_DIR}; ${conventions}`)
    } else if (kind === 'waiting') {
      if (!WAITING.test(marker.value)) return fail(`"chrome: waiting" must name the issue it waits for, as "chrome: waiting hyprsh/design#N"; ${conventions}`)
    } else if (kind === 'pending') {
      if (hits.length === 0) return fail(`stale "chrome: pending" marker: the file has no chrome left, so remove the marker`)
    } else if (kind !== 'domain-visual') {
      return fail(`unknown marker "chrome: ${marker.value}"; ${conventions}`)
    }
    return []
  }

  return toViolations(file, applyExemptions(source, hits))
}

const TEST_RULES: RegExp[] = [/\btoHaveClass\(/, /\.className\b/, /\bclassList\b/, /\bquerySelector(?:All)?\(\s*['"`](?:\.|\[class)/]

/** Checks one test file (`*.test.ts(x)` or under `src/test/`): tests assert what the user sees, not classes. */
export function checkTestSource(file: string, source: string): Violation[] {
  const hits: Hit[] = []
  source.split('\n').forEach((text, i) => {
    if (EXEMPT.test(text) || /^\s*(\/\/|\*|\/\*)/.test(text)) return
    if (TEST_RULES.some((r) => r.test(text))) hits.push({ line: i + 1, message: 'tests assert what the user sees (role, name, text), not classes' })
  })
  return toViolations(file, applyExemptions(source, hits))
}
