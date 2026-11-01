import { render, screen } from '@testing-library/react'
import { Suspense } from 'react'
import { describe, expect, it } from 'vitest'
import { lazyScreen } from './lazyScreen'

describe('a lazily loaded screen', () => {
  it('shows the fallback until its chunk has loaded, then the screen with its props', async () => {
    const { Screen } = lazyScreen(async () => ({ name }: { name: string }) => <p>Hello {name}</p>)
    render(
      <Suspense fallback={<p>Loading</p>}>
        <Screen name="Kestrel" />
      </Suspense>,
    )
    expect(screen.getByText('Loading')).toBeInTheDocument()
    expect(await screen.findByText('Hello Kestrel')).toBeInTheDocument()
  })

  it('renders at once, with no fallback, when it was preloaded', async () => {
    const { Screen, preload } = lazyScreen(async () => () => <p>Ready</p>)
    await preload()
    render(
      <Suspense fallback={<p>Loading</p>}>
        <Screen />
      </Suspense>,
    )
    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.queryByText('Loading')).not.toBeInTheDocument()
  })
})
