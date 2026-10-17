// PROTOTYPE, throwaway. Variant A's local React state: copies of the mock data that screens may mutate.
import { createContext, useContext, useState, type ReactNode } from 'react'
import * as m from '../../mock'
import type { Slot, Title, Version } from '../../mock'

function useStoreState() {
  const [titles, setTitles] = useState<Title[]>(() => structuredClone(m.titles))
  const [queue, setQueue] = useState(() => structuredClone(m.queue))
  const [blocklist, setBlocklist] = useState(() => structuredClone(m.blocklist))
  const [profiles, setProfiles] = useState(() => structuredClone(m.profiles))
  const [settings, setSettings] = useState(() => structuredClone(m.settings))
  const [toast, setToast] = useState<string | null>(null)

  const updateTitle = (id: string, fn: (t: Title) => Title) => setTitles((ts) => ts.map((t) => (t.id === id ? fn(t) : t)))
  const updateVersion = (id: string, slot: Slot, fn: (v: Version) => Version) =>
    updateTitle(id, (t) => ({ ...t, versions: t.versions.map((v) => (v.slot === slot ? fn(v) : v)) }))
  const notify = (msg: string) => {
    setToast(msg)
    window.clearTimeout((notify as unknown as { t?: number }).t)
    ;(notify as unknown as { t?: number }).t = window.setTimeout(() => setToast(null), 2600)
  }
  const profileById = (pid: string) => profiles.find((p) => p.id === pid)!
  const titleById = (id: string) => titles.find((t) => t.id === id)

  return { titles, setTitles, queue, setQueue, blocklist, setBlocklist, profiles, setProfiles, settings, setSettings, toast, notify, updateTitle, updateVersion, profileById, titleById }
}

type Store = ReturnType<typeof useStoreState>
const Ctx = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const s = useStoreState()
  return <Ctx.Provider value={s}>{children}</Ctx.Provider>
}

export const useStore = () => useContext(Ctx)!

export const fmtDate = (iso: string) => {
  const d = new Date(iso.slice(0, 10) + 'T12:00:00')
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
export const fmtDay = (iso: string) => {
  const d = new Date(iso.slice(0, 10) + 'T12:00:00')
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}
export const relDays = (iso: string) => {
  const n = m.daysBetween(m.TODAY, iso.slice(0, 10))
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  if (n === -1) return 'yesterday'
  return n > 0 ? `in ${n} d` : `${-n} d ago`
}

/** Next date a Title expects something (episode air date or a movie release), for the Library column. */
export function nextDate(t: Title): string | undefined {
  if (t.nextAiring) return t.nextAiring
  const u = m.upcoming.find((x) => x.titleId === t.id && x.date >= m.TODAY)
  return u?.date
}

import type { Tone } from '../../ui'
import type { HistoryEvent } from '../../mock'
export const eventTone: Record<HistoryEvent['type'], Tone> = {
  Grabbed: 'blue',
  Imported: 'green',
  Upgraded: 'teal',
  Failed: 'red',
  Blocklisted: 'red',
  Renamed: 'gray',
  Requested: 'purple',
  'Version added': 'gray',
  Adopted: 'teal',
}
