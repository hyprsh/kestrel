import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import { Poster } from './poster'
import { ProviderKeysForm } from './metadata/ProviderKeys'
import { Requests } from './requests/Requests'
import { displayDefaults, noDisplayDeclared } from './test/display'
import { http } from './test/handlers'
import { fakeLibrary, row } from './test/library'
import { request } from './test/requests'
import { server } from './test/server'

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
const renderApp = () => render(<App client={client()} />)
const inClient = (ui: ReactNode) => render(<QueryClientProvider client={client()}>{ui}</QueryClientProvider>)

/** A response that waits until `release` is called. */
function held() {
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  return { gate, release: () => act(async () => release()) }
}

describe('the Library while its Titles load', () => {
  it('shows Skeleton rows and no empty state, then the Titles', async () => {
    const titles = held()
    fakeLibrary([row(1, 'Paddington', 'Paddington'), row(2, 'Heat', 'Heat')])
    server.use(
      http.get('/titles', async ({ response }) => {
        await titles.gate
        return response(200).json({ items: [row(1, 'Paddington', 'Paddington'), row(2, 'Heat', 'Heat')], next_cursor: null })
      }),
    )
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))

    const list = await screen.findByRole('listbox', { name: /library/i })
    expect(list).toHaveAttribute('aria-busy', 'true')
    expect(within(list).queryAllByRole('option')).toHaveLength(0)
    expect(list.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0)
    expect(screen.queryByText('Nothing here yet')).not.toBeInTheDocument()
    expect(screen.queryByText('No Title matches.')).not.toBeInTheDocument()

    await titles.release()

    expect(await within(list).findByRole('option', { name: /paddington/i })).toBeInTheDocument()
    expect(list).not.toHaveAttribute('aria-busy')
  })
})

describe('the Overview while its sections load', () => {
  it('keeps the section headings, shows Skeleton rows and no empty line, then the rows', async () => {
    const queue = held()
    server.use(
      http.get('/queue', async ({ response }) => {
        await queue.gate
        return response(200).json({ items: [] })
      }),
    )
    renderApp()

    const section = await screen.findByRole('region', { name: /downloading now/i })
    expect(section.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    expect(within(section).queryByText('Nothing is downloading.')).not.toBeInTheDocument()

    await queue.release()

    expect(await within(section).findByText('Nothing is downloading.')).toBeInTheDocument()
    expect(section.querySelector('[aria-busy="true"]')).not.toBeInTheDocument()
  })

  it('shows no empty line in Coming this week or Recent requests before their data arrives', async () => {
    server.use(
      http.get('/upcoming', async ({ response }) => {
        await delay('infinite')
        return response(200).json({ from: '2026-10-01', to: '2026-10-07', items: [] })
      }),
      http.get('/requests', async ({ response }) => {
        await delay('infinite')
        return response(200).json({ items: [], next_cursor: null, total: 0 })
      }),
    )
    renderApp()

    const coming = await screen.findByRole('region', { name: /coming this week/i })
    const requests = await screen.findByRole('region', { name: /recent requests/i })
    expect(coming.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    expect(requests.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    expect(screen.queryByText('Nothing is due in the next 7 days.')).not.toBeInTheDocument()
    expect(screen.queryByText('Nobody has asked for anything yet.')).not.toBeInTheDocument()
  })
})

describe('Requests while they load', () => {
  it('shows Skeleton rows and no "No Request matches.", then the rows', async () => {
    const list = held()
    server.use(
      http.get('/requests', async ({ response }) => {
        await list.gate
        return response(200).json({ items: [request()], next_cursor: null, total: 1 })
      }),
    )
    inClient(<Requests query="" onQuery={() => {}} onOpenTitle={() => {}} />)

    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    expect(screen.queryByText('No Request matches.')).not.toBeInTheDocument()

    await list.release()

    expect(await screen.findByRole('list', { name: 'Requests' })).toBeInTheDocument()
    expect(document.querySelector('[aria-busy="true"]')).not.toBeInTheDocument()
  })
})

describe('a Settings section while its settings load', () => {
  it('shows label and control Skeletons, announced once, then the form', async () => {
    const settings = held()
    server.use(
      http.get('/settings', async ({ response }) => {
        await settings.gate
        return response(200).json({
          language_region: { primary_language: 'en', release_date_country: 'US' },
          root_folders: { movies: ['/m'], series: ['/s'] },
          check_github_updates: true,
          pause_grabs: false,
          display: displayDefaults,
          from_config_file: {
            display: { season_order: false, seasons_open: false, manual_search_sort: false, upcoming_filters: false },
            language_region: false,
            root_folders: false,
            check_github_updates: false,
          },
          trash: { auto_update: true },
          metadata: { tmdb_api_key_set: false, tvdb_api_key_set: false },
        })
      }),
    )
    inClient(<ProviderKeysForm />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    expect(screen.queryByLabelText('TMDB API key')).not.toBeInTheDocument()

    await settings.release()

    expect(await screen.findByLabelText('TMDB API key')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('a poster while its image loads', () => {
  it('holds a Skeleton in the frame until the load event, then shows the image', () => {
    const { container } = render(<Poster src="/p.jpg" alt="Paddington poster" size="md" />)
    const frame = container.querySelector('[data-poster]')!
    expect(frame).toHaveAttribute('data-loading')

    fireEvent.load(within(frame as HTMLElement).getByRole('img', { name: 'Paddington poster' }))

    expect(frame).not.toHaveAttribute('data-loading')
  })

  it('draws no Skeleton for a Title without a poster', () => {
    const { container } = render(<Poster src={null} size="md" />)
    expect(container.querySelector('[data-poster]')).not.toHaveAttribute('data-loading')
  })
})
