// The filter language of the Log's filter field, GitHub-style: `name:a,b` qualifiers next to free
// text. Commas mean OR, different qualifiers AND, and a leading `-` excludes. Each screen brings
// its own qualifier table; this module only knows the grammar.

/** One qualifier a screen understands. */
export type Qualifier = {
  name: string
  /** One line for the help popover. */
  help: string
  /** The values it takes, offered as you type. Without them, any value is accepted. */
  values?: readonly string[]
  /** Values offered as you type when any value is accepted, such as Library Titles. */
  suggestions?: readonly string[]
  /** Whether `-name:` (exclude) is allowed. */
  negatable?: boolean
}

/** A qualifier as typed; `span` is where it sits in the input. */
export type Term = { name: string; values: string[]; negated: boolean; span: [number, number] }

/** Why part of the filter at `span` was left out. */
type Problem = { message: string; span: [number, number] }

export type Query = { terms: Term[]; text: string; problems: Problem[] }

type Token = { raw: string; start: number; end: number }

/** Splits on spaces outside double quotes. */
function tokens(input: string): Token[] {
  const out: Token[] = []
  let start = -1
  let quoted = false
  for (let i = 0; i <= input.length; i++) {
    const c = input[i]
    if (i === input.length || (!quoted && /\s/.test(c))) {
      if (start >= 0) out.push({ raw: input.slice(start, i), start, end: i })
      start = -1
      continue
    }
    if (start < 0) start = i
    if (c === '"') quoted = !quoted
  }
  return out
}

/** Splits a qualifier's value on commas outside quotes, and drops the quotes. */
function values(raw: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (const c of raw) {
    if (c === '"') quoted = !quoted
    else if (c === ',' && !quoted) {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out.map((v) => v.trim()).filter(Boolean)
}

/** What a token is: a term of a known qualifier, or free text. */
function termOf(t: Token, qualifiers: readonly Qualifier[]): Term | null {
  const m = /^(-?)([a-z_]+):(.*)$/i.exec(t.raw)
  if (!m) return null
  const name = m[2].toLowerCase()
  if (!qualifiers.some((q) => q.name === name)) return null
  return { name, values: values(m[3]), negated: m[1] === '-', span: [t.start, t.end] }
}

const either = (v: readonly string[]) => (v.length < 2 ? v.join('') : `${v.slice(0, -1).join(', ')} or ${v.at(-1)}`)

/**
 * Reads a filter. Unknown qualifiers (`error:disk`) are free text; an unfinished one (`kind:`)
 * is ignored. Values a qualifier does not take, and exclusions it does not allow, are dropped
 * and named in `problems`, so the field can say why.
 */
export function parse(input: string, qualifiers: readonly Qualifier[]): Query {
  const terms: Term[] = []
  const text: string[] = []
  const problems: Problem[] = []
  for (const t of tokens(input)) {
    const term = termOf(t, qualifiers)
    if (!term) {
      text.push(t.raw)
      continue
    }
    const q = qualifiers.find((q) => q.name === term.name)!
    if (term.negated && !q.negatable) {
      problems.push({ message: `${q.name}: cannot be excluded`, span: term.span })
      continue
    }
    const known = q.values
    if (known) {
      for (const v of term.values.filter((v) => !known.includes(v))) problems.push({ message: `${q.name}: takes ${either(known)}, not “${v}”`, span: term.span })
      term.values = term.values.filter((v) => known.includes(v))
    }
    if (term.values.length > 0) terms.push(term)
  }
  return { terms, text: text.join(' '), problems }
}

/** A value to complete the qualifier under the caret with: the filter and caret after taking it. */
export type Suggestion = { value: string; input: string; caret: number }

const MAX_SUGGESTIONS = 8

/** The values for the qualifier being typed at `caret`, those starting with what is typed first. */
export function suggest(input: string, caret: number, qualifiers: readonly Qualifier[]): Suggestion[] {
  const token = tokens(input.slice(0, caret)).at(-1)
  if (!token || token.end !== caret) return []
  const m = /^(-?[a-z_]+:)(.*)$/i.exec(token.raw)
  const q = m && qualifiers.find((q) => q.name === m[1].replace(/^-/, '').slice(0, -1).toLowerCase())
  if (!m || !q) return []
  const rest = m[2]
  // The value being typed starts after the last comma outside quotes.
  let from = 0
  let open = false
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '"') open = !open
    else if (rest[i] === ',' && !open) from = i + 1
  }
  const typedSoFar = rest.slice(from).replace(/^"/, '').toLowerCase()
  const chosen = values(rest.slice(0, from))
  const start = token.start + m[1].length + from
  const end = caret + /^[^\s,]*/.exec(input.slice(caret))![0].length
  const pool = (q.values ?? q.suggestions ?? []).filter((v) => !chosen.includes(v) && v.toLowerCase().includes(typedSoFar))
  const ranked = [...pool.filter((v) => v.toLowerCase().startsWith(typedSoFar)), ...pool.filter((v) => !v.toLowerCase().startsWith(typedSoFar))]
  return ranked.slice(0, MAX_SUGGESTIONS).map((value) => {
    const head = input.slice(0, start) + quoted(value)
    return { value, input: head + input.slice(end), caret: head.length }
  })
}

const quoted = (v: string) => (/[\s,]/.test(v) ? `"${v.replaceAll('"', '')}"` : v)

/** A term as it would be typed, such as `-kind:grab,import` or `title:"Breaking Bad"`. */
export const termText = (t: Pick<Term, 'name' | 'values' | 'negated'>) => `${t.negated ? '-' : ''}${t.name}:${t.values.map(quoted).join(',')}`

/** The filter with `value` added: OR-ed into the qualifier already there, or as a new one at the end. */
export function withValue(input: string, name: string, value: string, qualifiers: readonly Qualifier[]): string {
  const term = parse(input, qualifiers).terms.find((t) => t.name === name && !t.negated)
  if (!term) return `${input.trimEnd()} ${termText({ name, values: [value], negated: false })}`.trimStart()
  if (term.values.includes(value)) return input
  const [start, end] = term.span
  return input.slice(0, start) + termText({ ...term, values: [...term.values, value] }) + input.slice(end)
}

/** The filter with `value` taken out of each `name:` that has it; a qualifier left with no value goes. */
export function withoutValue(input: string, name: string, value: string, qualifiers: readonly Qualifier[]): string {
  const terms = parse(input, qualifiers).terms
  let out = input
  // Right to left, so the spans of the terms still to edit stay where they were.
  for (let i = terms.length - 1; i >= 0; i--) {
    const t = terms[i]
    if (t.name !== name || t.negated || !t.values.includes(value)) continue
    if (t.values.length === 1) out = withoutTerm(out, i, qualifiers)
    else out = out.slice(0, t.span[0]) + termText({ ...t, values: t.values.filter((v) => v !== value) }) + out.slice(t.span[1])
  }
  return out
}

/** The filter without its `index`th term, and the space before it (or else after it). */
export function withoutTerm(input: string, index: number, qualifiers: readonly Qualifier[]): string {
  const term = parse(input, qualifiers).terms[index]
  if (!term) return input
  let [start, end] = term.span
  const before = /\s+$/.exec(input.slice(0, start))
  if (before) start -= before[0].length
  else end += /^\s*/.exec(input.slice(end))![0].length
  return input.slice(0, start) + input.slice(end)
}
