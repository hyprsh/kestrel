// Manual search at its own address ("/library/12/search?version=4&scope=S05"): the page that replaces a Title's page, resolved from
// the address alone so a reload, a link or the Back button lands on it. The address names the Title, its Version and the scope code;
// the Slot, the Profile and the episodes' ids come from the Title.
import { Button, Note, Skeleton } from '@hyprsh/design'
import { ArrowLeft } from 'lucide-react'
import { useMemo } from 'react'
import { useEpisodes, useProfiles, useTitle, type Episode, type EpisodeScope } from '../api/queries'
import type { ManualSearchAt } from '../place'
import { slotLabel } from './bits'
import { episodeCode, seasonName } from './episodes'
import { ManualSearch } from './ManualSearch'

const two = (n: number) => String(n).padStart(2, '0')

/** The code of a search's scope for the address: "S05" for a season, "S05E07,E08" for episodes of it, null for the whole Title. */
export function scopeCode(body: EpisodeScope | undefined, episodes: Episode[]): string | null {
  if (body?.season === undefined) return null
  const season = `S${two(body.season)}`
  if (!body.episode_ids?.length) return season
  const numbers = body.episode_ids.map((id) => episodes.find((e) => e.id === id)?.number).filter((n): n is number => n !== undefined)
  return numbers.length === 0 ? season : `${season}E${numbers.map(two).join(',E')}`
}

/** The season and episode numbers a scope code names. */
function parseScope(code: string): { season: number; numbers: number[] } {
  const [head, ...rest] = code.toUpperCase().split(',')
  const m = /^S(\d+)(?:E(\d+))?$/.exec(head)!
  const numbers = [m[2], ...rest.map((r) => r.replace(/^E/, ''))].filter((n): n is string => !!n).map(Number)
  return { season: Number(m[1]), numbers }
}

/** Whether resolving the scope needs the Series' episodes (it names some). */
const namesEpisodes = (code: string | null) => code !== null && code.includes('E')

/** The request body and the words for a scope code, once the episodes it names are known (`episodes` may be empty for a season). */
function resolveScope(code: string, episodes: Episode[]): { body: EpisodeScope; label: string } {
  const { season, numbers } = parseScope(code)
  if (numbers.length === 0) return { body: { season }, label: seasonName(season) }
  const found = numbers.map((n) => episodes.find((e) => e.season === season && e.number === n)).filter((e): e is Episode => !!e)
  return { body: { season, episode_ids: found.map((e) => e.id) }, label: found.length === 1 ? episodeCode(found[0]) : `${found.length} episodes` }
}

function Gone({ children, onBack }: { children: string; onBack: () => void }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-start gap-3 p-4 sm:px-8 sm:py-6">
      <Button variant="tertiary" size="small" prefix={<ArrowLeft />} onClick={onBack}>
        Back
      </Button>
      <Note variant="error" size="small">
        {children}
      </Note>
    </div>
  )
}

/** Manual search for the Version the address names. `titleName` is the Title's name from the list, which is already loaded. */
export function ManualSearchRoute({ at, titleName, onBack }: { at: ManualSearchAt; titleName: string; onBack: () => void }) {
  const title = useTitle(at.titleId)
  const profiles = useProfiles()
  const needsEpisodes = namesEpisodes(at.scope)
  const episodes = useEpisodes(at.titleId, needsEpisodes)
  const version = title.data?.versions.find((v) => v.id === at.versionId)
  const scope = useMemo(() => (at.scope && (!needsEpisodes || episodes.data) ? resolveScope(at.scope, episodes.data ?? []) : undefined), [at.scope, needsEpisodes, episodes.data])
  if (title.isError || episodes.isError) return <Gone onBack={onBack}>Could not load this Title.</Gone>
  if (title.data && !version) return <Gone onBack={onBack}>This Version is gone.</Gone>
  if (!version || (at.scope && !scope) || profiles.isPending) {
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4 sm:px-8 sm:py-6">
        <p role="status" className="sr-only">
          Loading
        </p>
        <Skeleton width="40%" height={32} />
        <Skeleton height={120} />
      </div>
    )
  }
  const profile = profiles.data?.find((p) => p.key === version.profile)
  return (
    <ManualSearch
      key={`${at.versionId} ${at.scope ?? ''}`}
      titleName={titleName}
      slotLabel={slotLabel[version.slot]}
      profileName={profile?.name ?? version.profile}
      versionId={version.id}
      scope={scope}
      onBack={onBack}
    />
  )
}
