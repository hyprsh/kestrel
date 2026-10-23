import type { AdoptionCurrent } from '../api/adoption'

/** Why an entry is Skipped, in plain words. */
export const skipText: Record<string, string> = {
  invalid: 'No readable video file',
  no_video: 'No video file',
  no_enabled_profile: 'No enabled Profile for its Slot',
  not_on_tvdb: 'Not on TheTVDB, so Kestrel cannot manage it',
}

/** What a running scan or commit is doing to its entry: "/data/media/tv/Breaking Bad — probing 62 files". */
export function currentText(c: AdoptionCurrent) {
  const files = c.files ? ` ${c.files} ${c.files === 1 ? 'file' : 'files'}` : ''
  return `${c.entry} — ${c.step}${files}`
}
