import { Spinner } from '@hyprsh/design'
import { useAfter } from './useAfter'

/** A loading line: a Spinner with text, shown only once the wait has lasted about 300ms. */
export function Loading({ children }: { children: string }) {
  const late = useAfter(true, 300)
  if (!late) return null
  return (
    <p className="label-13 flex items-center gap-2 text-gray-900">
      <Spinner size="sm" />
      {children}
    </p>
  )
}
