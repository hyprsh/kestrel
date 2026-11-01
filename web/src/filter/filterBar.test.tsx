import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { FilterBar } from './FilterBar'
import { kindQualifier } from './qualifiers'

function Bar({ start = '' }: { start?: string }) {
  const [q, setQ] = useState(start)
  return <FilterBar id="f" label="Filter things" value={q} onChange={setQ} qualifiers={[kindQualifier()]} menus={false} />
}

describe('FilterBar', () => {
  it('shows a Clear filter button only while the field has text, and clearing keeps focus in the field', async () => {
    render(<Bar />)
    const field = screen.getByRole('combobox', { name: 'Filter things' })
    expect(screen.queryByRole('button', { name: 'Clear filter' })).not.toBeInTheDocument()
    await userEvent.type(field, 'kind:movie alien')
    await userEvent.click(screen.getByRole('button', { name: 'Clear filter' }))
    expect(field).toHaveValue('')
    expect(field).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'Clear filter' })).not.toBeInTheDocument()
  })

  it('clears a field with text on Escape and stays in it', async () => {
    render(<Bar start="alien" />)
    const field = screen.getByRole('combobox', { name: 'Filter things' })
    field.focus()
    await userEvent.keyboard('{Escape}')
    expect(field).toHaveValue('')
    expect(field).toHaveFocus()
  })
})
