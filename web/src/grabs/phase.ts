// What each phase of an active Grab is called and which Activity stage holds it: one table, so
// the row's label and the stage it sits under always agree.
import type { QueueItem } from '../api/queue'

export const phases = {
  queued: { label: 'Queued', stage: 'queued' },
  paused: { label: 'Paused', stage: 'queued' },
  downloading: { label: 'Downloading', stage: 'downloading' },
  post_processing: { label: 'Post-processing', stage: 'processing' },
  importing: { label: 'Importing', stage: 'importing' },
} as const satisfies Record<QueueItem['phase'], { label: string; stage: string }>
