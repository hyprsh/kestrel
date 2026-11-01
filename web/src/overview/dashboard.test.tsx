import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Overview } from './Overview'
import { fakeStats } from '../test/stats'
import { emptyStats, grabDays, stats } from '../test/statsData'

const renderOverview = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Overview />
    </QueryClientProvider>,
  )

const phone = () => vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }))

afterEach(() => vi.unstubAllGlobals())

describe('the headline figures', () => {
  it('shows Library, Wanted, Grabs, Time to fill and Free space from the statistics', async () => {
    fakeStats()
    renderOverview()

    const library = await screen.findByRole('group', { name: 'Library' })
    expect(library).toHaveTextContent('6 Titles')
    expect(library).toHaveTextContent('440 GB · 2 Movies · 3 Series')

    const wanted = screen.getByRole('group', { name: 'Wanted' })
    expect(wanted).toHaveTextContent('9')
    expect(wanted).toHaveTextContent('1 Long Missing')

    const grabs = screen.getByRole('group', { name: 'Grabs · 30 d' })
    expect(grabs).toHaveTextContent(/\d+% imported · 1 failed/)

    const fill = screen.getByRole('group', { name: 'Time to fill' })
    expect(fill).toHaveTextContent('2 h 14 min')
    expect(fill).toHaveTextContent('Median, Wanted to Imported · 58 min faster')

    const free = screen.getByRole('group', { name: 'Free space' })
    expect(free).toHaveTextContent('1.7 TB')
    expect(free).toHaveTextContent('72% of 6 TB used · full in ~9 months')
    expect(within(free).getByRole('progressbar', { name: '72% of the disks used' })).toBeInTheDocument()
  })

  it('leaves out the full-in estimate and the delta when they cannot be worked out', async () => {
    fakeStats(() => stats({ storage: { ...stats().storage, months_until_full: null, growth_bytes_per_week: null }, time_to_fill: { median_seconds: 600, previous_median_seconds: null, fills: 2 } }))
    renderOverview()

    const free = await screen.findByRole('group', { name: 'Free space' })
    expect(free).not.toHaveTextContent('full in')
    expect(screen.getByRole('group', { name: 'Time to fill' })).toHaveTextContent(/^Time to fill10 minMedian, Wanted to Imported$/)
  })

  it('shows plain zeros and dashes on a fresh install', async () => {
    fakeStats((r) => emptyStats(r))
    renderOverview()

    expect(await screen.findByRole('group', { name: 'Library' })).toHaveTextContent('0 TitlesB · 0 Movies · 0 Series'.replace('B · ', '0 B · '))
    expect(screen.getByRole('group', { name: 'Wanted' })).toHaveTextContent('0 Long Missing')
    expect(screen.getByRole('group', { name: 'Grabs · 30 d' })).toHaveTextContent('None finished')
    expect(screen.getByRole('group', { name: 'Time to fill' })).toHaveTextContent('Nothing filled yet')
    expect(screen.getByRole('group', { name: 'Free space' })).toHaveTextContent('No Root folder to read')
  })
})

describe('the range', () => {
  it('asks for 30 days at first and refetches every chart and figure for the range chosen', async () => {
    const asked = fakeStats((range) => {
      const days = { '7d': 7, '30d': 30, '90d': 90 }[range]
      return stats({ range, grabs: { imported: days, failed: 0, per_day: grabDays(days, Array(days).fill(1)) } })
    })
    renderOverview()

    const select = await screen.findByRole('combobox', { name: 'Range' })
    expect(select).toHaveValue('30d')
    expect(await screen.findByRole('group', { name: 'Grabs · 30 d' })).toHaveTextContent('30')
    expect(screen.getByRole('group', { name: /^Grabs per day over the last 30 days: 30 imported/ })).toBeInTheDocument()

    await userEvent.selectOptions(select, 'Last 7 days')

    expect(await screen.findByRole('group', { name: 'Grabs · 7 d' })).toHaveTextContent('7')
    expect(screen.getByRole('group', { name: /^Grabs per day over the last 7 days: 7 imported/ })).toBeInTheDocument()
    expect(asked).toEqual(['30d', '7d'])

    await userEvent.selectOptions(select, 'Last 90 days')
    await waitFor(() => expect(asked).toEqual(['30d', '7d', '90d']))
    expect(await screen.findByRole('group', { name: /^Grabs per day over the last 90 days: 90 imported/ })).toBeInTheDocument()
  })

  it('offers 7, 30 and 90 days', async () => {
    fakeStats()
    renderOverview()
    const select = await screen.findByRole('combobox', { name: 'Range' })
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Last 7 days', 'Last 30 days', 'Last 90 days'])
  })
})

