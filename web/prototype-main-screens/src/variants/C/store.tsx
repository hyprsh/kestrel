// PROTOTYPE, throwaway. Variant C local state: every mutation only touches this in-memory store.
import { createContext, useContext, useState, type ReactNode } from 'react'
import * as M from '../../mock'

export type MenuMode = 'root' | 'add'
type Indexer = { name: string; url: string; limit: string; used: string; status: 'ok' | 'paused'; idSearch: boolean; pausedUntil?: string }

type Store = {
  titles: M.Title[]
  updateTitle: (id: string, fn: (t: M.Title) => M.Title) => void
  updateVersion: (id: string, slot: M.Slot, fn: (v: M.Version) => M.Version) => void
  addTitle: (t: M.Title) => void
  queue: M.QueueItem[]
  setQueue: (q: M.QueueItem[]) => void
  history: M.HistoryEvent[]
  log: (e: Omit<M.HistoryEvent, 'id' | 'at'>) => void
  blocklist: M.BlocklistEntry[]
  setBlocklist: (b: M.BlocklistEntry[]) => void
  profiles: M.Profile[]
  setProfiles: (p: M.Profile[]) => void
  kidsRule: { on: boolean; threshold: 0 | 6 | 12 }
  setKidsRule: (k: { on: boolean; threshold: 0 | 6 | 12 }) => void
  indexers: Indexer[]
  setIndexers: (i: Indexer[]) => void
  trashSnapshot: string
  updateTrash: () => void
  searchAllMissing: () => void
  toasts: { id: number; text: string }[]
  toast: (text: string) => void
  menu: { open: boolean; mode: MenuMode; nonce: number }
  openMenu: (mode?: MenuMode) => void
  closeMenu: () => void
}

const Ctx = createContext<Store | null>(null)
export const useStore = () => useContext(Ctx)!

let toastId = 0

export function StoreProvider({ children }: { children: ReactNode }) {
  const [titles, setTitles] = useState<M.Title[]>(() => structuredClone(M.titles))
  const [queue, setQueue] = useState(() => structuredClone(M.queue))
  const [history, setHistory] = useState(() => structuredClone(M.history))
  const [blocklist, setBlocklist] = useState(() => structuredClone(M.blocklist))
  const [profiles, setProfiles] = useState(() => structuredClone(M.profiles))
  const [kidsRule, setKidsRule] = useState(M.settings.kidsRule)
  const [indexers, setIndexers] = useState<Indexer[]>(() => structuredClone(M.settings.indexers))
  const [trashSnapshot, setTrashSnapshot] = useState(M.settings.trash.snapshot)
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([])
  const [menu, setMenu] = useState({ open: false, mode: 'root' as MenuMode, nonce: 0 })

  const toast = (text: string) => {
    const id = ++toastId
    setToasts((t) => [...t, { id, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500)
  }
  const updateTitle = (id: string, fn: (t: M.Title) => M.Title) => setTitles((ts) => ts.map((t) => (t.id === id ? fn(t) : t)))
  const updateVersion = (id: string, slot: M.Slot, fn: (v: M.Version) => M.Version) =>
    updateTitle(id, (t) => ({ ...t, versions: t.versions.map((v) => (v.slot === slot ? fn(v) : v)) }))

  const store: Store = {
    titles,
    updateTitle,
    updateVersion,
    addTitle: (t) => setTitles((ts) => [...ts, t]),
    queue,
    setQueue,
    history,
    log: (e) => setHistory((h) => [{ ...e, id: `x${Date.now()}`, at: '2026-10-17 10:31' }, ...h]),
    blocklist,
    setBlocklist,
    profiles,
    setProfiles,
    kidsRule,
    setKidsRule,
    indexers,
    setIndexers,
    trashSnapshot,
    updateTrash: () => {
      if (trashSnapshot === M.settings.trash.latest) return toast('TRaSH data is already the latest snapshot')
      setTrashSnapshot(M.settings.trash.latest)
      toast('Updated from TRaSH: snapshot 2026-10-11 · 3 custom format scores changed')
    },
    searchAllMissing: () => {
      const missing = titles.flatMap((t) => t.versions.filter((v) => v.state === 'missing').map((v) => ({ t, v })))
      setTitles((ts) => ts.map((t) => ({ ...t, versions: t.versions.map((v) => (v.state === 'missing' ? { ...v, lastSearched: M.TODAY } : v)) })))
      toast(`Searching ${missing.length} missing Versions across ${new Set(missing.map((m) => m.t.id)).size} Titles`)
    },
    toasts,
    toast,
    menu,
    openMenu: (mode = 'root') => setMenu((m) => ({ open: true, mode, nonce: m.nonce + 1 })),
    closeMenu: () => setMenu((m) => ({ ...m, open: false })),
  }
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}
