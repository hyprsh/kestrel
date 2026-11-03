import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { fakeLibrary, row } from '../test/library'
import { fakeSeries } from '../test/series'
import { openTitleSubmenu } from '../test/titleHeader'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

async function openTitle(name: string) {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  const pane = await screen.findByRole('region', { name })
  await within(pane).findByRole('heading', { name })
  return openTitleSubmenu(pane, 'Open in')
}

const opensInNewTab = (link: HTMLElement) => {
  expect(link).toHaveAttribute('target', '_blank')
  expect(link).toHaveAttribute('rel', 'noopener noreferrer')
}

describe("a Title's ids, in the Title menu's Open in items", () => {
  it('link a Movie to TMDB and IMDb in a new tab, with no TheTVDB link', async () => {
    fakeLibrary([row(1, 'Heat', 'Heat')])
    const menu = await openTitle('Heat')

    const tmdb = within(menu).getByRole('menuitem', { name: /Open in TMDB/ })
    expect(tmdb).toHaveAttribute('href', 'https://www.themoviedb.org/movie/101')
    opensInNewTab(tmdb)
    const imdb = within(menu).getByRole('menuitem', { name: /Open in IMDb/ })
    expect(imdb).toHaveAttribute('href', 'https://www.imdb.com/title/tt000001/')
    opensInNewTab(imdb)
    expect(within(menu).queryByRole('menuitem', { name: /TVDB/ })).not.toBeInTheDocument()
  })

  it('link a Series to TMDB /tv/ and TheTVDB', async () => {
    fakeSeries()
    const menu = await openTitle('Breaking Bad')

    expect(within(menu).getByRole('menuitem', { name: /Open in TMDB/ })).toHaveAttribute('href', 'https://www.themoviedb.org/tv/105')
    const tvdb = within(menu).getByRole('menuitem', { name: /Open in TVDB/ })
    expect(tvdb).toHaveAttribute('href', 'https://thetvdb.com/dereferrer/series/81189')
    opensInNewTab(tvdb)
  })
})
