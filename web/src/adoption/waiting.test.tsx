import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { server } from '../test/server'

type Adoption = components['schemas']['Adoption']

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

function planIs(state: Adoption['state'], needsChoice = 0) {
  server.use(
    http.get('/adoption', ({ response }) =>
      response(200).json({
        state,
        progress: { done: 0, total: 0 },
        summary: { matched: 3, needs_choice: needsChoice, skipped: 0, duplicate: 0, replacement: 0, adopting: 0 },
        revision: 2,
        error: null,
        scanned_at: null,
        monitor: 'all',
        result: null,
      }),
    ),
    http.get('/adoption/rows', ({ response }) =>
      response(200).json({ items: [], next_cursor: null, total: 0, counts: { matched: 0, needs_choice: 0, skipped: 0, duplicate: 0, replacement: 0, adopting: 0 } }),
    ),
  )
}

describe('A waiting Adoption plan', () => {
  it('is a Needs attention row that links to the Adoption screen', async () => {
    planIs('planned', 2)
    const user = userEvent.setup()
    renderApp()

    const section = await screen.findByRole('region', { name: /happening now/i })
    expect(await within(section).findByText('An Adoption plan is waiting for review (2 need a choice)')).toBeInTheDocument()
    await user.click(within(section).getByRole('button', { name: 'Review the Adoption plan' }))

    expect(await screen.findByRole('heading', { name: /adopt existing library/i })).toBeInTheDocument()
  })

  it('leaves out the count of choices when none is left', async () => {
    planIs('planned')
    renderApp()
    expect(await screen.findByText('An Adoption plan is waiting for review')).toBeInTheDocument()
  })

  it('says so while scanning', async () => {
    planIs('scanning')
    renderApp()
    expect(await screen.findByText('An Adoption scan is running')).toBeInTheDocument()
  })

  it('says so while committing', async () => {
    planIs('committing')
    renderApp()
    expect(await screen.findByText('An Adoption plan is being committed')).toBeInTheDocument()
  })

  it('is not in Needs attention when there is no plan', async () => {
    planIs('idle')
    renderApp()
    expect(await screen.findByText('Nothing needs attention and nothing is downloading.')).toBeInTheDocument()
    expect(screen.queryByText(/Adoption plan/)).not.toBeInTheDocument()
  })

  it('renames the Settings button and the command menu entry', async () => {
    planIs('planned', 1)
    const user = userEvent.setup()
    renderApp()
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    expect(await screen.findByRole('button', { name: 'Review the Adoption plan' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /scan for unmanaged files/i })).not.toBeInTheDocument()

    await user.keyboard('{Control>}k{/Control}')
    expect(await screen.findByText('Review the Adoption plan', { selector: '[role=option] *, [role=option]' })).toBeInTheDocument()
    expect(screen.queryByText('Scan for unmanaged files')).not.toBeInTheDocument()
  })

  it('keeps "Scan for unmanaged files" when no plan exists', async () => {
    planIs('idle')
    const user = userEvent.setup()
    renderApp()
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    expect(await screen.findByRole('button', { name: 'Scan for unmanaged files' })).toBeInTheDocument()
  })
})
