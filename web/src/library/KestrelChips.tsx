// chrome: domain-visual
// The Kestrel block of a Title's header: one row of chips after the overview. Slot chips come from TitleBadges; this file holds the others,
// each a small button whose popover says its full sentence: monitoring and the Cutoff, the release, and who requested the Title (a link to their Request).
import { Button, ButtonLink, Popover } from '@hyprsh/design'
import type { MouseEvent } from 'react'
import type { TitleDetail, TitleRow } from '../api/queries'
import { placePath, useOpenPlace } from '../place'
import { sourceName } from '../requests/source'
import { isMonitored, useMonitoringText } from './MonitorButton'

const chipClass = 'label-12 shrink-0 bg-gray-100 px-2 whitespace-nowrap'

/** A chip with its full sentence in a popover (and as its tooltip). */
export function SentenceChip({ text, sentence, name }: { text: string; sentence: string; name: string }) {
  return (
    <Popover
      trigger={
        <Button variant="tertiary" size="tiny" shape="rounded" title={sentence} aria-label={`${name}: ${sentence}`} className={chipClass}>
          {text}
        </Button>
      }
      label={name}
      position="bottom-start"
      width={320}
    >
      <p className="label-13">{sentence}</p>
    </Popover>
  )
}

/**
 * "Upgrading to Cutoff", "At Cutoff" or "Not monitored". "At Cutoff" only when every Version is filled and none wants an Upgrade; a
 * monitored Title with something still Wanted or downloading (or no file yet) is plain "Monitored", and its sentence says what Kestrel does.
 */
export function monitoringChip(title: TitleDetail, row: TitleRow | undefined): string {
  if (!isMonitored(title)) return 'Not monitored'
  const states = row?.slot_states ?? []
  if (states.some((s) => s.state === 'filled' && s.upgrade_wanted)) return 'Upgrading to Cutoff'
  const filled = states.length > 0 ? states.every((s) => s.state === 'filled') : title.versions.length > 0 && title.versions.every((v) => v.state === 'filled')
  return filled ? 'At Cutoff' : 'Monitored'
}

export function MonitoringChip({ title, row }: { title: TitleDetail; row?: TitleRow }) {
  const sentence = useMonitoringText(title)
  return <SentenceChip name="Kestrel monitoring" text={monitoringChip(title, row)} sentence={sentence} />
}

const medium = new Intl.DateTimeFormat('en', { dateStyle: 'medium' })
const when = (iso: string) => medium.format(new Date(iso))

/** The chip of a Request: who asked and through what, linking to the Requests screen filtered to it. */
export function RequestChips({ title }: { title: TitleDetail }) {
  const openPlace = useOpenPlace()
  return title.requests.map((r) => {
    const path = placePath('requests', '', String(r.id))
    const sentence = `Requested by ${r.requester_name} via ${sourceName(r.source)} on ${when(r.created_at)}. Open the Request.`
    return (
      <ButtonLink
        key={r.id}
        href={`.${path}`}
        variant="tertiary"
        size="tiny"
        shape="rounded"
        title={sentence}
        aria-label={`Request: ${sentence}`}
        className={chipClass}
        onClick={(e: MouseEvent<HTMLElement>) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
          e.preventDefault()
          openPlace(path)
        }}
      >
        {`Requested by ${r.requester_name} · ${sourceName(r.source)}`}
      </ButtonLink>
    )
  })
}
