import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay } from 'msw'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { http } from '../test/handlers'
import { fakeLibrary, row } from '../test/library'
import { server } from '../test/server'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

describe('the Title page', () => {
  it('announces loading once while the Title loads, outside the placeholders', async () => {
    fakeLibrary([row(1, 'Paddington', 'Paddington')])
    server.use(
      http.get('/titles/{id}', async () => {
        await delay('infinite')
        return undefined as never
      }),
    )
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const pane = await screen.findByRole('region', { name: /paddington/i })

    const status = within(pane).getAllByRole('status')
    expect(status).toHaveLength(1)
    expect(status[0]).toHaveTextContent('Loading')
    expect(status[0].children).toHaveLength(0)
  })

  it('lists the Versions as one card of rows, one per Slot', async () => {
    fakeLibrary([row(1, 'Paddington', 'Paddington')])
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
    const pane = await screen.findByRole('region', { name: /paddington/i })

    const versions = await within(pane).findByRole('list', { name: 'Versions' })
    expect(
      within(versions)
        .getAllByRole('listitem')
        .map((li) => li.getAttribute('aria-label')),
    ).toEqual(['Standard', '4K'])
  })
})
