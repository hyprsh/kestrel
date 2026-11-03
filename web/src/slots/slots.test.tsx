// Settings, Slots & Profiles, Slots: add, rename, reorder and delete the Slots.
import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { App } from '../App'
import { row, type FixtureRow } from '../test/library'
import { fakeSlots, seededSlots, slot } from '../test/slots'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

beforeEach(() => {
  history.replaceState(null, '', '/settings/slots')
})

const section = async () => screen.findByRole('region', { name: 'Slots' })
const inSlot = async (label: string) => within(await within(await section()).findByRole('listitem', { name: label }))

const movie = (id: number, slots: FixtureRow['slots']): FixtureRow => row(id, `Movie ${id}`, `Movie ${id}`, { slots })
const version = (id: number, state: 'filled' | 'wanted' = 'filled') => ({ version_id: id, profile: 'hd-primary', state, long_missing: false })

describe('the Slots list', () => {
  it('lists every Slot in order with its defaults, its switch and the Versions it holds', async () => {
    const titles = [movie(1, { standard: version(11), '4k': version(12) }), movie(2, { standard: version(21), '4k': null })]
    fakeSlots({ titles })
    renderApp()

    const standard = await inSlot('Standard')
    expect(standard.getByText('Movies HD, Series HD')).toBeInTheDocument()
    expect(standard.getByRole('switch', { name: 'Standard on for new Titles' })).toBeChecked()
    expect(standard.getByText('2 Versions')).toBeInTheDocument()

    const fourK = await inSlot('4K')
    expect(fourK.getByText('Movies 4K, Series 4K')).toBeInTheDocument()
    expect(fourK.getByRole('switch', { name: '4K on for new Titles' })).not.toBeChecked()
    expect(fourK.getByText('1 Version')).toBeInTheDocument()

    const names = within(await section())
      .getAllByRole('listitem')
      .map((g) => g.getAttribute('aria-label'))
    expect(names).toEqual(['Standard', '4K'])
  })

  it('shows the warning when two Slots share a default Profile', async () => {
    fakeSlots({
      warnings: [{ code: 'shared_slot_default', kind: 'movies', profile: 'hd-primary', slots: ['standard', '4k'], message: 'Standard and 4K both default to HD for Movies' }],
    })
    renderApp()
    expect(await within(await section()).findByText('Standard and 4K both default to HD for Movies')).toBeInTheDocument()
  })

  it('is read-only and says so when the Config File declares the Slots', async () => {
    fakeSlots({ slots: seededSlots().map((s) => ({ ...s, from_config_file: true })) })
    renderApp()
    const sec = within(await section())
    expect(await sec.findByText(/The Config File sets the Slots/)).toBeInTheDocument()
    expect(sec.getByRole('button', { name: 'Add Slot…' })).toBeDisabled()
    expect(sec.getByRole('switch', { name: 'Standard on for new Titles' })).toBeDisabled()
  })

  it('disables Add at four Slots, with the reason', async () => {
    fakeSlots({ slots: [slot('a', 'A', 0), slot('b', 'B', 1), slot('c', 'C', 2), slot('d', 'D', 3)] })
    renderApp()
    await inSlot('A')
    const add = within(await section()).getByRole('button', { name: 'Add Slot…' })
    expect(add).toBeDisabled()
    expect(add).toHaveAttribute('title', 'A library has at most four Slots: remove one to add another')
  })

  it('changes the on-for-new-Titles switch at once', async () => {
    const sent = fakeSlots()
    renderApp()
    const fourK = await inSlot('4K')
    await userEvent.click(fourK.getByRole('switch', { name: '4K on for new Titles' }))
    await waitFor(() => expect(sent.at(-1)).toEqual({ path: 'PATCH /slots/4k', body: { on_for_new_titles: true } }))
  })
})

