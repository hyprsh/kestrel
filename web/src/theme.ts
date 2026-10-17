import { useCallback, useEffect, useState } from 'react'

export type Theme = 'system' | 'light' | 'dark'

const KEY = 'kestrel.theme'
const order: Theme[] = ['system', 'light', 'dark']

function stored(): Theme {
  const v = localStorage.getItem(KEY)
  return v === 'light' || v === 'dark' ? v : 'system'
}

function prefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
}

function apply(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'system' && prefersDark()))
}

/** Light, dark or follow the system. The choice is kept in localStorage; index.html applies it before first paint. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(stored)

  useEffect(() => {
    apply(theme)
    if (theme !== 'system' || typeof matchMedia !== 'function') return
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => apply('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])

  const cycle = useCallback(() => {
    const next = order[(order.indexOf(theme) + 1) % order.length]
    localStorage.setItem(KEY, next)
    setTheme(next)
  }, [theme])

  return { theme, cycle }
}
