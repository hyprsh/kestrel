// How a Kestrel table uses the design's Table features. A new table (the episode table, a Library table)
// follows these rules, so every table behaves alike:
//
// - Resizable columns: the ones holding text of varying length (a message, a Release name, a Title or
//   Episode name, languages, custom formats). Numbers, dates, badges and checkboxes keep their width.
//   One `truncate` column absorbs the change; it has no handle. Give each resizable column a `width`
//   (so the handles do not wait for rows) and a `minWidth`/`maxWidth` where the header alone is too
//   narrow a floor. A phone shows no table (or no handles), so nothing here is needed for it.
// - Widths: `useColumnWidths('<table key>')` keeps them in local storage under `kestrel.columns.<key>`,
//   saved when a resize ends, and only the columns that differ from their default (the design's rule).
//   A missing, unreadable or corrupt value means the defaults. Pass `widths` and `onChange` to the
//   Table's `columnWidths` / `onColumnWidthsChange`, and put `<ResetColumnWidths>` in the screen's
//   toolbar. Enter or a double-click on a handle resets that column.
// - Page and sort live in the address bar beside the filter (`?page=2&sort=size:desc`), through
//   `usePageParam` and `useUrlParam` in `place.ts`; the page goes back to 1 whenever the filter, the
//   sort or a "show" toggle changes. A long list uses `<Pager>` under the table, not `virtualize`
//   (keep that only where a page is still long).
// - Loading: the data form's `loading` prop, or `<TableSkeletonRows>` (loading.tsx) in the parts form.
// - A table that scrolls inside a pane has `stickyHeader`; the cursor is `Table.Row current`, a chosen
//   row `selected`.
import { Button, type TableColumnWidths } from '@hyprsh/design'
import { useCallback, useState } from 'react'

const prefix = 'kestrel.columns.'

/** The stored widths: only finite positive numbers survive, so a corrupt value reads as the defaults. */
export function readColumnWidths(tableKey: string): TableColumnWidths {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(prefix + tableKey) ?? 'null')
    if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {}
    const widths: TableColumnWidths = {}
    for (const [key, value] of Object.entries(stored)) if (typeof value === 'number' && Number.isFinite(value) && value > 0) widths[key] = value
    return widths
  } catch {
    // no local storage, or not JSON: the defaults
    return {}
  }
}

function writeColumnWidths(tableKey: string, widths: TableColumnWidths) {
  try {
    if (Object.keys(widths).length === 0) localStorage.removeItem(prefix + tableKey)
    else localStorage.setItem(prefix + tableKey, JSON.stringify(widths))
  } catch {
    // no local storage: the widths last until the page is left
  }
}

/** The widths of one table's resizable columns, remembered in this browser. */
export function useColumnWidths(tableKey: string) {
  const [widths, setWidths] = useState(() => readColumnWidths(tableKey))
  const onChange = useCallback(
    (next: TableColumnWidths, change: { phase: 'drag' | 'end' }) => {
      setWidths(next)
      if (change.phase === 'end') writeColumnWidths(tableKey, next)
    },
    [tableKey],
  )
  const reset = useCallback(() => {
    setWidths({})
    writeColumnWidths(tableKey, {})
  }, [tableKey])
  return { widths, onChange, reset, isDefault: Object.keys(widths).length === 0 }
}

/** The "Reset column widths" action of a table; disabled while the widths are the defaults. */
export function ResetColumnWidths({ columns }: { columns: Pick<ReturnType<typeof useColumnWidths>, 'reset' | 'isDefault'> }) {
  return (
    <Button variant="tertiary" size="small" disabled={columns.isDefault} onClick={columns.reset}>
      Reset column widths
    </Button>
  )
}
