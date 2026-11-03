// chrome: domain-visual
// The health tile: a status dot, a name and one detail line. A failing tile turns red and an amber one amber; no design
// component is a tinted name-and-detail card (audit, Overview). On a phone the same data is a list row.
import { Pill, StatusDot } from '@hyprsh/design'
import { MiddlePath } from '../layout/MiddlePath'
import { useOpenPlace } from '../place'

export type Tone = 'ok' | 'failing' | 'paused' | 'low' | 'idle' | 'update'

const toneUi: Record<Tone, { state: 'success' | 'error' | 'warning' | 'neutral' | 'info'; tile: string; detail: string; word: string }> = {
  ok: { state: 'success', tile: 'border-gray-alpha-400', detail: 'text-gray-900', word: 'ok' },
  failing: { state: 'error', tile: 'border-red-700 bg-red-100', detail: 'text-red-900', word: 'failing' },
  paused: { state: 'warning', tile: 'border-amber-700 bg-amber-100', detail: 'text-amber-900', word: 'paused' },
  low: { state: 'warning', tile: 'border-amber-700 bg-amber-100', detail: 'text-amber-900', word: 'low' },
  idle: { state: 'neutral', tile: 'border-gray-alpha-400', detail: 'text-gray-900', word: 'off' },
  update: { state: 'info', tile: 'border-accent-700 bg-accent-100', detail: 'text-gray-900', word: 'update' },
}

export type TileData = {
  key: string
  /** The plugin instance behind a download client, an indexer or a media server. */
  instanceId?: number | null
  name: string
  /** The folders of a disk tile, each cut in the middle when narrow; the tile's name lists them all. */
  paths?: string[]
  tone: Tone
  /** Replaces the tone's word in the dot's name ("low" for a disk, "not set up"). */
  word?: string
  /** The one detail line: "Connected", "401: bad API key, since 12:12". */
  detail: string
  /** Opens a place, such as About for an update. */
  link?: { path: string; label: string }
}

function Dot({ tile }: { tile: TileData }) {
  const ui = toneUi[tile.tone]
  return <StatusDot state={ui.state} label={false} title={`${tile.name}: ${tile.word ?? ui.word}`} />
}

/** A tile's name: the text, or for a disk its folders one to a line. */
function Name({ tile }: { tile: TileData }) {
  if (!tile.paths) return <span className="min-w-0 truncate">{tile.name}</span>
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      {tile.paths.map((p) => (
        <MiddlePath key={p} path={p} />
      ))}
    </span>
  )
}

/** A tile on a desktop: the dot and name over the detail. */
export function Tile({ tile }: { tile: TileData }) {
  const openPlace = useOpenPlace()
  const ui = toneUi[tile.tone]
  return (
    <li data-tone={tile.tone} className={`flex min-w-0 flex-col gap-1.5 rounded-lg border px-3.5 py-3 ${ui.tile}`}>
      <span className="flex min-w-0 items-center gap-2 font-medium">
        <Dot tile={tile} />
        <Name tile={tile} />
      </span>
      <span className={`label-12 ${ui.detail}`}>{tile.detail}</span>
      {tile.link && (
        <span>
          <Pill onClick={() => openPlace(tile.link!.path)}>{tile.link.label}</Pill>
        </span>
      )}
    </li>
  )
}

/** A tile on a phone: one row, the name with its detail beside it. */
export function TileRow({ tile }: { tile: TileData }) {
  const openPlace = useOpenPlace()
  const ui = toneUi[tile.tone]
  return (
    <li
      data-tone={tile.tone}
      className={`flex items-center gap-2.5 border-b border-gray-alpha-200 px-4 py-2.5 ${tile.tone === 'failing' ? 'bg-red-100' : tile.tone === 'paused' || tile.tone === 'low' ? 'bg-amber-100' : ''}`}
    >
      <Dot tile={tile} />
      {tile.paths ? (
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Name tile={tile} />
          <span className={`label-12 ${ui.detail}`}>{tile.detail}</span>
        </span>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate">{tile.name}</span>
          <span className={`label-12 max-w-[60%] text-right ${ui.detail}`}>{tile.detail}</span>
        </>
      )}
      {tile.link && <Pill onClick={() => openPlace(tile.link!.path)}>{tile.link.label}</Pill>}
    </li>
  )
}
