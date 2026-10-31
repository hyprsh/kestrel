import { useStatus } from '../../api/attention'
import { healthOf } from './tiles'

/** How many checks fail and how many warn now (0 while the status loads), for the Health tab's dot. */
export function useHealthCounts(): { failing: number; warnings: number } {
  const status = useStatus().data
  return status ? healthOf(status) : { failing: 0, warnings: 0 }
}
