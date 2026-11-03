import { createContext, useContext } from 'react'
import { useSettings, type Profile } from '../api/queries'
import type { components } from '../api/schema.gen'

type Family = components['schemas']['ProfileReleaseFamily']
type Rule = components['schemas']['ProfileLanguageRule']
type Kind = components['schemas']['TitleKind']

const families: Record<Family, string> = { 'bluray-web': 'Bluray + WEB', 'remux-web': 'Remux + WEB', web: 'WEB', sqp: 'SQP' }
const named: Record<string, string> = { en: 'English', de: 'German', fr: 'French' }

export const familyName = (f: Family) => families[f]

/** "Movies", "Series" or "Movies and Series": the kinds a recipe applies to. */
export const kindsText = (kinds: Kind[]) => [kinds.includes('movie') ? 'Movies' : null, kinds.includes('series') ? 'Series' : null].filter(Boolean).join(' and ')

/**
 * The Primary Language picked in the wizard's Language step and not yet saved, so the Profiles step can name it. The wizard
 * provides it; elsewhere the saved one stands.
 */
export const PrimaryDraft = createContext<{ draft: string | undefined; setDraft: (language: string | undefined) => void } | null>(null)

/** The household's Primary Language by name ("English"): the one picked in the wizard's Language step if unsaved, else the saved one once Settings has loaded. */
export function usePrimaryName(): string | undefined {
  const { data } = useSettings()
  const draft = useContext(PrimaryDraft)?.draft
  const language = draft ?? data?.language_region.primary_language
  return language ? (named[language] ?? language) : undefined
}

/** What a recipe's language chip says: its `label` and a `hint` for the tooltip, for the Primary Language currently selected. */
export function recipeLanguage(rule: Rule, primary?: string): { label: string; hint: string } {
  if (rule === 'primary') return { label: primary ?? 'Primary', hint: primary ? `Primary Language: ${primary}` : 'Follows the Primary Language' }
  if (rule === 'original') return { label: 'Original', hint: 'Follows each Title’s Original Language' }
  const name = named[rule] ?? rule
  return { label: name, hint: `${name} audio` }
}

/** The audio a recipe asks for, in short: "Primary Language (English)", "Original Language" or the named language. Without the household's `primary` name the first is just "Primary Language". */
export const languageText = (rule: Rule, primary?: string) =>
  rule === 'primary' ? (primary ? `Primary Language (${primary})` : 'Primary Language') : rule === 'original' ? 'Original Language' : (named[rule] ?? rule)

/** What a Profile card says about the audio. */
export function audioText(p: Pick<Profile, 'language_rule' | 'original_language'>) {
  if (p.language_rule === 'original') return 'Title’s Original Language audio'
  if (p.language_rule !== 'primary') return `${languageText(p.language_rule)} audio`
  return p.original_language === 'reject' ? 'Primary Language audio' : 'Primary Language audio, or the original'
}
