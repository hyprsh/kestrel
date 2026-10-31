import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SkeletonRows } from './loading'

describe('SkeletonRows', () => {
  it('announces a label once, hidden, where no heading names what loads', () => {
    render(<SkeletonRows count={2} label="Loading Requests" />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading Requests')
  })

  it('says nothing of its own under a heading that names what loads', () => {
    render(<SkeletonRows count={2} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
