import { StatusDot } from '@hyprsh/design'
import { useSystem } from '../api/queries'

/** The status dot and the version: in the top bar on a desktop, in the More sheet on a phone. */
export function ServerStatus() {
  const { data, isError } = useSystem()
  return (
    <span className="label-13 shrink-0 text-gray-900">
      <StatusDot state={isError ? 'error' : data ? 'success' : 'pending'} label={isError ? 'Offline' : data ? `Kestrel ${data.version}` : 'Connecting…'} />
    </span>
  )
}
