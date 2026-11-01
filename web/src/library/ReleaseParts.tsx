// The parts of Manual search that show one Release: the Best fit card, a row's opened detail, what a grab turns a row into
// (a download, or a failure), and the confirm for a grab that overrides a rejection or replaces files.
import { Badge, Button, Entity, Link, Modal, ModalAction, ModalActions, ModalBody, ModalHeader, ModalSubtitle, ModalTitle, Progress } from '@hyprsh/design'
import { CircleX, Download, TriangleAlert } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { useGrabStatus, type Release } from '../api/grabs'
import { useQueue } from '../api/queue'
import { percent } from '../format'
import { span } from '../time'
import { size } from './bits'
import { audioFormat, audioLine, qualityLine, qualityName } from './media'
import {
  ageLong,
  breakdown,
  coverLines,
  coverRange,
  deltaText,
  fillsReplaces,
  fitsProfile,
  grabState,
  heldScores,
  published,
  rejectionAdvice,
  rejectionBlocked,
  score,
  signed,
  whyLine,
} from './releaseView'

/** What became of a Release grabbed in this search. */
export type GrabEntry = { status: 'pending' } | { status: 'sent'; grabId: number; fills: string[]; at: number } | { status: 'failed'; message: string }

/** The actions a Release's parts offer; the search screen owns what they do. */
export type ReleaseActions = {
  /** Grab the Release; the screen asks first when it overrides a rejection or replaces files. */
  grab: (x: Release) => void
  blocklist: (x: Release) => void
  copyLink: (x: Release) => void
  openActivity: (grabId: number) => void
  /** A grab that was sent has since failed in the download client. */
  failed: (x: Release, message: string) => void
  /** The next best Release that fits and has not been tried, with its Score. */
  nextBest: Release | undefined
}

const tint = { sent: { background: 'var(--blue-100)' }, failed: { background: 'var(--red-100)' } } as const
export const rowTint = (entry: GrabEntry | undefined) => (entry?.status === 'sent' ? tint.sent : entry?.status === 'failed' ? tint.failed : undefined)

/** The fact chips of the Best fit card. */
function Fact({ children }: { children: ReactNode }) {
  return (
    <Badge variant="gray" contrast="low" size="sm">
      {children}
    </Badge>
  )
}

/** How a sent grab is doing: the live queue while the client has it, else where Kestrel recorded it. */
function useDownload(entry: Extract<GrabEntry, { status: 'sent' }>, x: Release, actions: ReleaseActions) {
  const queue = useQueue()
  const item = queue.data?.find((i) => i.grab_id === entry.grabId)
  const status = useGrabStatus(queue.isSuccess && !item ? entry.grabId : undefined)
  const state = status.data?.state
  const { failed } = actions
  useEffect(() => {
    if (state === 'failed') failed(x, 'The download client reported that the download failed.')
  }, [state, failed, x])
  if (item) {
    const pct = percent(item.bytes_total, item.phase === 'importing' ? 0 : item.bytes_left)
    const eta = item.eta != null && item.eta > 0 ? ` · ${span(item.eta * 1000)}` : ''
    const text =
      item.phase === 'queued'
        ? 'Queued'
        : item.phase === 'paused'
          ? 'Paused'
          : item.phase === 'importing'
            ? 'Importing'
            : item.phase === 'post_processing'
              ? 'Processing'
              : `Downloading${pct != null ? ` · ${pct}%` : ''}${eta}`
    return { pct: pct ?? 0, text }
  }
  if (state === 'imported') return { pct: 100, text: 'Imported' }
  if (state === 'completed' || state === 'importing') return { pct: 100, text: 'Importing' }
  return { pct: 0, text: 'Sent to the download client' }
}

/** A row's name with its download bar under it, and the words beside it. Two parts, so a row can place them in cells. */
export function Downloading({ entry, x, actions, part }: { entry: Extract<GrabEntry, { status: 'sent' }>; x: Release; actions: ReleaseActions; part: 'bar' | 'text' }) {
  const d = useDownload(entry, x, actions)
  if (part === 'bar') return <Progress value={d.pct} type="success" height={4} aria-label={`Download progress of ${x.name}`} />
  return (
    <div className="label-13 flex flex-col items-end gap-0.5 text-blue-900">
      <span>{d.text}</span>
      <Link as="button" onClick={() => actions.openActivity(entry.grabId)}>
        View in Activity
      </Link>
    </div>
  )
}

/** What a failed grab says and offers: the reason, Retry, and the next best Release. */
export function FailedText({ message }: { message: string }) {
  return (
    <span className="label-13 flex items-center gap-1.5 text-red-900">
      <CircleX size={14} aria-hidden />
      {message}
    </span>
  )
}

