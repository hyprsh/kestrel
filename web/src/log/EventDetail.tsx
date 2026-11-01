// An opened event: its stored fields as a key/value grid, for an error whether it happened before, for a Grab where it stands
// now, and the actions under them. One event is open at a time.
import { Button, Link } from '@hyprsh/design'
import { useGrabOfEvent, useSameKind, type LogEvent } from '../api/log'
import { plural } from '../format'
import { useOpenPlace } from '../place'
import { useReport } from '../toasts'
import { errorSignature, fields, fullTime, type Field } from './details'
import { actionOf, chosenBy, kindNames, sentence, severityOf, sentenceText } from './sentence'

const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toLocaleString()}`

/** Where a Grab stands, in words. */
const grabStates: Record<string, string> = {
  sent: 'Sent to the download client',
  downloading: 'Downloading',
  completed: 'Downloaded, waiting for the Import',
  importing: 'Importing',
  imported: 'Imported',
  failed: 'Failed',
}

/** The lines the Grab itself adds to an opened Grab event: indexer, Score with its Custom Formats, who chose it and where it stands. */
function useGrabFields(e: LogEvent): { fields: Field[]; now?: string } {
  const { grab, steps } = useGrabOfEvent(e.kind.startsWith('grab') ? e.grab_id : null)
  const out: Field[] = []
  if (grab) {
    out.push({ key: 'Release', value: grab.release_name, mono: true }, { key: 'Indexer', value: grab.indexer })
    const formats = steps?.formats ?? []
    out.push({ key: 'Score', value: [grab.score.toLocaleString(), ...formats.map((f) => `${f.name} ${signed(f.score)}`)].join(' · ') })
  }
  const by = chosenBy(steps?.grabbed_by)
  if (by) out.push({ key: 'Why', value: by.replace(/^./, (c) => c.toUpperCase()) })
  return { fields: out, now: grab ? (grabStates[grab.state] ?? grab.state) : undefined }
}

/** Earlier times the same error happened, from the Log's events of the same kind with the same signature. */
function SameBefore({ e }: { e: LogEvent }) {
  const same = useSameKind(e.kind)
  const sig = errorSignature(e)
  const earlier = (same.data ?? []).filter((x) => x.id < e.id && sig !== null && errorSignature(x) === sig)
  if (same.isPending) return null
  const times = earlier.slice(0, 5).map((x) => fullTime(x.at))
  const since = earlier.at(-1)
  return (
    <div className="flex flex-col gap-2">
      <span className="label-13 font-semibold">Same error before</span>
      {earlier.length === 0 ? (
        <span className="label-13 text-gray-900">First time in the Log</span>
      ) : (
        <>
          <span className="label-13 text-gray-900">
            {times.join(' · ')}
            {earlier.length > times.length && ` · and ${earlier.length - times.length} earlier`}
          </span>
          <span className="label-12 text-gray-900">
            {plural(earlier.length + 1, 'time')} since {fullTime(since!.at).replace(/, \d\d:\d\d$/, '')}.
            {e.kind === 'health_raised' && earlier.length >= 2 && ' If it keeps coming back, look at what restarts or sleeps on that side.'}
          </span>
        </>
      )}
    </div>
  )
}

/**
 * The body of an opened event, under its row. `title` is the Title's name; `onShowOnly` sets the Log's filter to the event's
 * kind or Title; `onClose` closes it.
 */
export function EventDetail({ e, title, onShowOnly, onOpenTitle }: { e: LogEvent; title?: string; onShowOnly: (kind: 'kind' | 'title') => void; onOpenTitle: (id: number) => void }) {
  const open = useOpenPlace()
  const report = useReport()
  const severity = severityOf(e.kind)
  const grab = useGrabFields(e)
  const base = fields(e, title)
  // The Grab's own lines replace the event's where they say the same (the Release), and When stays last.
  const own = new Set(grab.fields.map((f) => f.key))
  const rows = [...base.slice(0, -1).filter((f) => !own.has(f.key)), ...grab.fields, base[base.length - 1]]
  // Affected is only what the event records: the Title (and the Grab) it is about.
  const affected = severity === 'error' && (title || e.grab_id) ? [title, e.grab_id ? `Grab ${e.grab_id}` : undefined].filter(Boolean).join(' · ') : undefined
  const action = actionOf(e)
  const copy = () => {
    const text = [sentenceText(sentence(e, title)), ...rows.map((f) => `${f.key}: ${f.value}`)].join('\n')
    return report(navigator.clipboard.writeText(text), { done: 'Copied the details', failed: 'Could not copy the details' })
  }
  const showOnly = severity === 'error' ? 'Show Only These Errors' : severity === 'warning' ? 'Show Only These Warnings' : `Show Only ${kindNames[e.kind] ?? 'This Kind'} Events`
  return (
    <div className="pb-4 pl-[104px] pr-4 max-sm:pl-4">
      <div className={severity === 'error' ? 'grid grid-cols-2 gap-x-8 max-lg:grid-cols-1 max-lg:gap-y-4' : 'grid grid-cols-1'}>
        <dl className="label-13 m-0 grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1.5">
          {rows.map((f) => (
            <div key={f.key} className="contents">
              <dt className="text-gray-900">{f.key}</dt>
              <dd className={`m-0 min-w-0 whitespace-pre-line ${f.mono ? 'label-12-mono break-all' : 'break-words'}`}>{f.value}</dd>
            </div>
          ))}
          {affected && (
            <div className="contents">
              <dt className="text-gray-900">Affected</dt>
              <dd className="m-0">{affected}</dd>
            </div>
          )}
          {grab.now && (
            <div className="contents">
              <dt className="text-gray-900">Now</dt>
              <dd className={`m-0 ${grab.now === 'Failed' ? 'text-red-900' : 'text-blue-900'}`}>
                {grab.now} ·{' '}
                <Link as="button" onClick={() => open('/activity')}>
                  View in Activity
                </Link>
              </dd>
            </div>
          )}
        </dl>
        {severity === 'error' && <SameBefore e={e} />}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {action && (
          <Button variant="secondary" size="small" onClick={() => ('title' in action ? onOpenTitle(action.title) : open(action.path))}>
            {action.label === 'Open' ? `Open ${title ?? 'Title'}` : action.label}
          </Button>
        )}
        <Button variant="tertiary" size="small" onClick={() => onShowOnly('kind')}>
          {showOnly}
        </Button>
        {e.title_id != null && title && (
          <Button variant="tertiary" size="small" onClick={() => onShowOnly('title')}>
            Show Only This Title
          </Button>
        )}
        <Button variant="tertiary" size="small" onClick={() => void copy()}>
          Copy Details
        </Button>
      </div>
    </div>
  )
}
