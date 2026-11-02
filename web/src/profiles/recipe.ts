import type { Profile } from '../api/queries'
import type { components } from '../api/schema.gen'

type Family = components['schemas']['ProfileReleaseFamily']
type Rule = components['schemas']['ProfileLanguageRule']
type Kind = components['schemas']['TitleKind']

const families: Record<Family, string> = { 'bluray-web': 'Bluray + WEB', 'remux-web': 'Remux + WEB', web: 'WEB', sqp: 'SQP' }
const named: Record<string, string> = { en: 'English', de: 'German', fr: 'French' }

export const familyName = (f: Family) => families[f]

/** "Movies", "Series" or "Movies and Series": the kinds a recipe applies to. */
export const kindsText = (kinds: Kind[]) => [kinds.includes('movie') ? 'Movies' : null, kinds.includes('series') ? 'Series' : null].filter(Boolean).join(' and ')

/** The audio a recipe asks for, in short: "Primary Language", "Original Language" or the named language. */
export const languageText = (rule: Rule) => (rule === 'primary' ? 'Primary Language' : rule === 'original' ? 'Original Language' : (named[rule] ?? rule))

/** What a Profile card says about the audio. */
export function audioText(p: Pick<Profile, 'language_rule' | 'original_language'>) {
  if (p.language_rule === 'original') return 'Title’s Original Language audio'
  if (p.language_rule !== 'primary') return `${languageText(p.language_rule)} audio`
  return p.original_language === 'reject' ? 'Primary Language audio' : 'Primary Language audio, or the original'
}
