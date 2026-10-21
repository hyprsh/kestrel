// The filter field of a list screen, GitHub-style: one input for qualifiers (filter/query.ts)
// and free text. Each screen passes its qualifier table; the field knows only the grammar.
import { CircleHelp, X } from 'lucide-react'
import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { parse, suggest, termText, withoutTerm, type Qualifier } from './query'
import { TextInput } from '../forms'
import { cx } from '../ui'

export function QueryField({
  id,
  label,
  value,
  onChange,
  qualifiers,
  placeholder,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  qualifiers: readonly Qualifier[]
  placeholder?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const [caret, setCaret] = useState<number | null>(null)
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  // Where the caret goes once a picked suggestion is in the field.
  const placeCaret = useRef<number | null>(null)
  const listId = useId()

  const suggestions = caret === null || dismissed ? [] : suggest(value, caret, qualifiers)
  const open = suggestions.length > 0
  const current = Math.min(active, suggestions.length - 1)

  useLayoutEffect(() => {
    if (placeCaret.current === null) return
    input.current?.setSelectionRange(placeCaret.current, placeCaret.current)
    placeCaret.current = null
  }, [value])

  const edit = (next: string, at: number) => {
    onChange(next)
    setCaret(at)
    setActive(0)
    setDismissed(false)
  }
  const pick = (i: number) => {
    const s = suggestions[i]
    placeCaret.current = s.caret
    edit(s.input, s.caret)
    setDismissed(true)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      const n = suggestions.length
      setActive((current + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
    } else if (open && (e.key === 'Enter' || e.key === 'Tab')) {
      e.preventDefault()
      pick(current)
    } else if (open && e.key === 'Escape') {
      e.preventDefault()
      setDismissed(true)
    } else if (e.key === 'Escape' || e.key === 'Enter') e.currentTarget.blur()
  }

  const parsed = parse(value, qualifiers)
  // The term being typed is not finished yet: only finished ones are complained about.
  const problems = parsed.problems.filter((p) => caret === null || caret < p.span[0] || caret > p.span[1])

  return (
    <div className="flex w-full max-w-xl flex-col gap-1.5">
      <div className="relative flex items-center gap-1.5">
      <TextInput
        ref={input}
        id={id}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${current}` : undefined}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={(e) => edit(e.target.value, e.target.selectionStart ?? e.target.value.length)}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onFocus={(e) => setCaret(e.currentTarget.selectionStart)}
        onBlur={() => setCaret(null)}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Suggestions"
          className="absolute top-full left-0 z-40 mt-1 max-h-64 min-w-48 overflow-auto rounded-md border border-gray-alpha-400 bg-background-100 p-1 shadow-lg"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === current}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(i)}
              onMouseEnter={() => setActive(i)}
              className={cx('cursor-pointer rounded px-2 py-1 font-mono text-[12px]', i === current && 'bg-gray-alpha-200')}
            >
              {s.value}
            </li>
          ))}
        </ul>
      )}
      <Help qualifiers={qualifiers} />
      </div>
      {parsed.terms.length > 0 && (
        <ul aria-label="Active filters" className="flex flex-wrap gap-1">
          {parsed.terms.map((t, i) => (
            <li key={`${i}-${t.span[0]}`} className="inline-flex h-5 items-center gap-0.5 rounded-full bg-gray-alpha-200 pr-0.5 pl-2 font-mono text-[11px] text-gray-1000">
              {termText(t)}
              <button
                aria-label={`Remove ${termText(t)}`}
                onClick={() => onChange(withoutTerm(value, i, qualifiers))}
                className="flex size-4 items-center justify-center rounded-full text-gray-900 hover:bg-gray-alpha-300 hover:text-gray-1000"
              >
                <X aria-hidden className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {problems.length > 0 && (
        <p role="status" className="text-[12px] text-amber-900">
          {problems.map((p) => p.message).join(' · ')}
        </p>
      )}
    </div>
  )
}

/** The "?" popover: what each qualifier does, and the grammar. */
function Help({ qualifiers }: { qualifiers: readonly Qualifier[] }) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const id = useId()
  useEffect(() => {
    if (!open) return
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), setOpen(false))
    const onDown = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onDown)
    }
  }, [open])
  return (
    <div ref={wrap} className="relative shrink-0">
      <button
        aria-label="Filter help"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        className="flex size-8 items-center justify-center rounded-md text-gray-900 hover:bg-gray-alpha-100 hover:text-gray-1000"
      >
        <CircleHelp aria-hidden className="size-4" />
      </button>
      {open && (
        <div
          id={id}
          role="dialog"
          aria-label="Filter help"
          className="absolute top-full right-0 z-40 mt-1 w-80 rounded-md border border-gray-alpha-400 bg-background-100 p-3 text-[12px] shadow-lg"
        >
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
            {qualifiers.map((q) => (
              <Fragment key={q.name}>
                <dt className="font-mono text-gray-1000">{q.name}:</dt>
                <dd className="text-gray-900">{q.help}</dd>
              </Fragment>
            ))}
          </dl>
          <p className="mt-2 border-t border-gray-alpha-200 pt-2 text-gray-900">
            <code className="font-mono">a,b</code> matches either, different qualifiers must all match, and a leading <code className="font-mono">-</code> leaves
            values out. Other words match the text.
          </p>
        </div>
      )}
    </div>
  )
}