export function FailedActions({ x, actions }: { x: Release; actions: ReleaseActions }) {
  const next = actions.nextBest
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="secondary" size="small" onClick={() => actions.grab(x)}>
        Retry
      </Button>
      {next && (
        <Button variant="primary" size="small" onClick={() => actions.grab(next)}>
          {`Grab Next Best (${score(next.score)})`}
        </Button>
      )}
    </div>
  )
}

/** The Best fit: the top Release that fits, with the one action. */
export function BestFit({ x, wanted, entry, actions, phone }: { x: Release; wanted: number; entry: GrabEntry | undefined; actions: ReleaseActions; phone: boolean }) {
  const pending = entry?.status === 'pending'
  const grab = (
    <Button variant="primary" size={phone ? 'large' : 'medium'} width={phone ? '100%' : undefined} prefix={<Download />} loading={pending} disabled={pending} onClick={() => actions.grab(x)}>
      {pending ? 'Grabbing…' : 'Grab'}
    </Button>
  )
  const sent = entry?.status === 'sent' ? entry : undefined
  return (
    <section aria-label="Best fit">
      <Entity.List>
        <Entity style={rowTint(entry)}>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-center gap-2">
              <Badge variant="green" contrast="low" size="sm">
                Best fit
              </Badge>
              {!phone && <span className="label-13 text-gray-900">{whyLine(x, wanted)}</span>}
              {phone && <span className="hy-num heading-20 ml-auto">{score(x.score)}</span>}
            </div>
            <span className="label-14-mono break-all">{x.name}</span>
            {sent ? (
              <Downloading entry={sent} x={x} actions={actions} part="bar" />
            ) : (
              <div className="flex flex-wrap gap-1.5">
                <Fact>{qualityName(x.quality)}</Fact>
                {x.hdr && <Fact>{x.hdr}</Fact>}
                {audioFormat(x) && <Fact>{audioFormat(x)}</Fact>}
                {x.languages.map((l) => (
                  <Fact key={l}>{l}</Fact>
                ))}
                <Fact>{size(x.size)}</Fact>
                <Fact>{ageLong(x.published_at)}</Fact>
                <Fact>{x.indexer}</Fact>
              </div>
            )}
            {!sent && x.custom_formats.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {x.custom_formats.map((f) => (
                  <Badge key={f.name} variant="blue" contrast="low" size="sm">
                    {`${f.name} ${signed(f.points)}`}
                  </Badge>
                ))}
              </div>
            )}
            {entry?.status === 'failed' && <FailedText message={entry.message} />}
            {phone && !sent && entry?.status !== 'failed' && grab}
            {phone && entry?.status === 'failed' && <FailedActions x={x} actions={actions} />}
          </div>
          {!phone && (
            <div className="flex shrink-0 flex-col items-end gap-3">
              <div className="text-right">
                <div className="hy-num heading-24">{score(x.score)}</div>
                <div className="label-12 text-gray-900">Score</div>
              </div>
              {sent ? <Downloading entry={sent} x={x} actions={actions} part="text" /> : entry?.status === 'failed' ? <FailedActions x={x} actions={actions} /> : grab}
            </div>
          )}
          {phone && sent && <Downloading entry={sent} x={x} actions={actions} part="text" />}
        </Entity>
      </Entity.List>
    </section>
  )
}

