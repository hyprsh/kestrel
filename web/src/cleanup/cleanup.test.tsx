import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import type { components } from '../api/schema.gen'
import { http } from '../test/handlers'
import { server } from '../test/server'
import { fakeLibrary, row } from '../test/library'

type Preview = components['schemas']['CleanupPreview']
type Cat = components['schemas']['CleanupPreviewCategory']

const cat = (key: Cat['key'], default_ticked: boolean, names: string[]): Cat => ({
  key,
  default_ticked,
  count: names.length,
  size: names.length * 1024,
  files: names.map((n) => ({ path: `/data/media/movies/Paddington (2014)/${n}`, size: 1024, title_id: 1 })),
})

const preview: Preview = {
  preview_id: 'p1',
  categories: [cat('junk', true, ['a.nfo', 'b.txt']), cat('samples', true, []), cat('artwork', false, ['poster.jpg'])],
}

describe('Clean up', () => {
  it('lists categories with safe ones ticked, then deletes only what stays ticked after a confirm', async () => {
    const runs: unknown[] = []
    server.use(
      http.post('/cleanup/preview', ({ response }) => response(200).json(preview)),
      http.post('/cleanup/run', async ({ request, response }) => {
        runs.push(await request.clone().json())
        return response(202).json({ deleted: 1, bytes: 1024, failed: 0 })
      }),
    )
    const user = userEvent.setup()
    render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)
    await screen.findByRole('navigation')
    await user.keyboard('{Control>}k{/Control}')
    await user.click(await within(await screen.findByRole('dialog', { name: /command menu/i })).findByRole('option', { name: /clean up unmanaged files/i }))

    await user.click(await screen.findByRole('button', { name: /look for unmanaged files/i }))

    expect(await screen.findByLabelText(/^Junk/)).toBeChecked()
    expect(screen.getByLabelText('Local artwork')).not.toBeChecked()
    expect(screen.queryByLabelText('Samples')).not.toBeInTheDocument()

    await user.click(screen.getByLabelText('Delete b.txt'))
    await user.click(screen.getByRole('button', { name: /delete 1 item/i }))
    expect(runs).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Delete Files' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Deleted 1 file')
    expect(runs).toEqual([{ preview_id: 'p1', categories: ['junk', 'samples'], exclude: ['/data/media/movies/Paddington (2014)/b.txt'] }])
  })

  it('marks Look for Unmanaged files busy while the preview runs, so it cannot be pressed twice', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    let previews = 0
    server.use(
      http.post('/cleanup/preview', async ({ response }) => {
        previews++
        await gate
        return response(200).json(preview)
      }),
    )
    const user = userEvent.setup()
    render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)
    await screen.findByRole('navigation')
    await user.keyboard('{Control>}k{/Control}')
    await user.click(await within(await screen.findByRole('dialog', { name: /command menu/i })).findByRole('option', { name: /clean up unmanaged files/i }))

    const look = await screen.findByRole('button', { name: /look for unmanaged files/i })
    await user.click(look)
    expect(await screen.findByRole('button', { name: /look for unmanaged files/i })).toHaveAttribute('aria-busy', 'true')
    await user.click(screen.getByRole('button', { name: /look for unmanaged files/i }))
    release()
    expect(await screen.findByLabelText(/^Junk/)).toBeChecked()
    expect(previews).toBe(1)
  })

  it('opens from the Library menu for every Title and from a Title for that Title alone', async () => {
    const previews: unknown[] = []
    fakeLibrary([row(7, 'Paddington', 'Paddington'), row(8, 'Heat', 'Heat', { year: 1995 })])
    server.use(
      http.post('/cleanup/preview', async ({ request, response }) => {
        previews.push(await request.clone().json())
        return response(200).json(preview)
      }),
    )
    const user = userEvent.setup()
    render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)
    await user.click(await screen.findByRole('button', { name: 'Library' }))

    await user.click(await screen.findByRole('button', { name: 'Library actions' }))
    await user.click(screen.getByRole('menuitem', { name: /^Clean Up Unmanaged Files/ }))
    await user.click(await screen.findByRole('button', { name: /look for unmanaged files/i }))
    expect(previews).toEqual([{}])

    await user.click(screen.getByRole('button', { name: 'Library' }))
    await user.click(await screen.findByRole('button', { name: 'More Title actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Clean up this Title' }))
    await user.click(await screen.findByRole('button', { name: /look for unmanaged files/i }))
    expect(previews).toEqual([{}, { title_ids: [7] }])
  })
})