describe('Grabs per day', () => {
  it('has a legend with totals, a summary, a column and a table row per day, and a tooltip on hover', async () => {
    const s = stats()
    fakeStats(() => s)
    renderOverview()

    const card = await screen.findByRole('region', { name: 'Grabs per day' })
    expect(card).toHaveTextContent(`Imported${s.grabs.imported}`)
    expect(card).toHaveTextContent('Failed1')

    const chart = within(card).getByRole('group', { name: /^Grabs per day over the last 30 days/ })
    const columns = within(chart).getAllByRole('button')
    expect(columns).toHaveLength(30)
    const busiest = within(chart).getByRole('button', { name: /: 7 imported, 1 failed$/ })

    const table = within(card).getByRole('table', { name: 'Grabs per day' })
    expect(within(table).getAllByRole('row')).toHaveLength(31)

    await userEvent.hover(busiest)
    const tip = within(card).getByRole('tooltip')
    expect(tip).toHaveTextContent('7imported')
    expect(tip).toHaveTextContent('1failed')
  })

  it('shows the same tooltip for a column reached with the keyboard', async () => {
    fakeStats()
    renderOverview()
    const card = await screen.findByRole('region', { name: 'Grabs per day' })
    const columns = within(card).getAllByRole('button')

    act(() => columns[columns.length - 1].focus())
    expect(within(card).getByRole('tooltip')).toBeInTheDocument()
    await userEvent.keyboard('{ArrowLeft}')
    expect(columns[columns.length - 2]).toHaveFocus()
  })

  it('says what stands out, and leaves the sentence out when the data is thin', async () => {
    fakeStats()
    renderOverview()
    const card = await screen.findByRole('region', { name: 'Grabs per day' })
    expect(card).toHaveTextContent(/Busiest: .+, 8 Grabs\. Failures cluster on altHUB\./)
  })

  it('has no sentence for a quiet month', async () => {
    fakeStats(() => stats({ grabs: { imported: 3, failed: 0, per_day: grabDays(30, [1, 1, 1]) }, indexers: stats().indexers.map((i) => ({ ...i, failed: 0 })) }))
    renderOverview()
    const card = await screen.findByRole('region', { name: 'Grabs per day' })
    expect(card).not.toHaveTextContent('Busiest')
    expect(card).not.toHaveTextContent('Failures cluster')
  })

  it('says so when no Grab finished', async () => {
    fakeStats((r) => emptyStats(r))
    renderOverview()
    expect(await screen.findByText('No Grabs finished in this range.')).toBeInTheDocument()
  })
})

describe('Indexers', () => {
  it('lists each indexer with its imported bar, Hit, Answer and Failed, and badges the best one', async () => {
    fakeStats()
    renderOverview()

    const card = await screen.findByRole('region', { name: 'Indexers' })
    expect(card).toHaveTextContent('Best: NZBgeek')
    const geek = within(card).getByRole('group', { name: /^NZBgeek: 34 imported, 1 failed/ })
    expect(geek).toHaveTextContent('81%')
    expect(geek).toHaveTextContent('0.6 s')
    const hub = within(card).getByRole('group', { name: /^altHUB: 9 imported, 4 failed. Hit 52% of 30 searches, median answer 2.4 s/ })
    expect(hub).toHaveTextContent('2.4 s')
    expect(within(card).getByRole('table', { name: 'Indexers' })).toHaveTextContent('NZBgeek')
  })

  it('has no Best badge when none qualifies, and a dash where nothing was answered', async () => {
    fakeStats(() => stats({ best_indexer_id: null, indexers: [{ id: 1, name: 'Fresh', imported: 2, failed: 0, searches: 0, hit_rate: null, median_answer_ms: null }] }))
    renderOverview()
    const card = await screen.findByRole('region', { name: 'Indexers' })
    expect(card).not.toHaveTextContent('Best:')
    expect(within(card).getByRole('group', { name: /^Fresh: 2 imported/ })).toHaveTextContent('—')
    expect(card).toHaveTextContent('Hit and Answer fill in as searches run.')
  })

  it('says so with no indexer activity', async () => {
    fakeStats((r) => emptyStats(r))
    renderOverview()
    expect(await screen.findByText('No indexer was asked or grabbed from in this range.')).toBeInTheDocument()
  })
})

describe('the download client', () => {
  it('shows its name, state, figures and a 14-day speed chart with a summary and a table', async () => {
    fakeStats()
    renderOverview()

    const card = await screen.findByRole('region', { name: 'Download client' })
    expect(card).toHaveTextContent('SABnzbd')
    expect(card).toHaveTextContent('Connected · 29 MB/s now')
    expect(card).toHaveTextContent('24 MB/saverage speed')
    expect(card).toHaveTextContent('9 minmedian download')
    expect(card).toHaveTextContent('64completed')
    expect(card).toHaveTextContent('4failed in the client')
    const chart = within(card).getByRole('group', { name: 'Average speed per day, last 14 days, between 12 MB/s and 31 MB/s' })
    expect(within(chart).getAllByRole('button')).toHaveLength(14)
    expect(within(card).getByRole('table', { name: 'Average speed per day, last 14 days' })).toBeInTheDocument()
  })

  it('says when no client is enabled', async () => {
    fakeStats((r) => emptyStats(r))
    renderOverview()
    const card = await screen.findByRole('region', { name: 'Download client' })
    expect(card).toHaveTextContent('No download client is enabled.')
  })

  it('shows a client that cannot be reached as not connecting', async () => {
    fakeStats(() => stats({ download_client: { ...stats().download_client, state: 'failing' } }))
    renderOverview()
    expect(await screen.findByText('Not connecting')).toBeInTheDocument()
  })
})