describe('adding a Slot', () => {
  it('previews the file name, saves the label, defaults and switch, and the Slot is listed', async () => {
    const sent = fakeSlots()
    renderApp()
    await userEvent.click(await within(await section()).findByRole('button', { name: 'Add Slot…' }))
    const form = within(await screen.findByRole('dialog', { name: 'Add Slot' }))

    await userEvent.type(form.getByLabelText('Label'), 'Remux')
    expect(form.getByText('… {tmdb-693134} - [Remux][Bluray-1080p]…')).toBeInTheDocument()
    await userEvent.selectOptions(form.getByLabelText('Default for Movies'), 'any-primary')
    await userEvent.selectOptions(form.getByLabelText('Default for Series'), 'any-primary')
    await userEvent.click(form.getByRole('switch', { name: 'On for new Titles' }))
    await userEvent.click(form.getByRole('button', { name: 'Add Slot' }))

    await waitFor(() => expect(sent.at(-1)).toEqual({ path: 'POST /slots', body: { label: 'Remux', default_movies: 'any-primary', default_series: 'any-primary', on_for_new_titles: true } }))
    expect(await inSlot('Remux')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Add Slot' })).not.toBeInTheDocument()
  })

  it('takes the preview’s sample quality from the resolution of the default Profile', async () => {
    fakeSlots()
    renderApp()
    await userEvent.click(await within(await section()).findByRole('button', { name: 'Add Slot…' }))
    const form = within(await screen.findByRole('dialog', { name: 'Add Slot' }))
    await userEvent.type(form.getByLabelText('Label'), 'Original')

    await userEvent.selectOptions(form.getByLabelText('Default for Movies'), '4k-primary')
    expect(form.getByText('… {tmdb-693134} - [Original][Bluray-2160p]…')).toBeInTheDocument()
    await userEvent.selectOptions(form.getByLabelText('Default for Movies'), 'hd-primary')
    expect(form.getByText('… {tmdb-693134} - [Original][Bluray-1080p]…')).toBeInTheDocument()
    // With no default for Movies, the Series default speaks.
    await userEvent.selectOptions(form.getByLabelText('Default for Movies'), '')
    await userEvent.selectOptions(form.getByLabelText('Default for Series'), '4k-primary')
    expect(form.getByText('… {tmdb-693134} - [Original][Bluray-2160p]…')).toBeInTheDocument()
  })

  it('shows a broken rule inline on the label, with the form kept open', async () => {
    fakeSlots()
    renderApp()
    await userEvent.click(await within(await section()).findByRole('button', { name: 'Add Slot…' }))
    const form = within(await screen.findByRole('dialog', { name: 'Add Slot' }))
    await userEvent.type(form.getByLabelText('Label'), 'standard')
    await userEvent.click(form.getByRole('button', { name: 'Add Slot' }))
    expect(await form.findByText('is already a Slot')).toBeInTheDocument()
    expect(screen.queryByText(/Could not/)).not.toBeInTheDocument() // an inline error, not a Toast
  })

  it('adds Versions to the existing Titles only when asked, with the counts', async () => {
    const titles = [
      movie(1, { standard: version(11), '4k': null }),
      movie(2, { standard: version(21), '4k': null }),
      { ...row(3, 'Show', 'Show', { slots: { standard: version(31), '4k': null } }), kind: 'series' as const },
    ]
    const sent = fakeSlots({ titles })
    renderApp()
    await userEvent.click(await within(await section()).findByRole('button', { name: 'Add Slot…' }))
    const form = within(await screen.findByRole('dialog', { name: 'Add Slot' }))
    const also = form.getByRole('checkbox', { name: 'Also add to existing Movies (2) / Series (1)' })
    expect(also).not.toBeChecked()

    await userEvent.type(form.getByLabelText('Label'), 'Remux')
    await userEvent.selectOptions(form.getByLabelText('Default for Movies'), 'any-primary')
    await userEvent.selectOptions(form.getByLabelText('Default for Series'), 'hd-primary')
    await userEvent.click(also)
    await userEvent.click(form.getByRole('button', { name: 'Add Slot' }))

    await waitFor(() => expect(sent.map((s) => s.path)).toEqual(['POST /slots', 'bulk add_version', 'bulk add_version']))
    expect(sent[1].body).toEqual({ action: 'add_version', title_ids: [1, 2], slot: 'remux', profile: 'any-primary' })
    expect(sent[2].body).toEqual({ action: 'add_version', title_ids: [3], slot: 'remux', profile: 'hd-primary' })
  })
})

describe('renaming a Slot', () => {
  it('says how many files it renames before saving', async () => {
    const sent = fakeSlots({ files: 12 })
    renderApp()
    await userEvent.click((await inSlot('4K')).getByRole('button', { name: '4K actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit…' }))
    const form = within(await screen.findByRole('dialog', { name: 'Edit Slot' }))

    await userEvent.clear(form.getByLabelText('Label'))
    await userEvent.type(form.getByLabelText('Label'), 'UHD')
    expect(await form.findByText('Renames 12 files')).toBeInTheDocument()
    expect(sent.filter((s) => s.path === 'PATCH /slots/4k?dry_run=true').length).toBeGreaterThan(0)
    expect(sent.some((s) => s.path === 'PATCH /slots/4k')).toBe(false)

    await userEvent.click(form.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent.at(-1)).toEqual({ path: 'PATCH /slots/4k', body: { label: 'UHD' } }))
    expect(await inSlot('UHD')).toBeTruthy()
  })

  it('shows a label that is taken as an inline error', async () => {
    fakeSlots()
    renderApp()
    await userEvent.click((await inSlot('4K')).getByRole('button', { name: '4K actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit…' }))
    const form = within(await screen.findByRole('dialog', { name: 'Edit Slot' }))
    await userEvent.clear(form.getByLabelText('Label'))
    await userEvent.type(form.getByLabelText('Label'), 'standard')
    expect(await form.findByText('is already a Slot')).toBeInTheDocument()
  })
})

