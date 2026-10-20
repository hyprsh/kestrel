import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeLibrary, row } from '../test/library'
import { fakeSeries } from '../test/series'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

async function openTitle(name: string) {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  const pane = await screen.findByRole('region', { name })
  await within(pane).findByRole('heading', { name })
  return pane
}

const opensInNewTab = (link: HTMLElement) => {
  expect(link).toHaveAttribute('target', '_blank')
  expect(link).toHaveAttribute('rel', 'noopener noreferrer')
}

describe("a Title's ids", () => {
  it('link a Movie to TMDB and IMDb in a new tab, with no TheTVDB link', async () => {
    fakeLibrary([row(1, 'Heat', 'Heat')])
    const pane = await openTitle('Heat')

    const tmdb = within(pane).getByRole('link', { name: 'TMDB 101' })
    expect(tmdb).toHaveAttribute('href', 'https://www.themoviedb.org/movie/101')
    opensInNewTab(tmdb)
    const imdb = within(pane).getByRole('link', { name: 'tt000001' })
    expect(imdb).toHaveAttribute('href', 'https://www.imdb.com/title/tt000001/')
    opensInNewTab(imdb)
    expect(within(pane).queryByRole('link', { name: /TVDB/ })).not.toBeInTheDocument()
  })

  it('link a Series to TMDB /tv/ and TheTVDB', async () => {
    fakeSeries()
    const pane = await openTitle('Breaking Bad')

    expect(within(pane).getByRole('link', { name: 'TMDB 105' })).toHaveAttribute('href', 'https://www.themoviedb.org/tv/105')
    const tvdb = within(pane).getByRole('link', { name: 'TVDB 81189' })
    expect(tvdb).toHaveAttribute('href', 'https://thetvdb.com/dereferrer/series/81189')
    opensInNewTab(tvdb)
  })
})
