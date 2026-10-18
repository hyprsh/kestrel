// The Overview's one j/k selection (`ov` scope) runs through every section's rows,
// top to bottom. Each section is handed where its rows start and which row is selected.
export type OverviewNav = {
  /** The index of the section's first row in the flattened list. */
  base: number
  /** The selected row, as an index into the flattened list. */
  sel: number
  select: (index: number) => void
}
