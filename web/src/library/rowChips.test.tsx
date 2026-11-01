// The Library list draws a chip per entry of `slot_states`, in order: up to four and "+N" for the rest (a fake third, fourth and
// fifth Slot stand in for #282), and in a Library where no Title has a second Slot the chips say the state alone.
import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import type { TitleRow } from '../api/queries'
import { fakeLibrary, row } from '../test/library'

const renderApp = () => render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />)

async function openLibrary() {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Library' }))
  return screen.findByRole('listbox', { name: /library/i })
}

type Entry = TitleRow['slot_states'][number]
// The generated types know two Slots; the fake others come through a cast.
const entry = (slot: string, label: string, state: string, over: Partial<Entry> = {}): Entry =>
  ({ slot, label, version_id: Math.floor(Math.random() * 1e6), profile: 'hd-primary', state, long_missing: false, upgrade_wanted: false, ...over }) as unknown as Entry

describe('Library rows: Slot chips', () => {
  it('draws a chip per Slot in order, four and then "+N" with the rest in a popover', async () => {
    fakeLibrary([
      row(1, 'Breaking Bad', 'Breaking Bad', {
        kind: 'series',
        slot_states: [
          entry('standard', 'Standard', 'wanted', { episodes_have: 56, episodes_aired: 62 }),
          entry('4k', '4K', 'downloading', { episodes_have: 48, episodes_aired: 62 }),
          entry('german', 'German', 'filled', { episodes_have: 62, episodes_aired: 62 }),
          entry('remux', 'Remux', 'wanted', { long_missing: true, episodes_have: 40, episodes_aired: 62 }),
          entry('anime', 'Anime', 'unreleased'),
          entry('kids', 'Kids', 'filled'),
        ],
      }),
      row(2, 'Heat', 'Heat'),
    ])
    const list = await openLibrary()
    const bb = await within(list).findByRole('option', { name: /breaking bad/i })
    const chips = Array.from(bb.querySelectorAll('[data-slot]'))
    expect(chips.map((c) => c.getAttribute('data-slot'))).toEqual(['standard', '4k', 'german', 'remux'])
    expect(chips.map((c) => c.getAttribute('data-state'))).toEqual(['wanted', 'downloading', 'filled', 'long_missing'])
    expect(within(bb).getByRole('button', { name: /^Standard: Wanted/ })).toHaveTextContent('STD56/62')
    expect(within(bb).getByRole('button', { name: /^Remux: Long Missing/ })).toBeInTheDocument()
    const more = within(bb).getByRole('button', { name: '2 more Slots' })
    expect(more).toHaveTextContent('+2')
    await userEvent.click(more)
    const popover = await screen.findByRole('dialog', { name: '2 more Slots' })
    expect(popover).toHaveTextContent('Anime')
    expect(popover).toHaveTextContent('Kids')
  })

  it('names the Slot in every chip while any Title has a second one', async () => {
    fakeLibrary([row(1, 'Heat', 'Heat'), row(2, 'Zodiac', 'Zodiac', { slot_states: [entry('standard', 'Standard', 'filled'), entry('4k', '4K', 'filled')] })])
    const list = await openLibrary()
    const heat = await within(list).findByRole('option', { name: /heat/i })
    expect(within(heat).getByRole('button', { name: 'Standard: Wanted' })).toHaveTextContent('STD')
  })

  it('drops the Slot name when every Title has one Slot, and says the state alone', async () => {
    fakeLibrary([
      row(1, 'Heat', 'Heat'),
      row(2, 'Zodiac', 'Zodiac', { slot_states: [entry('standard', 'Standard', 'filled')] }),
      row(3, 'Mike', 'Mike', { kind: 'series', slot_states: [entry('standard', 'Standard', 'wanted', { episodes_have: 5, episodes_aired: 8 })] }),
    ])
    const list = await openLibrary()
    const chip = async (title: RegExp, name: string) => within(await within(list).findByRole('option', { name: title })).getByRole('button', { name })
    expect(await chip(/heat/i, 'Standard: Wanted')).toHaveTextContent(/^Wanted$/)
    expect(await chip(/zodiac/i, 'Standard: Have')).toHaveTextContent(/^Have$/)
    expect(await chip(/mike/i, /^Standard: Wanted/ as unknown as string)).toHaveTextContent(/^5\/8$/)
  })

  it('narrows by a Slot that only some Titles have through slot:', async () => {
    fakeLibrary([row(1, 'Heat', 'Heat'), row(2, 'Zodiac', 'Zodiac', { slot_states: [entry('standard', 'Standard', 'filled'), entry('german', 'German', 'wanted')] })])
    const list = await openLibrary()
    await within(list).findAllByRole('option')
    await userEvent.type(screen.getByRole('combobox', { name: 'Filter the Library' }), 'slot:german')
    expect(within(list).getAllByRole('option')).toHaveLength(1)
    expect(within(list).getByRole('option')).toHaveTextContent('Zodiac')
  })

  it('draws Upgrade wanted as its own dot and says how many episodes are below the cutoff', async () => {
    fakeLibrary([
      row(1, 'Andor', 'Andor', { kind: 'series', slot_states: [entry('standard', 'Standard', 'filled', { upgrade_wanted: true, episodes_upgrade: 3, episodes_have: 24, episodes_aired: 24 })] }),
      row(2, 'Heat', 'Heat', { slot_states: [entry('standard', 'Standard', 'filled', { upgrade_wanted: true })] }),
    ])
    const list = await openLibrary()
    const andor = await within(list).findByRole('option', { name: /andor/i })
    expect(andor.querySelector('[data-state-line]')).toHaveTextContent('Upgrade wanted · 3 episodes below cutoff')
    expect(within(andor).getByRole('button', { name: /^Standard: Upgrade wanted/ })).toHaveAttribute('data-state', 'upgrade')
    const heat = within(list).getByRole('option', { name: /heat/i })
    expect(heat.querySelector('[data-state-line]')).toHaveTextContent('Upgrade wanted · below cutoff')
  })

  it('opens a popover with what the Slot holds, and its Open link opens the Title at that Slot', async () => {
    fakeLibrary([
      row(1, 'Paddington', 'Paddington', {
        slots: {
          standard: { version_id: 11, profile: 'hd-primary', state: 'filled', long_missing: false },
          '4k': { version_id: 12, profile: '4k-primary', state: 'wanted', long_missing: false },
        },
        slot_states: [
          entry('standard', 'Standard', 'filled'),
          entry('4k', '4K', 'wanted', {
            wanted_since: new Date(Date.now() - 12 * 86_400_000).toISOString(),
            next_search_at: new Date(Date.now() + 4 * 3_600_000).toISOString(),
            profile: '4k-primary',
          }),
        ],
      }),
      row(2, 'Heat', 'Heat', {
        slot_states: [
          entry('standard', 'Standard', 'filled', {
            file: { quality: 'Bluray-1080p', video_codec: 'H.265', hdr: 'HDR10', audio_codec: 'DDP', audio_channels: '5.1', size: 18 * 1024 ** 3 } as Entry['file'],
          }),
          entry('4k', '4K', 'unmonitored'),
        ],
      }),
    ])
    const list = await openLibrary()
    const pad = await within(list).findByRole('option', { name: /paddington/i })
    await userEvent.click(within(pad).getByRole('button', { name: /^4K: Wanted/ }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/^4K \u00b7 /)
    expect(dialog).toHaveTextContent('Wanted 12 days \u00b7 next search in 4 h')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(location.search).toContain('slot=4k'))
    // The Title page marks the Version it was opened at.
    expect(await screen.findByRole('region', { name: 'Versions' })).toBeInTheDocument()
    await waitFor(() => expect(document.getElementById('version-4k')).toHaveAttribute('data-current'))

    await userEvent.click(within(within(list).getByRole('option', { name: /heat/i })).getByRole('button', { name: /^Standard: Have/ }))
    const file = await screen.findByRole('dialog')
    expect(file).toHaveTextContent('Bluray-1080p \u00b7 H.265 \u00b7 HDR10 \u00b7 DDP 5.1 \u00b7 18.0 GB')
  })

  it('lists the folded Slots as links to the Title at that Slot', async () => {
    fakeLibrary([
      row(1, 'Breaking Bad', 'Breaking Bad', {
        slot_states: ['standard', '4k', 'german', 'remux', 'anime'].map((k) => entry(k, k.toUpperCase(), 'filled')),
      }),
    ])
    const list = await openLibrary()
    await userEvent.click(await within(list).findByRole('button', { name: '1 more Slots' }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: '1 more Slots' })).getByRole('button', { name: /ANIME/ }))
    await waitFor(() => expect(location.search).toContain('slot=anime'))
  })
})
