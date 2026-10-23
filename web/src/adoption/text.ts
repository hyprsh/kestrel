import type { AdoptionCurrent } from '../api/adoption'

/** Why an entry is Skipped, in plain words. */
export const skipText: Record<string, string> = {
  invalid: 'No readable video file',
  no_video: 'No video file',
  no_enabled_profile: 'No enabled Profile for its Slot',
  not_on_tvdb: 'Not on TheTVDB, so Kestrel cannot manage it',
}

/**
 * What a running scan or commit is doing to its entry, in plain words: "Reading 62 files of /data/media/tv/Breaking Bad",
 * "Adopting Paddington (2014) — moving 2 files". A step this client does not know is shown as it is.
 */
export function currentText(c: AdoptionCurrent) {
  const files = c.files ? `${c.files} ${c.files === 1 ? 'file' : 'files'}` : ''
  switch (c.step) {
    case 'probing':
      return files ? `Reading ${files} of ${c.entry}` : `Reading ${c.entry}`
    case 'matching':
      return `Finding the Title for ${c.entry}`
    case 'moving':
      return `Adopting ${c.title ?? c.entry}${files ? ` — moving ${files}` : ''}`
  }
  return `${c.entry} — ${c.step}${files ? ` ${files}` : ''}`
}
