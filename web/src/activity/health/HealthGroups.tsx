// The health tiles under their group titles, in Activity's Health tab.
import type { ReactNode } from 'react'
import { Tile, type TileData } from './HealthTile'
import type { HealthGroup } from './tiles'

/** `extra` gives a tile its last line, such as the action of a failing check. */
export function HealthGroups({ groups, extra }: { groups: HealthGroup[]; extra?: (tile: TileData) => ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <div key={g.title}>
          <h3 className="label-12 mb-1.5 text-gray-900">{g.title}</h3>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {g.tiles.map((t) => (
              <Tile key={t.key} tile={t}>
                {extra?.(t)}
              </Tile>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
