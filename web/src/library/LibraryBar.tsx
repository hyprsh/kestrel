// The Library's Status section of the Filter menu (All, Wanted, Long Missing, Downloading, Unreleased, Unmonitored,
// each with its count) and its view controls: the "…" menu with the Library-wide maintenance (Adopt, Clean Up) and
// Add Title.
import { Button, DotsMenu, MenuItem, MenuSection } from '@hyprsh/design'
import { Plus } from 'lucide-react'
import { stateTabs, type StateTab } from './filter'

/**
 * The Status section of the Filter menu: All, Wanted, Long Missing, Downloading, Unreleased and Unmonitored, each with
 * its count. A status is the filter's `is:` term (see ./filter.ts), so it is kept in the address bar like the rest; All
 * takes the term out. `selected` is '' when the filter's `is:` is no status of this list.
 */
export function StatusSection({ selected, counts, onSelect }: { selected: StateTab | ''; counts: Record<StateTab, number> | null; onSelect: (tab: StateTab) => void }) {
  return (
    <MenuSection title="Status">
      {stateTabs.map((t) => {
        const n = counts?.[t.value]
        return (
          <MenuItem
            key={t.value}
            role="radio"
            checked={selected === t.value}
            onSelect={() => onSelect(t.value)}
            suffix={n === undefined ? undefined : <span className={`tabular-nums ${t.value === 'long_missing' && n > 0 ? 'text-red-900' : 'text-gray-900'}`}>{n}</span>}
          >
            {t.label}
          </MenuItem>
        )
      })}
    </MenuSection>
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
