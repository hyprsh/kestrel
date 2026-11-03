import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { MenuItem, NavItem } from '@hyprsh/design'
const slotKeys = ['standard', '4k']
import type { Facet } from '../filter/qualifiers'
import { FacetFilterButton, FilterButton, SortButton } from './FilterButton'
import { FilterStrip } from './FilterStrip'
import { PageSurface } from './PageSurface'
import { PhoneBackHeader } from './PhoneBackHeader'
import { Rail, RailSpacer } from './Rail'
import { SectionBlock } from './SectionBlock'
import { FilterChips, SidePanel, SidePanelPhoneContext, SidePanelViews } from './SidePanel'
import { PhoneTopBar } from './TopBar'
import { WidePage } from './WidePage'

describe('the layout pieces', () => {
  it('FilterStrip holds its children', () => {
    render(
      <FilterStrip>
        <button>All</button>
        <button>Movies</button>
      </FilterStrip>,
    )
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['All', 'Movies'])
  })

  it('PhoneBackHeader shows the title and calls onBack from its Back button', async () => {
    const onBack = vi.fn()
    render(<PhoneBackHeader onBack={onBack}>Paddington</PhoneBackHeader>)
    expect(screen.getByText('Paddington')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('SectionBlock is a region named by its title and count, around its children', () => {
    render(
      <SectionBlock title="Downloading" count={3}>
        <p>rows</p>
      </SectionBlock>,
    )
    const region = screen.getByRole('region', { name: 'Downloading · 3' })
    expect(within(region).getByRole('heading', { name: 'Downloading · 3' })).toBeInTheDocument()
    expect(within(region).getByText('rows')).toBeInTheDocument()
  })

  it('PageSurface holds its children', () => {
    render(
      <PageSurface>
        <h1>Log in</h1>
      </PageSurface>,
    )
    expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument()
  })

  it('Rail is a navigation landmark around its children', () => {
    render(
      <Rail>
        <button>Add</button>
        <RailSpacer />
        <button>About</button>
      </Rail>,
    )
    expect(
      within(screen.getByRole('navigation'))
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Add', 'About'])
  })

  it('PhoneTopBar shows the title and what follows it', () => {
    render(
      <PhoneTopBar title="Log">
        <button>Add</button>
      </PhoneTopBar>,
    )
    const phone = screen.getByRole('banner')
    expect(phone).toHaveTextContent('Log')
    expect(within(phone).getByRole('button', { name: 'Add' })).toBeInTheDocument()
  })

  it('WidePage holds its children', () => {
    render(
      <WidePage>
        <h1>Set up Kestrel</h1>
      </WidePage>,
    )
    expect(screen.getByRole('heading', { name: 'Set up Kestrel' })).toBeInTheDocument()
  })
})

describe('SidePanel', () => {
  const onRemove = vi.fn()
  const panel = (
    <SidePanel
      title="Library"
      width="wide"
      actions={<button>Add</button>}
      filter={<input aria-label="Field" />}
      controls={<button>Filter</button>}
      chips={<FilterChips chips={[{ key: 'a', label: 'Wanted', onRemove }]} />}
      views={
        <SidePanelViews>
          <NavItem current="true" trailing={3} onClick={() => {}}>
            Everything
          </NavItem>
        </SidePanelViews>
      }
      footer={<span>3 of 6</span>}
    >
      <div>the list</div>
    </SidePanel>
  )
  it('is a region named by its title, with the title as the h1, then the actions, the field, the controls, the chips, the views, the body and the footer', () => {
    render(panel)
    const region = screen.getByRole('complementary', { name: 'Library' })
    expect(within(region).getByRole('heading', { level: 1, name: 'Library' })).toBeInTheDocument()
    const order = [
      screen.getByRole('heading', { name: 'Library' }),
      screen.getByRole('button', { name: 'Add' }),
      screen.getByRole('textbox', { name: 'Field' }),
      screen.getByRole('button', { name: 'Filter' }),
      screen.getByRole('button', { name: 'Remove Wanted' }),
      screen.getByRole('navigation', { name: 'Views' }),
      screen.getByText('the list'),
      screen.getByText('3 of 6'),
    ]
    for (let i = 1; i < order.length; i++) expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Everything/ })).toHaveAttribute('aria-current', 'true')
  })

  it('removes a chip when its button is pressed, and shows none without chips', async () => {
    const { rerender } = render(panel)
    await userEvent.click(screen.getByRole('button', { name: 'Remove Wanted' }))
    expect(onRemove).toHaveBeenCalledOnce()
    rerender(<FilterChips chips={[]} />)
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('is the screen header on a phone: the title with the phone extras and the actions, the field with the controls, and no body or footer', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }))
    render(<SidePanelPhoneContext.Provider value={<button>Health</button>}>{panel}</SidePanelPhoneContext.Provider>)
    vi.unstubAllGlobals()
    const header = screen.getByRole('banner')
    expect(within(header).getByRole('heading', { name: 'Library' })).toBeInTheDocument()
    const order = [
      screen.getByRole('button', { name: 'Health' }),
      screen.getByRole('button', { name: 'Add' }),
      screen.getByRole('textbox', { name: 'Field' }),
      screen.getByRole('button', { name: 'Filter' }),
    ]
    for (let i = 1; i < order.length; i++) expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText('the list')).not.toBeInTheDocument()
    expect(screen.queryByText('3 of 6')).not.toBeInTheDocument()
  })
})

