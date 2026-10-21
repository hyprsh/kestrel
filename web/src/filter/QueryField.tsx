// The filter field of a list screen, GitHub-style: one input for qualifiers (filter/query.ts)
// and free text. Each screen passes its qualifier table; the field knows only the grammar.
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { suggest, type Qualifier } from './query'
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

  return (
    <div className="relative w-full max-w-xl">
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
    </div>
  )
}
