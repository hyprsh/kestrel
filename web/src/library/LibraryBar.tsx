// The Library's state tabs (All, Wanted, Long Missing, Downloading, Unreleased, Unmonitored, each with its count)
// and its view controls: the grid/list switch, the "…" menu with the Library-wide maintenance (Adopt, Clean Up) and
// Add Title. A tab writes the filter's `is:` term (see ./filter.ts), so it is kept in the address bar like the rest.
import { DotsMenu, MenuItem, Switch, SwitchControl, Tabs, Button, Tooltip } from '@hyprsh/design'
import { LayoutGrid, List, Plus } from 'lucide-react'
import { stateTabs, type StateTab } from './filter'
import type { LibraryView } from './useLibraryView'

/** A tab's name and its count; Long Missing's count is red while there are any. */
function TabTitle({ label, count, alarm }: { label: string; count: number | null; alarm?: boolean }) {
  return (
    <>
      {label}
      {count !== null && (
        <>
          {' '}
          <span className={`tabular-nums ${alarm && count > 0 ? 'text-red-900' : 'text-gray-900'}`}>{count}</span>
        </>
      )}
    </>
  )
}

/** The state tabs: underlined on a wide screen, pills that scroll sideways on a phone. `selected` is '' when the filter's `is:` is no tab's. */
export function StateTabs({ selected, counts, onSelect, phone }: { selected: StateTab | ''; counts: Record<StateTab, number> | null; onSelect: (tab: StateTab) => void; phone: boolean }) {
  return (
    <Tabs
      aria-label="Library states"
      variant={phone ? 'secondary' : 'primary'}
      selected={selected}
      onChange={(v) => onSelect(v as StateTab)}
      tabs={stateTabs.map((t) => ({ value: t.value, title: <TabTitle label={t.label} count={counts ? counts[t.value] : null} alarm={t.value === 'long_missing'} /> }))}
    />
  )
}

/** Grid or list, as two icon segments. */
export function ViewSwitch({ view, onChange, phone }: { view: LibraryView; onChange: (view: LibraryView) => void; phone: boolean }) {
  return (
    <Tooltip text={phone ? 'Grid or list' : 'Grid or list (g)'}>
      <Switch name="library-view" size="small" value={view} onChange={(v) => onChange(v as LibraryView)} aria-label="View">
        <SwitchControl label="Grid" value="grid" icon={<LayoutGrid />} />
        <SwitchControl label="List" value="list" icon={<List />} />
      </Switch>
    </Tooltip>
  )
}

/** The Library-wide actions that are not about the Titles shown: Adopt and Clean Up, and on a phone Tick Titles, since its rows show no tick boxes until then. */
export function LibraryMenu({ onAdopt, onCleanup, onTick }: { onAdopt: () => void; onCleanup: () => void; onTick?: () => void }) {
  return (
    <DotsMenu aria-label="Library actions" width={240}>
      {onTick && <MenuItem onSelect={onTick}>Tick Titles</MenuItem>}
      <MenuItem onSelect={onAdopt} description="Take in files already on disk">
        Adopt Existing Library
      </MenuItem>
      <MenuItem onSelect={onCleanup} description="Delete files no Version holds">
        Clean Up Unmanaged Files
      </MenuItem>
    </DotsMenu>
  )
}

export function AddTitle({ onAdd }: { onAdd: () => void }) {
  return (
    <Button variant="primary" size="small" prefix={<Plus />} onClick={onAdd}>
      Add Title
    </Button>
  )
}