describe('FilterButton', () => {
  it('says how many are active in its name and holds what it is given', async () => {
    const { rerender } = render(
      <FilterButton count={0}>
        <MenuItem checked={false}>Wanted only</MenuItem>
      </FilterButton>,
    )
    expect(screen.getByRole('button', { name: 'Filter' })).toBeInTheDocument()
    rerender(
      <FilterButton count={2}>
        <MenuItem checked>Wanted only</MenuItem>
      </FilterButton>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Filter · 2' }))
    expect(screen.getByRole('menuitemcheckbox', { name: 'Wanted only' })).toHaveAttribute('aria-checked', 'true')
  })
})

const facets: Facet[] = [
  { name: 'slot', label: 'Slot', help: 'a Slot', values: slotKeys, excludable: true, options: { standard: { label: 'Standard' }, '4k': { label: '4K' } } },
  { name: 'kind', label: 'Kind', help: 'a kind', values: ['movie', 'series'], excludable: true, options: { movie: { label: 'Movies' }, series: { label: 'Series' } } },
  { name: 'sort', label: 'Sort', single: 'Newest added', help: 'an order', values: ['name-asc'], options: { 'name-asc': { label: 'Name A–Z' } } },
]

function Harness({ start = '' }: { start?: string }) {
  const [query, setQuery] = useState(start)
  return (
    <>
      <output>{query}</output>
      <FacetFilterButton query={query} onQuery={setQuery} qualifiers={facets} />
      <SortButton query={query} onQuery={setQuery} qualifiers={facets} />
    </>
  )
}

describe('FacetFilterButton', () => {
  it('writes the token of a facet into the query, next to what is already there', async () => {
    render(<Harness start="heat" />)
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }))
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: '4K' }))
    expect(screen.getByRole('status')).toHaveTextContent('heat slot:4k')
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Series' }))
    expect(screen.getByRole('status')).toHaveTextContent('heat slot:4k kind:series')
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: '4K' }))
    expect(screen.getByRole('status')).toHaveTextContent('heat kind:series')
  })

  it('counts the facets that are active, not their values, and leaves Sort to its own button', async () => {
    render(<Harness start="slot:standard,4k kind:movie sort:name-asc" />)
    await userEvent.click(screen.getByRole('button', { name: 'Filter · 2' }))
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Name A–Z' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitemcheckbox', { name: 'Standard' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemcheckbox', { name: 'Series' })).toHaveAttribute('aria-checked', 'false')
  })
})

describe('SortButton', () => {
  it('names the sort, replaces its term and takes it out for the default', async () => {
    render(<Harness start="heat" />)
    await userEvent.click(screen.getByRole('button', { name: 'Sort: Newest added' }))
    expect(screen.getByRole('menuitemradio', { name: 'Newest added' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Name A–Z' }))
    expect(screen.getByRole('status')).toHaveTextContent('heat sort:name-asc')
    await userEvent.click(screen.getByRole('button', { name: 'Sort: Name A–Z' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Newest added' }))
    expect(screen.getByRole('status')).toHaveTextContent(/^heat$/)
  })
})
