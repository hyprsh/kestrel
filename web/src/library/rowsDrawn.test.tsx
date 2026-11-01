import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TitleRows } from './TitleRows'
import type { TitleRow } from '../api/queries'

const row = (id: number): TitleRow =>
  ({
    id,
    title: `Title ${id}`,
    kind: 'movie',
    year: 2000,
    has_poster: false,
    monitored: true,
    size: 0,
    slot_states: [],
    slots: {},
    wanted_episodes: { wanted: 0, long_missing: 0, seasons: [] },
  }) as unknown as TitleRow

const rows = Array.from({ length: 150 }, (_, i) => row(i + 1))
const props = {
  loading: false,
  grabs: new Map(),
  now: Date.now(),
  selection: { count: 0 } as never,
  ticks: false,
  phone: false,
  listRef: { current: null },
  onPick: () => {},
}

describe('the Library list of many Titles', () => {
  it('draws the first rows at once and the rest while idle, so every Title ends up in the list', async () => {
    render(<TitleRows {...props} rows={rows} index={0} />)
    expect(screen.getAllByRole('option').length).toBeLessThan(150)
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(150))
  })

  it('draws the cursor row even before the slices reach it', () => {
    render(<TitleRows {...props} rows={rows} index={120} />)
    expect(document.getElementById('title-121')).not.toBeNull()
  })
})
