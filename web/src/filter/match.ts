// How a filter's free text matches a row: the one place to change it (fuzzy matching, #154).

/** Whether every word of `text` appears, ignoring case, in one of `haystacks`. Empty text matches. */
export function matchText(text: string, haystacks: readonly string[]): boolean {
  const hay = haystacks.map((h) => h.toLowerCase())
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.some((h) => h.includes(word)))
}
