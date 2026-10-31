import { useStatus } from '../../api/attention'
import { healthOf } from './tiles'

/** How many checks fail now (0 while the status loads), for the Health tab's dot. */
export function useFailingChecks(): number {
  const status = useStatus().data
  return status ? healthOf(status).failing : 0
}
