import { SingleInstance } from './SingleInstance'

/** The wizard's Indexer form: it adds one indexer, and edits it if it exists. Settings manages many (Indexers.tsx). */
export function Indexer() {
  return <SingleInstance contract="indexer.v1" noun="indexer" />
}
