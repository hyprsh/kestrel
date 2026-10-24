import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FilterStrip } from './FilterStrip'
import { PageSurface } from './PageSurface'
import { PaneFooter, PaneHeader } from './Pane'
import { PhoneBackHeader } from './PhoneBackHeader'
import { SectionBlock } from './SectionBlock'
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
    expect(screen.getByRole('banner')).toHaveTextContent('Header text')
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

  it('WidePage holds its children', () => {
    render(
      <WidePage>
        <h1>Set up Kestrel</h1>
      </WidePage>,
    )
    expect(screen.getByRole('heading', { name: 'Set up Kestrel' })).toBeInTheDocument()
  })
})