/** The opened row: what it covers, where it comes from, why it scores what it does, and what can be done with it. */
export function ReleaseDetail({
  x,
  profileName,
  bestScore,
  isBest,
  actions,
  blocklisted,
}: {
  x: Release
  profileName: string
  bestScore: number | undefined
  isBest: boolean
  actions: ReleaseActions
  blocklisted: boolean
}) {
  const g = grabState(x)
  const actionRow = (
    <div className="flex flex-wrap gap-2">
      {g.disabled ? null : (
        <Button variant={g.override ? 'secondary' : 'primary'} size="small" onClick={() => actions.grab(x)}>
          {g.override ? 'Grab Anyway…' : 'Grab'}
        </Button>
      )}
      {!blocklisted && (
        <Button variant="secondary" size="small" onClick={() => actions.blocklist(x)}>
          Blocklist
        </Button>
      )}
      <Button variant="tertiary" size="small" disabled={!x.info_url} title={x.info_url ? undefined : 'The indexer gives no link for this Release'} onClick={() => actions.copyLink(x)}>
        Copy Link
      </Button>
    </div>
  )
  if (!fitsProfile(x)) {
    const blocked = rejectionBlocked(x)
    return (
      <div className="flex flex-col gap-3">
        <div className={`label-13 flex items-start gap-2 ${blocked ? 'text-red-900' : 'text-amber-900'}`}>
          <TriangleAlert size={16} className="shrink-0" aria-hidden />
          <span>{`Rejected: ${x.rejections.map((r) => r.message).join('; ')}. ${rejectionAdvice(x)}`}</span>
        </div>
        {actionRow}
      </div>
    )
  }
  const { rows, rest } = breakdown(x)
  const lines = coverLines(x)
  const facts: [string, ReactNode][] = []
  if (lines.length > 0) facts.push(['Covers', lines.map((l) => <div key={l}>{l}</div>)])
  facts.push(['Quality', qualityLine(x) || x.quality], ['Audio', audioLine(x) || 'Unknown'], ['Size', size(x.size)])
  facts.push(['Published', `${published(x.published_at)}, ${ageLong(x.published_at)} ago`])
  facts.push(['Indexer', x.grabs ? `${x.indexer} · ${x.grabs.toLocaleString('en-US')} grabs` : x.indexer])
  if (x.group) facts.push(['Group', x.group])
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        <dl className="label-13 grid grid-cols-[6rem_minmax(0,1fr)] content-start gap-x-3 gap-y-1.5">
          {facts.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-gray-900">{k}</dt>
              <dd className="min-w-0 break-words">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-col gap-2">
          <span className="label-13 font-semibold">{`Why it scores ${score(x.score)}`}</span>
          <dl className="label-13 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5">
            {rows.map((f) => (
              <div key={f.name} className="contents">
                <dt>{f.name}</dt>
                <dd className={`hy-num text-right ${f.points < 0 ? 'text-red-900' : 'text-green-900'}`}>{signed(f.points)}</dd>
              </div>
            ))}
            {rest !== 0 && (
              <div className="contents">
                <dt>Profile and quality</dt>
                <dd className={`hy-num text-right ${rest < 0 ? 'text-red-900' : 'text-green-900'}`}>{signed(rest)}</dd>
              </div>
            )}
            <dt className="font-semibold">Score</dt>
            <dd className="hy-num text-right font-semibold">{score(x.score)}</dd>
          </dl>
          <span className="label-12 text-gray-900">
            {isBest || bestScore === undefined ? `Fits ${profileName}. This is the best fit.` : `Fits ${profileName}. The best fit scores ${score(bestScore)}.`}
          </span>
        </div>
      </div>
      {actionRow}
    </div>
  )
}

/** The confirm for a grab that overrides a rejection or replaces files you have. */
export function ConfirmGrab({ x, slotLabel, onCancel, onConfirm }: { x: Release; slotLabel: string; onCancel: () => void; onConfirm: () => void }) {
  const { fills, replaces } = fillsReplaces(x)
  const override = !fitsProfile(x)
  const n = replaces.length
  const what = x.pack ? 'season pack' : 'Release'
  const title = n > 0 ? `Replace ${n} ${n === 1 ? 'file' : 'files'}?` : 'Grab anyway?'
  const held = heldScores(replaces)
  const movie = replaces.length === 1 && replaces[0].season == null
  const delta = deltaText(x, replaces)
  return (
    <Modal open onClose={onCancel}>
      <ModalBody>
        <ModalHeader>
          <ModalTitle>{title}</ModalTitle>
          <ModalSubtitle>
            {override && <span className="block">{`Rejected: ${x.rejections.map((r) => r.message).join('; ')}. ${rejectionAdvice(x)}`}</span>}
            {n > 0 && (
              <span className="block">
                {movie
                  ? `This ${what} replaces the file you have in ${slotLabel}${held ? ` at Score ${held}` : ''}. After the import Kestrel swaps it for the ${what}'s (Score ${score(x.score)}).`
                  : `This ${what} also covers ${coverRange(replaces)}, which you have in ${slotLabel}${held ? ` at Score ${held}` : ''}. After the import Kestrel swaps ${n === 1 ? 'it' : 'them'} for the ${what}'s (Score ${score(x.score)}).`}
              </span>
            )}
          </ModalSubtitle>
        </ModalHeader>
        <dl className="label-13 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1">
          {fills.length > 0 && (
            <div className="contents">
              <dt>Fills</dt>
              <dd className="text-right">{`${coverRange(fills) || 'The Movie'} · ${fills.length} Wanted`}</dd>
            </div>
          )}
          {n > 0 && (
            <div className="contents">
              <dt>Replaces</dt>
              <dd className="text-right">{`${movie ? 'The file' : coverRange(replaces)}${delta ? ` · ${delta}` : ''}`}</dd>
            </div>
          )}
          <dt>Download</dt>
          <dd className="text-right">{size(x.size)}</dd>
        </dl>
      </ModalBody>
      <ModalActions>
        <ModalAction variant="secondary" onClick={onCancel}>
          Cancel
        </ModalAction>
        <ModalAction variant="primary" onClick={onConfirm}>
          {n > 0 ? 'Grab and Replace' : 'Grab Anyway'}
        </ModalAction>
      </ModalActions>
    </Modal>
  )
}