describe('Library quality, Storage, release groups and Requests', () => {
  it('draws one bar per Slot with its shares, a legend and a table', async () => {
    fakeStats()
    renderOverview()

    const card = await screen.findByRole('region', { name: 'Library quality' })
    expect(card).toHaveTextContent('Standard')
    expect(card).toHaveTextContent('100 files')
    expect(within(card).getByRole('group', { name: 'Standard: 22% Remux or BluRay, 64% WEB-DL, 14% WEBRip or lower' })).toBeInTheDocument()
    expect(within(card).getByRole('group', { name: '4K: 17% Remux or BluRay, 80% WEB-DL, 3% WEBRip or lower' })).toBeInTheDocument()
    expect(card).toHaveTextContent('Remux / BluRayWEB-DLWEBRip / lower')
    expect(card).toHaveTextContent("12 files below their Profile's cutoff: Upgrades wanted.")
    expect(within(card).getByRole('table', { name: 'Library quality' })).toBeInTheDocument()
  })

  it('leaves the cutoff line out when no file is below its Profile’s cutoff, and says 1 file for one', async () => {
    fakeStats(() => stats({ below_cutoff: 0 }))
    const { unmount } = renderOverview()
    const card = await screen.findByRole('region', { name: 'Library quality' })
    expect(card).not.toHaveTextContent('cutoff')
    unmount()
    fakeStats(() => stats({ below_cutoff: 1 }))
    renderOverview()
    expect(await screen.findByText("1 file below their Profile's cutoff: Upgrades wanted.")).toBeInTheDocument()
  })

  it('shows a bar per Root folder and the growth line', async () => {
    fakeStats()
    renderOverview()

    const card = await screen.findByRole('region', { name: 'Storage' })
    expect(card).toHaveTextContent('/media/tv')
    expect(card).toHaveTextContent('1.1 TB free of 4 TB')
    expect(within(card).getByRole('progressbar', { name: '/media/movies: 69% used' })).toBeInTheDocument()
    expect(card).toHaveTextContent('Growing ~45 GB a week · Series take 82%')
  })

  it('leaves the growth out when no file came in', async () => {
    fakeStats(() => stats({ storage: { ...stats().storage, growth_bytes_per_week: null, series_share: null, months_until_full: null } }))
    renderOverview()
    const card = await screen.findByRole('region', { name: 'Storage' })
    expect(card).not.toHaveTextContent('Growing')
  })

  it('ranks the release groups', async () => {
    fakeStats()
    renderOverview()
    const card = await screen.findByRole('region', { name: 'Top release groups' })
    expect(within(card).getByRole('group', { name: 'NTb: 18 files imported' })).toBeInTheDocument()
    expect(within(card).getByRole('group', { name: 'DON: 4 files imported' })).toBeInTheDocument()
    expect(within(card).getByRole('table', { name: 'Top release groups' })).toHaveTextContent('FLUX')
  })

  it('counts the Requests, how fast they were filled and who asked', async () => {
    fakeStats()
    renderOverview()
    const card = await screen.findByRole('region', { name: 'Requests' })
    expect(card).toHaveTextContent('14this month')
    expect(card).toHaveTextContent('1 d 4 hmedian to fulfil')
    expect(card).toHaveTextContent('2still searching')
    expect(card).toHaveTextContent('Ellie (Plex)')
    expect(card).toHaveTextContent('9 requests · 8 done')
  })

  it('says so when there is nothing to chart', async () => {
    fakeStats((r) => emptyStats(r))
    renderOverview()
    expect(await screen.findByText('No files in the Library yet.')).toBeInTheDocument()
    expect(screen.getByText('No Root folder could be read.')).toBeInTheDocument()
    expect(screen.getByText('No files were imported in this range.')).toBeInTheDocument()
    expect(screen.getByText('Nobody asked for anything in this range.')).toBeInTheDocument()
  })
})

describe('on a phone', () => {
  it('shows four figures, the Grabs chart, Indexers with three columns and the client on one line', async () => {
    phone()
    fakeStats()
    renderOverview()

    expect(await screen.findByRole('group', { name: 'Wanted' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Library' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Grabs per day' })).toBeInTheDocument()
    const ix = screen.getByRole('region', { name: 'Indexers' })
    expect(within(ix).getByRole('group', { name: /^NZBgeek/ })).toHaveTextContent('81%')
    expect(within(ix).getByRole('group', { name: /^NZBgeek/ })).not.toHaveTextContent('0.6 s')
    expect(screen.getByRole('region', { name: 'Download client' })).toHaveTextContent('24 MB/s average · 9 min median · 64 completed · 4 failed')
    expect(screen.queryByRole('region', { name: 'Storage' })).not.toBeInTheDocument()
  })
})
