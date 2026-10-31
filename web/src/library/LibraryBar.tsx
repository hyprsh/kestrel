// The Library's Status section of the Filter menu (All, Wanted, Long Missing, Downloading, Unreleased, Unmonitored,
// each with its count) and its view controls: the Display menu (sort and layout), the "…" menu with the Library-wide maintenance (Adopt, Clean Up) and
// Add Title.
import { Button, DotsMenu, Menu, MenuDivider, MenuItem, MenuSection } from '@hyprsh/design'
import type { Facet } from '../filter/qualifiers'
import { SortSection } from '../layout/FilterButton'
import { LayoutGrid, List, Plus, SlidersHorizontal } from 'lucide-react'
import { stateTabs, type StateTab } from './filter'
import type { LibraryView } from './useLibraryView'

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

/** The Display menu: how the list is ordered (Sort) and whether it is a list or a grid (Layout). Both are remembered: the sort in the filter, the layout in this browser. */
export function DisplayButton({
  view,
  onView,
  phone,
  query,
  onQuery,
  qualifiers,
}: {
  view: LibraryView
  onView: (view: LibraryView) => void
  phone: boolean
  query: string
  onQuery: (query: string) => void
  qualifiers: readonly Facet[]
}) {
  return (
    <Menu.Container position="bottom-start">
      {phone ? (
        <Menu.Button variant="secondary" size="small" svgOnly aria-label="Display">
          <SlidersHorizontal />
        </Menu.Button>
      ) : (
        <Menu.Button variant="secondary" size="small" showChevron title="Sort and layout (g switches grid and list)">
          Display
        </Menu.Button>
      )}
      <Menu width={240} className="max-h-[min(32rem,70vh)] overflow-y-auto">
        <SortSection query={query} onQuery={onQuery} qualifiers={qualifiers} />
        <MenuDivider />
        <MenuSection title="Layout">
          <MenuItem role="radio" checked={view === 'grid'} prefix={<LayoutGrid className="size-4" />} onSelect={() => onView('grid')}>
            Grid
          </MenuItem>
          <MenuItem role="radio" checked={view === 'list'} prefix={<List className="size-4" />} onSelect={() => onView('list')}>
            List
          </MenuItem>
        </MenuSection>
      </Menu>
    </Menu.Container>
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