describe('reordering the Slots', () => {
  it('moves a Slot with Alt and the arrow keys on its handle and keeps the order after a reload', async () => {
    const sent = fakeSlots()
    const { unmount } = renderApp()
    const handle = (await inSlot('4K')).getByRole('button', { name: 'Move 4K' })
    handle.focus()
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}')
    await waitFor(() => expect(sent.at(-1)).toEqual({ path: 'PATCH /slots/4k', body: { position: 0 } }))

    unmount()
    history.replaceState(null, '', '/settings/slots')
    renderApp()
    await inSlot('4K')
    expect(
      within(await section())
        .getAllByRole('listitem')
        .map((g) => g.getAttribute('aria-label')),
    ).toEqual(['4K', 'Standard'])
  })
})

describe('deleting a Slot', () => {
  it('deletes an empty Slot after a confirmation', async () => {
    const sent = fakeSlots()
    renderApp()
    await userEvent.click((await inSlot('4K')).getByRole('button', { name: '4K actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete…' }))
    const dialog = within(await screen.findByRole('alertdialog'))
    await userEvent.click(dialog.getByRole('button', { name: 'Delete Slot' }))
    await waitFor(() => expect(sent.at(-1)).toEqual({ path: 'DELETE /slots/4k' }))
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Slots' })).queryByRole('listitem', { name: '4K' })).not.toBeInTheDocument())
  })

  it('shows the file counts for a Slot that holds Versions and deletes them first once the label is typed', async () => {
    const titles = [movie(1, { standard: version(11), '4k': version(12) }), movie(2, { standard: version(21), '4k': version(22, 'wanted') })]
    const sent = fakeSlots({ titles })
    renderApp()
    await userEvent.click((await inSlot('4K')).getByRole('button', { name: '4K actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete…' }))
    const dialog = within(await screen.findByRole('alertdialog'))
    expect(dialog.getByText(/2 Versions, 1 with a file/)).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: 'Delete Slot' })).toBeDisabled()
    await userEvent.type(dialog.getByRole('textbox'), '4K')
    await userEvent.click(dialog.getByRole('button', { name: 'Delete Slot' }))
    await waitFor(() => expect(sent.map((s) => s.path)).toEqual(['bulk remove_version', 'DELETE /slots/4k']))
    expect(sent[0].body).toEqual({ action: 'remove_version', title_ids: [1, 2], slot: '4k', delete_files: true })
  })

  it('is disabled for the last Slot, with the reason', async () => {
    fakeSlots({ slots: [slot('standard', 'Standard', 0)] })
    renderApp()
    await userEvent.click((await inSlot('Standard')).getByRole('button', { name: 'Standard actions' }))
    const item = await screen.findByRole('menuitem', { name: /Delete…/ })
    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(within(item).getByText('A library needs at least one Slot')).toBeInTheDocument()
  })

  it('is disabled for the last Slot that is on for new Titles', async () => {
    fakeSlots()
    renderApp()
    await userEvent.click((await inSlot('Standard')).getByRole('button', { name: 'Standard actions' }))
    const item = await screen.findByRole('menuitem', { name: /Delete…/ })
    expect(within(item).getByText('At least one Slot must be on for new Titles')).toBeInTheDocument()
  })
})
