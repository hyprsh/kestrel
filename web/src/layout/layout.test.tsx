import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { MenuItem } from '@hyprsh/design'
import { slotKeys } from '../library/bits'
import type { Facet } from '../filter/qualifiers'
import { FacetFilterButton, FilterButton, SortButton } from './FilterButton'
import { FilterStrip } from './FilterStrip'
import { PageSurface } from './PageSurface'
import { PaneFooter, PaneHeader } from './Pane'
import { PhoneBackHeader } from './PhoneBackHeader'
import { Rail, RailSpacer } from './Rail'
import { SectionBlock } from './SectionBlock'
import { ScreenBar, ScreenBarPlacesContext, ViewSwitcher } from './ScreenBar'
import { PhoneTopBar, TopBar } from './TopBar'
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

  it('PaneHeader and PaneFooter hold their children', () => {
    render(
      <>
        <PaneHeader>Header text</PaneHeader>
        <PaneFooter>Footer text</PaneFooter>
      </>,
    )
    expect(screen.getByText('Header text')).toBeInTheDocument()
    expect(screen.getByRole('contentinfo')).toHaveTextContent('Footer text')
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

  it('TopBar and PhoneTopBar show the title, the middle and the end', () => {
    render(
      <>
        <TopBar title="Library" end={<span>status</span>}>
          <button>Search</button>
        </TopBar>
        <PhoneTopBar title="Log">
          <button>Add</button>
        </PhoneTopBar>
      </>,
    )
    const [desktop, phone] = screen.getAllByRole('banner')
    expect(desktop).toHaveTextContent('LibrarySearchstatus')
    expect(within(desktop).getByRole('button', { name: 'Search' })).toBeInTheDocument()
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

describe('ScreenBar', () => {
  it('holds the view, the menu and the actions, with the menu before the action at the right end', () => {
    render(<ScreenBar view={<span>View</span>} menu={<button>Menu</button>} actions={<button>Add</button>} />)
    expect(screen.getByText('View')).toBeInTheDocument()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Menu', 'Add'])
  })

  it('puts the view, the filter, its controls and the aside in one row, in that order', () => {
    render(<ScreenBar view={<button>Pages</button>} filter={<input aria-label="Field" />} controls={<button>Filter</button>} aside={<button>Today</button>} />)
    const order = [
      screen.getByRole('button', { name: 'Pages' }),
      screen.getByRole('textbox', { name: 'Field' }),
      screen.getByRole('button', { name: 'Filter' }),
      screen.getByRole('button', { name: 'Today' }),
    ]
    for (let i = 1; i < order.length; i++) expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('goes into the top bar places when it is given them: the bar in the middle, the menu and the action at the end', () => {
    const middle = document.createElement('div')
    const end = document.createElement('div')
    document.body.append(middle, end)
    render(
      <ScreenBarPlacesContext.Provider value={{ middle, end }}>
        <ScreenBar view={<button>Pages</button>} filter={<input aria-label="Field" />} menu={<button>Menu</button>} actions={<button>Add</button>} />
      </ScreenBarPlacesContext.Provider>,
    )
    expect(within(middle).getByRole('button', { name: 'Pages' })).toBeInTheDocument()
    expect(within(middle).getByRole('textbox', { name: 'Field' })).toBeInTheDocument()
    expect(
      within(end)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Menu', 'Add'])
    middle.remove()
    end.remove()
  })

  it('waits while the top bar places are not mounted yet, and shows no row of its own', () => {
    render(
      <ScreenBarPlacesContext.Provider value={{ middle: null, end: null }}>
        <ScreenBar view={<button>Pages</button>} />
      </ScreenBarPlacesContext.Provider>,
    )
    expect(screen.queryByRole('button', { name: 'Pages' })).not.toBeInTheDocument()
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

describe('ViewSwitcher', () => {
  it('names the current page and lists the pages, each with its hint', async () => {
    const onChange = vi.fn()
    render(
      <ViewSwitcher
        label="Activity"
        current="grabs"
        onChange={onChange}
        views={[
          { value: 'grabs', label: 'Grabs', hint: '2' },
          { value: 'health', label: 'Health' },
        ]}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Activity: Grabs' }))
    expect(screen.getByRole('menuitemradio', { name: 'Grabs' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemradio', { name: 'Grabs' })).toHaveTextContent('2')
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Health' }))
    expect(onChange).toHaveBeenCalledWith('health')
  })
})
