// The Settings page's draft: forms keep their edits here until the one Save bar saves them (or Discard drops them).
import { Button, Modal, useToasts } from '@hyprsh/design'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { SettingsBar } from '../layout/SettingsPage'

type Entry = { names: string[]; save: () => Promise<boolean>; discard: () => void }

type Registry = {
  set: (id: string, entry: Entry) => void
  remove: (id: string) => void
}

const Draft = createContext<Registry | null>(null)

/** Asks to leave the page the draft belongs to. Set by the mounted DraftProvider; with none, or nothing unsaved, `proceed` runs at once. */
let guard: ((proceed: () => void) => void) | null = null

/**
 * Runs `proceed` (a navigation away from Settings, or to another page of it) once any unsaved change is dealt with: at
 * once when there is none, else after the leave dialog asked and the answer was to discard.
 */
export function guardLeave(proceed: () => void) {
  if (guard) guard(proceed)
  else proceed()
}

/**
 * The draft of one Settings page. Forms under it register their changed rows with `useDraftForm`; while any is changed it
 * shows the Save bar after `children`, and it asks before the page is left. Remount it (a key) per page.
 */
export function DraftProvider({ children }: { children: ReactNode }) {
  const entries = useRef(new Map<string, Entry>())
  const [names, setNames] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState(false)
  const [asking, setAsking] = useState<(() => void) | null>(null)
  const toasts = useToasts()

  const registry = useMemo<Registry>(
    () => ({
      set: (id, entry) => {
        entries.current.set(id, entry)
        setNames((n) => (n[id]?.join('\u0000') === entry.names.join('\u0000') ? n : { ...n, [id]: entry.names }))
      },
      remove: (id) => {
        entries.current.delete(id)
        setNames((n) => {
          if (!(id in n)) return n
          const { [id]: _gone, ...rest } = n
          return rest
        })
      },
    }),
    [],
  )

  const changed = Object.values(names).flat()
  const dirty = changed.length > 0

  const discard = useCallback(() => entries.current.forEach((e) => e.discard()), [])
  const save = async () => {
    setSaving(true)
    const failed: string[] = []
    for (const e of entries.current.values()) {
      if (e.names.length === 0) continue
      if (!(await e.save())) failed.push(...e.names)
    }
    setSaving(false)
    if (failed.length > 0) toasts.error(`Could not save ${failed.join(', ')}`)
  }

  // Latest `dirty` for the guard, which outlives a render.
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  useEffect(() => {
    guard = (proceed) => (dirtyRef.current ? setAsking(() => proceed) : proceed())
    return () => {
      guard = null
    }
  }, [])
  useEffect(() => {
    if (!dirty) return
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [dirty])

  return (
    <Draft.Provider value={registry}>
      {children}
      {dirty && (
        <SettingsBar count={changed.length} names={changed.join(', ')}>
          <Button size="small" variant="tertiary" disabled={saving} onClick={discard}>
            Discard
          </Button>
          <Button size="small" variant="primary" loading={saving} onClick={() => void save()}>
            Save
          </Button>
        </SettingsBar>
      )}
      <Modal
        open={asking !== null}
        onClose={() => setAsking(null)}
        title="Leave without saving?"
        description={`${changed.length === 1 ? 'One change' : `${changed.length} changes`} on this page ${changed.length === 1 ? 'is' : 'are'} not saved: ${changed.join(', ')}.`}
        actions={
          <>
            <Button size="small" variant="secondary" onClick={() => setAsking(null)}>
              Keep editing
            </Button>
            <Button
              size="small"
              variant="primary"
              onClick={() => {
                const go = asking
                setAsking(null)
                discard()
                go?.()
              }}
            >
              Discard and leave
            </Button>
          </>
        }
      />
    </Draft.Provider>
  )
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * A form of settings whose edits stay a draft. `saved` is what the server has, `labels` names each field in the Save bar,
 * and `commit` saves the draft (it gets the changed fields too, and rejects when that fails; the Save bar then keeps the changes). Returns the draft to
 * show, `set` to edit it and `dirty` to mark a field's row. Outside a DraftProvider the draft still works but no bar shows.
 */
export function useDraftForm<T extends object>({
  id,
  saved,
  labels,
  commit,
}: {
  id: string
  saved: T
  labels: { [K in keyof T]?: string }
  commit: (draft: T, changed: (keyof T)[]) => Promise<unknown>
}) {
  const registry = useContext(Draft)
  const [edits, setEdits] = useState<Partial<T>>({})
  const draft = useMemo(() => ({ ...saved, ...edits }) as T, [saved, edits])
  const dirtyKeys = (Object.keys(edits) as (keyof T)[]).filter((k) => !same(edits[k], saved[k]))
  const names = [...new Set(dirtyKeys.map((k) => labels[k]).filter((n): n is string => !!n))]

  const latest = useRef({ draft, commit, dirtyKeys })
  latest.current = { draft, commit, dirtyKeys }
  const save = useCallback(async () => {
    try {
      await latest.current.commit(latest.current.draft, latest.current.dirtyKeys)
      setEdits({})
      return true
    } catch {
      return false
    }
  }, [])
  const discard = useCallback(() => setEdits({}), [])

  const key = names.join('\u0000')
  useEffect(() => registry?.set(id, { names: key ? key.split('\u0000') : [], save, discard }), [registry, id, key, save, discard])
  useEffect(() => () => registry?.remove(id), [registry, id])

  return {
    draft,
    set: (patch: Partial<T>) => setEdits((e) => ({ ...e, ...patch })),
    dirty: (k: keyof T) => dirtyKeys.includes(k),
    discard,
    save,
    changed: names.length > 0,
  }
}
