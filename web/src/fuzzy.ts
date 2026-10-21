// Fuzzy matching, shared by the command menu (ranked, highlighted) and the free text of the
// Library and Log filters (per word, yes or no). No dependency: folding, a few tiers of match
// and a bounded edit distance for typos are all it needs.

/**
 * Text folded for matching: lower-case letters and digits with accents and punctuation
 * dropped, `&` read as "and". `at` maps each folded character back to its index in the
 * original, and `starts` lists where each word begins.
 */
type Folded = { s: string; at: number[]; starts: number[]; words: string[] }

const apostrophes = new Set(["'", '’', '`', 'ʼ'])

function fold(text: string): Folded {
  let s = ''
  const at: number[] = []
  const starts: number[] = []
  const words: string[] = []
  let word = ''
  const end = () => {
    if (word) words.push(word)
    word = ''
  }
  const emit = (ch: string, i: number) => {
    if (!word) starts.push(s.length)
    s += ch
    word += ch
    at.push(i)
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (apostrophes.has(c)) continue // "Schindler's" is one word
    if (c === '&') {
      end()
      for (const ch of 'and') emit(ch, i)
      end()
      continue
    }
    for (const ch of c.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()) {
      if (/[\p{L}\p{N}]/u.test(ch)) emit(ch, i)
      else end()
    }
  }
  end()
  return { s, at, starts, words }
}

/** How well a query matches: higher is better, and `ranges` are the matched parts of the text. */
export type Match = { score: number; ranges: [number, number][] }

/** The tiers, best first; the score puts every match of a tier above the next one's. */
const EXACT = 5
const PREFIX = 4
const WORD_START = 3
const SUBSEQUENCE = 2
const TYPO = 1

/** Folded index spans [from, to) as ranges of the original text, merged where they touch. */
function spans(t: Folded, parts: [number, number][]): [number, number][] {
  const out: [number, number][] = []
  for (const [a, b] of [...parts].sort((x, y) => x[0] - y[0])) {
    const r: [number, number] = [t.at[a], t.at[b - 1] + 1]
    const last = out.at(-1)
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else out.push(r)
  }
  return out
}

const scored = (tier: number, penalty: number, t: Folded, parts: [number, number][]): Match => ({
  score: tier * 10000 - penalty * 100 - Math.min(t.s.length, 99),
  ranges: spans(t, parts),
})

/** Places each query word at a word start of the text, in any order and without overlap. */
function atWordStarts(words: string[], t: Folded): [number, number][] | null {
  const used: [number, number][] = []
  for (const w of words) {
    const p = t.starts.find((p) => t.s.startsWith(w, p) && used.every(([a, b]) => p + w.length <= a || p >= b))
    if (p === undefined) return null
    used.push([p, p + w.length])
  }
  return used
}

/** The query's letters in order (initials such as `bb` for Breaking Bad), as runs of the text. */
function inOrder(q: string, t: Folded): [number, number][] | null {
  const runs: [number, number][] = []
  let from = 0
  for (const c of q) {
    const j = t.s.indexOf(c, from)
    if (j < 0) return null
    const last = runs.at(-1)
    if (last && last[1] === j) last[1] = j + 1
    else runs.push([j, j + 1])
    from = j + 1
  }
  return runs
}

/** Each query word somewhere in the text, in any order and without overlap. */
function inside(words: string[], t: Folded): [number, number][] | null {
  const used: [number, number][] = []
  for (const w of words) {
    let p = t.s.indexOf(w)
    while (p >= 0 && !used.every(([a, b]) => p + w.length <= a || p >= b)) p = t.s.indexOf(w, p + 1)
    if (p < 0) return null
    used.push([p, p + w.length])
  }
  return used
}

/** The typos a query word may have: none in short words, where one would match almost anything. */
const budget = (w: string) => (w.length >= 9 ? 2 : w.length >= 5 ? 1 : 0)

/**
 * The fewest edits (a letter added, dropped, changed, or two swapped) that turn `w` into the
 * start of `s` at `from`, and how long that start is; null beyond the word's budget.
 */
function typosAt(w: string, s: string, from: number): { edits: number; length: number } | null {
  const max = budget(w)
  const t = s.slice(from, from + w.length + max)
  // d[i][j]: edits between w[0, i) and t[0, j), the optimal string alignment distance.
  const d = Array.from({ length: w.length + 1 }, (_, i) => Array.from({ length: t.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i <= w.length; i++) {
    for (let j = 1; j <= t.length; j++) {
      const cost = w[i - 1] === t[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && w[i - 1] === t[j - 2] && w[i - 2] === t[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  let best: { edits: number; length: number } | null = null
  for (let j = 1; j <= t.length; j++) if (!best || d[w.length][j] < best.edits) best = { edits: d[w.length][j], length: j }
  return best && best.edits <= max ? best : null
}

/** Each query word at a word start of the text with at most its typos, in any order and without overlap. */
function withTypos(words: string[], t: Folded): { edits: number; parts: [number, number][] } | null {
  const parts: [number, number][] = []
  let edits = 0
  for (const w of words) {
    let best: { edits: number; at: number; length: number } | null = null
    for (const p of t.starts) {
      if (!parts.every(([a, b]) => p >= b || p + w.length <= a)) continue
      const m = typosAt(w, t.s, p)
      if (m && (!best || m.edits < best.edits)) best = { ...m, at: p }
    }
    if (!best) return null
    edits += best.edits
    parts.push([best.at, best.at + best.length])
  }
  return { edits, parts }
}

/** How `query` matches `text`, or null when it does not. */
function match(q: Folded, t: Folded): Match | null {
  if (q.s === '') return { score: 0, ranges: [] }
  if (t.s === q.s) return scored(EXACT, 0, t, [[0, t.s.length]])
  if (t.s.startsWith(q.s)) return scored(PREFIX, 0, t, [[0, q.s.length]])
  const starts = atWordStarts(q.words, t)
  if (starts) return scored(WORD_START, 0, t, starts)
  // Fewer, longer runs read as a better match: a substring beats scattered letters.
  const ordered = inOrder(q.s, t)
  if (ordered) return scored(SUBSEQUENCE, ordered.length - 1, t, ordered)
  const within = inside(q.words, t)
  if (within) return scored(SUBSEQUENCE, within.length, t, within)
  const typos = withTypos(q.words, t)
  if (typos) return scored(TYPO, typos.edits, t, typos.parts)
  return null
}

/**
 * Whether every word of a filter's free text is in one of `haystacks`: as it is, or with
 * a typo or two in a longer word. Words match on their own, in any order, and never as
 * letters scattered across a line, which would match almost anything. Empty text matches.
 */
export function matchText(text: string, haystacks: readonly string[]): boolean {
  const hay = haystacks.map(fold)
  return fold(text).words.every((w) => hay.some((h) => h.s.includes(w) || withTypos([w], h) !== null))
}

/**
 * The items that match `query` on any of their `fields`, best first; equal matches keep
 * their order. `field` is the index of the field that matched best. An empty query keeps
 * every item.
 */
export function rank<T>(query: string, items: readonly T[], fields: (item: T) => readonly string[]): { item: T; field: number; match: Match }[] {
  const q = fold(query)
  const out: { item: T; field: number; match: Match }[] = []
  for (const item of items) {
    let best: { field: number; match: Match } | null = null
    fields(item).forEach((text, field) => {
      const m = match(q, fold(text))
      if (m && (!best || m.score > best.match.score)) best = { field, match: m }
    })
    if (best) out.push({ item, ...(best as { field: number; match: Match }) })
  }
  return out.sort((a, b) => b.match.score - a.match.score)
}
