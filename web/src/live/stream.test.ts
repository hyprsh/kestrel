import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { startLiveStream, type LiveDeps } from './stream'

class FakeSource {
  static all: FakeSource[] = []
  closed = false
  onopen: (() => void) | null = null
  private listeners = new Map<string, ((e: MessageEvent<string>) => void)[]>()
  constructor(public url: string) {
    FakeSource.all.push(this)
  }
  addEventListener(name: string, f: (e: MessageEvent<string>) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), f])
  }
  close() {
    this.closed = true
  }
  emit(name: string, data: unknown) {
    for (const f of this.listeners.get(name) ?? []) f({ data: JSON.stringify(data) } as MessageEvent<string>)
  }
}

/** A browser: Web Locks that queue exclusive requests and a BroadcastChannel shared by all tabs. */
function fakeBrowser() {
  FakeSource.all = []
  const channels = new Set<FakeChannel>()
  class FakeChannel {
    onmessage: ((e: MessageEvent) => void) | null = null
    constructor(public name: string) {
      channels.add(this)
    }
    postMessage(data: unknown) {
      for (const c of channels) if (c !== this && c.name === this.name) queueMicrotask(() => c.onmessage?.({ data } as MessageEvent))
    }
    close() {
      channels.delete(this)
    }
  }
  let held = false
  const waiting: (() => void)[] = []
  const locks = {
    async request(_name: string, cb: () => Promise<void>) {
      if (held) await new Promise<void>((resume) => waiting.push(resume))
      held = true
      try {
        await cb()
      } finally {
        held = false
        waiting.shift()?.()
      }
    },
  }
  const deps: LiveDeps = {
    url: '/api/v1/stream',
    EventSource: FakeSource as unknown as typeof EventSource,
    BroadcastChannel: FakeChannel as unknown as typeof BroadcastChannel,
    locks: locks as unknown as LiveDeps['locks'],
  }
  return deps
}

const tab = () => new QueryClient()
const flush = () => new Promise((r) => setTimeout(r, 0))
const open = () => FakeSource.all.filter((s) => !s.closed)

describe('the live stream', () => {
  it('opens one connection for two tabs and relays frames to both', async () => {
    const deps = fakeBrowser()
    const a = tab()
    const b = tab()

    startLiveStream(a, deps)
    startLiveStream(b, deps)
    await flush()
    a.setQueryData(['titles'], [1]) // fresh again after the leader's initial refetch-everything
    b.setQueryData(['titles'], [1])
    expect(b.getQueryState(['titles'])?.isInvalidated).toBe(false)

    expect(open()).toHaveLength(1)
    open()[0].emit('changed', { resource: 'title', id: 5 })
    await flush()
    expect(a.getQueryState(['titles'])?.isInvalidated).toBe(true)
    expect(b.getQueryState(['titles'])?.isInvalidated).toBe(true)

    open()[0].emit('queue', { items: [{ grab_id: 9 }] })
    await flush()
    expect(a.getQueryData(['queue'])).toEqual([{ grab_id: 9 }])
    expect(b.getQueryData(['queue'])).toEqual([{ grab_id: 9 }])
  })

  it('hands the stream to the other tab when the leader closes, and has everyone refetch', async () => {
    const deps = fakeBrowser()
    const a = tab()
    const b = tab()
    const stopA = startLiveStream(a, deps)
    startLiveStream(b, deps)
    await flush()
    b.setQueryData(['titles'], [1])
    expect(b.getQueryState(['titles'])?.isInvalidated).toBe(false)

    stopA()
    await flush()

    expect(FakeSource.all).toHaveLength(2)
    expect(FakeSource.all[0].closed).toBe(true)
    expect(open()).toHaveLength(1)
    expect(b.getQueryState(['titles'])?.isInvalidated).toBe(true)
    open()[0].emit('queue', { items: [] })
    await flush()
    expect(b.getQueryData(['queue'])).toEqual([])
  })

  it('refetches everything after the connection drops and comes back', async () => {
    const deps = fakeBrowser()
    const a = tab()
    startLiveStream(a, deps)
    await flush()
    const src = open()[0]
    src.onopen?.() // first open
    a.setQueryData(['titles'], [1])
    expect(a.getQueryState(['titles'])?.isInvalidated).toBe(false)

    src.onopen?.() // EventSource reconnected

    expect(a.getQueryState(['titles'])?.isInvalidated).toBe(true)
  })

  it("refetches Activity's Grab lists when a Grab changes", async () => {
    const deps = fakeBrowser()
    const a = tab()
    startLiveStream(a, deps)
    await flush()
    a.setQueryData(['grabs', 'finished'], [])
    expect(a.getQueryState(['grabs', 'finished'])?.isInvalidated).toBe(false)

    open()[0].emit('changed', { resource: 'grab', id: 9 })
    await flush()

    expect(a.getQueryState(['grabs', 'finished'])?.isInvalidated).toBe(true)
  })

  it('keeps the search status from its frames', async () => {
    const deps = fakeBrowser()
    const a = tab()
    startLiveStream(a, deps)
    await flush()

    open()[0].emit('search', { due: { versions: 120, episodes: 0, upgrades: 3 }, pass: null })
    await flush()

    expect(a.getQueryData(['search'])).toEqual({ due: { versions: 120, episodes: 0, upgrades: 3 }, pass: null })
  })

  it('keeps the background jobs from their frames', async () => {
    const deps = fakeBrowser()
    const a = tab()
    startLiveStream(a, deps)
    await flush()

    open()[0].emit('jobs', { items: [{ name: 'rss', status: 'running' }] })
    await flush()

    expect(a.getQueryData(['jobs'])).toEqual({ items: [{ name: 'rss', status: 'running' }] })
  })

  it('does nothing where there is no EventSource', () => {
    const stop = startLiveStream(tab(), null)
    stop()
  })
})
