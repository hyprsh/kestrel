// A History row opened in place: what happened to the Grab step by step, the files it made, and what can be done next.
// chrome: domain-visual
import { Badge, Button, Note, Skeleton, StatusDot, termText } from '@hyprsh/design'
import { useDownloadClient, useGrabSteps, useRemoveFromBlocklist, type GrabEntry, type GrabSteps } from '../api/activity'
import { useSearchNow } from '../api/grabs'
import { useSearchStatus } from '../api/search'
import { EndOfPath } from '../library/EpisodeFilePopover'
import { size, slotLabel, type SlotKey } from '../library/bits'
import { placePath, useOpenPlace } from '../place'
import { until, useNow } from '../time'
import { useReport } from '../toasts'
import { cx } from '../ui'
import { plural } from '../format'
import { failureText, hhmm } from './words'
import { whyText } from '../log/sentence'

type Dot = 'neutral' | 'info' | 'success' | 'error'
type Step = { dot: Dot; when: string; text: string; tone?: 'red' }

const grabbedBy = { by_hand: ' by hand', by_search: ' by the search pass', by_rss: ' by the RSS sweep' } as const

/** The average speed of a download that took `from` to `to`, "6 MB/s", or null when the times say nothing. */
function average(bytes: number, from: string, to: string): string | null {
  const secs = (Date.parse(to) - Date.parse(from)) / 1000
  return secs >= 1 && bytes > 0 ? `${size(bytes / secs)}/s` : null
}

/** Why the Grab failed as the closing step: the download's own words, or what the Import rejected. */
function failureStep(g: GrabEntry): string {
  const f = g.failure
  if (!f) return 'It failed'
  if (f === 'download_failed' || f === 'encrypted' || f === 'lost') return `Download failed: ${failureText[f]}`
  if (f === 'discarded') return `Discarded: ${failureText[f]}`
  return `Import rejected: ${f}`
}

/** The steps of a Grab, oldest first, from the Grab itself and what the Log recorded of it. */
function stepsOf(g: GrabEntry, s: GrabSteps, client: string): Step[] {
  const why = whyText(null, s.why)
  const out: Step[] = [{ dot: 'neutral', when: hhmm(s.grabbed_at), text: `Grabbed${s.grabbed_by ? grabbedBy[s.grabbed_by] : ''} · ${g.indexer}${why ? ` · ${why}` : ''}` }]
  const { download_started_at: from, download_finished_at: to } = s
  if (from || to) {
    const rate = from && to ? average(g.size, from, to) : null
    const fromTo = from && to ? `${hhmm(from)} – ${hhmm(to)}` : hhmm((from ?? to)!)
    out.push({ dot: 'info', when: fromTo, text: `Downloaded in ${client} · ${size(g.size)}${rate ? ` at ${rate}` : ''}` })
  }
  if (s.ended_at) {
    const when = hhmm(s.ended_at)
    if (g.state === 'imported') out.push({ dot: 'success', when, text: importedText(s) })
    else out.push({ dot: 'error', when, text: failureStep(g), tone: 'red' })
  }
  return out
}

/** "Imported 2 files · replaced nothing": the files the Import wrote and how many library files they replaced, when it said. */
function importedText(s: GrabSteps): string {
  const files = s.files.length > 0 ? `Imported ${plural(s.files.length, 'file')}` : 'Imported'
  if (s.replaced == null) return files
  return `${files} · ${s.replaced === 0 ? 'replaced nothing' : `replaced ${s.replaced}`}`
}

/** The "Now" note of a failed Grab: whether its Release is blocklisted, whether it is still Wanted, and when the next pass runs. */
function nowNote(g: GrabEntry, s: GrabSteps, nextPassAt: string | null, now: number): string {
  const slot = g.slot ? slotLabel[g.slot as SlotKey] : null
  const what = g.episodes.length > 0 ? g.episodes.join(', ') : g.title || 'The Title'
  const parts = [s.blocklist_id !== null ? `The release is blocklisted${slot ? ` for the ${slot} Version` : ''}.` : 'The release is not blocklisted.']
  if (!s.still_wanted) parts.push(`${what} is no longer Wanted.`)
  else parts.push(`${what} is still Wanted${slot ? ` in ${slot}` : ''}${nextPassAt ? `; the next search pass tries again ${until(nextPassAt, now)}` : ''}.`)
  return parts.join(' ')
}

