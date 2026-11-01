// The health tiles under their group titles, on the Health screen: a grid of tiles on a desktop, a list on a phone.
import { usePhone } from '../responsive'
import { Tile, TileRow } from './HealthTile'
import type { HealthGroup } from './tiles'

export function HealthGroups({ groups }: { groups: HealthGroup[] }) {
  const phone = usePhone()
  return (
    <div className="flex flex-col gap-4 max-sm:gap-0 max-sm:-mx-4">
      {groups.map((g) => (
        <div key={g.title}>
          <h4 className="label-12 mb-1.5 font-semibold text-gray-900 max-sm:mb-0 max-sm:px-4 max-sm:py-1.5">{g.title}</h4>
          <ul className={phone ? 'flex flex-col' : 'grid grid-cols-2 gap-2.5 lg:grid-cols-3'}>{g.tiles.map((t) => (phone ? <TileRow key={t.key} tile={t} /> : <Tile key={t.key} tile={t} />))}</ul>
        </div>
      ))}
    </div>
  )
}
