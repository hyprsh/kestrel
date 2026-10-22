import { InstanceList } from './InstanceList'

/**
 * Settings' indexer list: one compact row per indexer, sorted by priority (lower
 * numbers are tried first), with the full form (name, priority, enabled, the
 * manifest's fields) opening inline for Edit or Add indexer.
 */
export function Indexers() {
  return (
    <InstanceList
      contract="indexer.v1"
      noun="indexer"
      addLabel="Add indexer"
      newLabel="New indexer"
      typeLabel="Indexer type"
      empty="No indexers yet. Kestrel cannot search for releases without one."
      showPriority
      managed
    />
  )
}
