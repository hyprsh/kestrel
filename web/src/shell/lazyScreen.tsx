import { createElement, lazy, type ComponentType } from 'react'

/**
 * A screen fetched as its own chunk. Once it has loaded (by a click, by the idle prefetch or by pointing at its nav item)
 * it renders at once: React holds back content that follows a Suspense fallback for about 300 ms, which would delay a
 * screen that is already in the browser.
 */
export function lazyScreen<P extends object>(load: () => Promise<ComponentType<P>>) {
  let loaded: ComponentType<P> | null = null
  const preload = () =>
    load().then((c) => {
      loaded = c
    })
  const Suspending = lazy(() => preload().then(() => ({ default: loaded! })))
  const Screen = (props: P) => (loaded ? createElement(loaded, props) : createElement(Suspending as ComponentType<P>, props))
  return { Screen, preload }
}