function Timeline({ steps }: { steps: Step[] }) {
  return (
    <ol aria-label="What happened" className="grid grid-cols-[16px_92px_minmax(0,1fr)] items-start gap-x-2.5 gap-y-2.5 text-[13px] max-sm:grid-cols-[16px_auto_minmax(0,1fr)]">
      {steps.map((s) => (
        <li key={s.text} className="contents">
          <span className="mt-0.5">
            <StatusDot state={s.dot} label={false} aria-hidden />
          </span>
          <span className="label-12-mono text-gray-900">{s.when}</span>
          <span className={cx(s.tone === 'red' && 'text-red-900')}>{s.text}</span>
        </li>
      ))}
    </ol>
  )
}

function Files({ steps, formats }: { steps: GrabSteps; formats: GrabSteps['formats'] }) {
  if (steps.files.length === 0 && formats.length === 0) return <span className="label-13 text-gray-900">No files were imported.</span>
  return (
    <dl className="grid grid-cols-[84px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
      {steps.files.map((f) => (
        <div key={f.path} className="contents">
          <dt className="text-gray-900">{f.episode ?? 'File'}</dt>
          <dd className="m-0 min-w-0">
            <EndOfPath path={f.path} />
          </dd>
        </div>
      ))}
      {formats.length > 0 && (
        <>
          <dt className="text-gray-900">Formats</dt>
          <dd className="m-0 flex flex-wrap gap-1.5">
            {formats.map((f) => (
              <Badge key={f.name} variant="blue" contrast="low" size="sm">{`${f.name} ${f.score >= 0 ? '+' : ''}${f.score}`}</Badge>
            ))}
          </dd>
        </>
      )}
    </dl>
  )
}

/** The opened row's body. `onManualSearch` opens the Manual search of the Grab's Version; `onOpenTitle` the Title. */
export function GrabDetail({ grab: g, onOpenTitle, onManualSearch }: { grab: GrabEntry; onOpenTitle: (id: number) => void; onManualSearch: (g: GrabEntry) => void }) {
  const now = useNow()
  const { data: steps, isError } = useGrabSteps(g.grab_id)
  const client = useDownloadClient()
  const search = useSearchStatus().data
  const searchNow = useSearchNow()
  const unblock = useRemoveFromBlocklist()
  const report = useReport()
  const openPlace = useOpenPlace()
  const failed = g.state === 'failed'
  const name = g.title || 'Deleted Title'
  const target = g.episodes.length > 0 ? g.episodes.join(', ') : name
  const pad = 'pl-4 sm:pl-[110px]'

  if (isError) return <Note variant="error">What happened to this Grab could not be loaded.</Note>
  return (
    <div className={cx('flex flex-col gap-4 pr-4 pb-4', pad)}>
      <div className="grid grid-cols-2 gap-x-8 gap-y-4 max-sm:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-2">
          <span className="label-13 font-semibold">What happened</span>
          {steps ? <Timeline steps={stepsOf(g, steps, client?.name ?? 'the download client')} /> : <Skeleton width="100%" height={60} />}
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <span className="label-13 font-semibold">{failed ? 'Now' : 'Files'}</span>
          {!steps ? (
            <Skeleton width="100%" height={60} />
          ) : failed ? (
            <span className="label-13 text-gray-900">{nowNote(g, steps, search?.next_pass_at ?? null, now)}</span>
          ) : (
            <Files steps={steps} formats={steps.formats} />
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {failed ? (
          <>
            {g.version_id !== null && (
              <Button
                variant="primary"
                size="small"
                disabled={searchNow.isPending || searchNow.isSuccess}
                onClick={() =>
                  void report(searchNow.mutateAsync({ versionId: g.version_id!, scope: g.episode_ids.length > 0 ? { episode_ids: g.episode_ids } : undefined }), {
                    started: `Search started for ${name}`,
                    failed: `Could not search ${name}`,
                  })
                }
              >
                {searchNow.isSuccess ? 'Searching…' : `Search ${target} Now`}
              </Button>
            )}
            {g.version_id !== null && (
              <Button variant="secondary" size="small" onClick={() => onManualSearch(g)}>
                Manual Search…
              </Button>
            )}
            {steps?.blocklist_id != null && (
              <Button
                variant="tertiary"
                size="small"
                disabled={unblock.isPending}
                onClick={() => void report(unblock.mutateAsync(steps.blocklist_id!), { done: 'Release removed from the Blocklist', failed: 'Could not remove the Release from the Blocklist' })}
              >
                Remove from Blocklist
              </Button>
            )}
          </>
        ) : (
          <>
            {g.title_id != null && <Button variant="secondary" size="small" onClick={() => onOpenTitle(g.title_id!)}>{`Open ${name}`}</Button>}
            <Button variant="tertiary" size="small" onClick={() => openPlace(placePath('log', termText({ name: 'title', values: [name], excluded: false })))}>
              Show in Log
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
