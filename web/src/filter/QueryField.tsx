// The filter field of a list screen, GitHub-style: one input for qualifiers (filter/query.ts)
// and free text. Each screen passes its qualifier table; the field knows only the grammar.
import type { Qualifier } from './query'
import { TextInput } from '../forms'

export function QueryField({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  qualifiers: readonly Qualifier[]
  placeholder?: string
}) {
  return (
    <div className="relative w-full max-w-xl">
      <TextInput
        id={id}
        role="combobox"
        aria-label={label}
        aria-expanded={false}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => (e.key === 'Escape' || e.key === 'Enter') && e.currentTarget.blur()}
      />
    </div>
  )
}
