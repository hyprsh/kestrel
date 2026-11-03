// The words for the codes an Import gives when it leaves a file alone (internal/imports Reason*). The Log, Activity and the
// Blocklist all show them through here, so a code reads the same wherever it turns up.

/** Why an Import rejected a Release or left an episode's file alone, by the server's code. */
export const rejectionWords: Record<string, string> = {
  invalid: 'not a valid video file',
  resolution: 'wrong resolution',
  language: 'wrong language',
  not_upgrade: 'not an upgrade',
  incomplete_archive: 'incomplete archive',
  unmonitored: 'episode not monitored',
  unknown_episode: 'no matching episode',
}

/** A rejection code in words; a code this does not know (a newer server's) is shown as it came. */
export const rejectionText = (code: string): string => (Object.hasOwn(rejectionWords, code) ? rejectionWords[code] : code)

/**
 * A reason the server wrote that may end in a code ("not_upgrade", "import rejected: not_upgrade"), with the code in words.
 * Any other text comes back as it was.
 */
export function reasonWords(text: string): string {
  const at = text.lastIndexOf(': ')
  const code = text.slice(at < 0 ? 0 : at + 2)
  return Object.hasOwn(rejectionWords, code) ? text.slice(0, at < 0 ? 0 : at + 2) + rejectionWords[code] : text
}
