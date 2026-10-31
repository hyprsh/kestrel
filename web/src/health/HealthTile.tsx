// chrome: domain-visual
// The health tile: a download client, an indexer, a disk or an update as a card that turns red, amber or
// accent with its state, showing the name, the state as a status dot with its word, detail lines, a meter
// and a link. No design component is a tinted name-and-meter card (audit, Overview).
import { Pill, Progress, StatusDot } from '@hyprsh/design'
import type { ReactNode } from 'react'
import { useOpenPlace } from '../place'

export type Tone = 'ok' | 'failing' | 'paused' | 'low' | 'idle' | 'update'

const toneUi: Record<Tone, { state: 'success' | 'error' | 'warning' | 'neutral' | 'info'; tile: string; word: string }> = {
  ok: { state: 'success', tile: 'border-gray-alpha-400', word: 'ok' },
  failing: { state: 'error', tile: 'border-red-700 bg-red-100', word: 'failing' },
  paused: { state: 'warning', tile: 'border-amber-700 bg-amber-100', word: 'paused' },
  low: { state: 'warning', tile: 'border-amber-700 bg-amber-100', word: 'low' },
  idle: { state: 'neutral', tile: 'border-gray-alpha-400', word: 'off' },
  update: { state: 'info', tile: 'border-accent-700 bg-accent-100', word: 'update' },
}

export type TileData = {
  key: string
  /** The plugin instance behind a download client or an indexer, to match its Needs attention row. */
  instanceId?: number | null
  name: string
  tone: Tone
  /** Replaces the tone's word ("low" for a disk, "not set up"). */
  word?: string
  details: string[]
  meter?: { value: number; max: number; warn: boolean; label: string }
  /** Opens a place, such as About for an update. */
  link?: { path: string; label: string }
}

/** `children` is the tile's last line, such as the action of a failing check. */
export function Tile({ tile, children }: { tile: TileData; children?: ReactNode }) {
  const openPlace = useOpenPlace()
  const ui = toneUi[tile.tone]
  return (
    <li className={`rounded-lg border px-3 py-2 ${ui.tile}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-medium">{tile.name}</span>
        <span className="shrink-0">
          <StatusDot state={ui.state} label={tile.word ?? ui.word} />
        </span>
      </div>
      {tile.details.map((d) => (
        <p key={d} className="label-12 mt-0.5 text-gray-900">
          {d}
        </p>
      ))}
      {tile.meter && (
        <div className="mt-1.5">
          <Progress value={tile.meter.value} max={tile.meter.max} type={tile.meter.warn ? 'warning' : 'default'} height={6} aria-label={tile.meter.label} />
        </div>
      )}
      {children}
      {tile.link && (
        <div className="mt-1">
          <Pill onClick={() => openPlace(tile.link!.path)}>{tile.link.label}</Pill>
        </div>
      )}
    </li>
  )
}
