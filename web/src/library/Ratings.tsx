/** A Title's audience ratings from ratings sources (today TMDB's), as "TMDB 8.4 (21k)". */

import { Fragment } from 'react'
import type { components } from '../api/schema.gen'

type Rating = components['schemas']['Rating']

const sourceNames: Record<string, string> = { tmdb: 'TMDB' }

/** 31, 4.9k, 21k, 2.4M: one decimal below ten of a unit. */
function shortCount(n: number): string {
  const unit = (v: number, suffix: string) => (v < 10 ? `${Number(v.toFixed(1))}${suffix}` : `${Math.round(v)}${suffix}`)
  if (n < 1000) return String(n)
  if (n < 1_000_000) return unit(n / 1000, 'k')
  return unit(n / 1_000_000, 'M')
}

/** One rating's label, or '' when the source has no rating yet. */
function label(r: Rating): string {
  if (r.value === null) return ''
  const scale = r.scale !== null && r.scale !== 10 ? `/${r.scale}` : ''
  const votes = r.votes ? ` (${shortCount(r.votes)})` : ''
  return `${sourceNames[r.source] ?? r.source.toUpperCase()} ${r.value.toFixed(1)}${scale}${votes}`
}

const rated = (ratings: Rating[]) => ratings.filter((r) => label(r) !== '')

/** The ratings as one line of text ("TMDB 8.4 (21k)"), '' when there are none; for places that take a string. */
export function ratingsText(ratings: Rating[]): string {
  return rated(ratings).map(label).join(' · ')
}

/**
 * The ratings inline, each linking to the Title at its source in a new tab.
 * `lead` puts a " · " in front, to continue a metadata line.
 */
export function Ratings({ ratings, lead = false }: { ratings: Rating[]; lead?: boolean }) {
  return rated(ratings).map((r, i) => (
    <Fragment key={r.source}>
      {(lead || i > 0) && ' · '}
      {r.url ? (
        <a href={r.url} target="_blank" rel="noopener noreferrer" title={tooltip(r)} className="hover:underline">
          {label(r)}
        </a>
      ) : (
        <span title={tooltip(r)}>{label(r)}</span>
      )}
    </Fragment>
  ))
}

function tooltip(r: Rating): string {
  const of = r.scale !== null ? ` out of ${r.scale}` : ''
  const votes = r.votes ? ` from ${r.votes.toLocaleString('en')} votes` : ''
  return `${sourceNames[r.source] ?? r.source} users rate it ${r.value}${of}${votes}`
}
