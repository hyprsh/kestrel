# A declared display setting is read-only on its own, and the others stay the UI's

ADR 0014 made a declared section read-only as a whole. The `display` section holds four independent view defaults: season order, which seasons open, the Manual search sort and the Upcoming filters. A deployment that cares about one, say the season order, would otherwise have to declare all four and lock households out of the other three. Now the Config File owns each display setting only when it names it. A key the file leaves out stays with the UI and the API, the same way they manage a section the file leaves out. This amends the consequence in ADR 0014 that "a section is declared or not as a whole: there are no read-only fields inside a section the UI otherwise manages". The `display` section is that exception, as a plugin instance's `enabled` is in ADR 0015. `upcoming_filters` is still declared as a whole: a filter it leaves out takes its default.

## Considered Options

- **Declare `display` as a whole, like every other section.** Rejected because the file would have to state, and lock, settings a deployment has no opinion on, and a household could no longer pick its own Manual search sort.
- **Make every display setting always the UI's.** Rejected because a deployment that sets one in the file means it, and until now the file decided.
- **Store which keys the file declared.** Rejected for the reason ADR 0015 gives: the file is read at every start and the API holds it, so a declared key is a fact about the current file and needs no column and no migration.

## Consequences

- `GET /settings` reports `from_config_file.display` per key (`season_order`, `seasons_open`, `manual_search_sort`, `upcoming_filters`). A `PATCH /settings` that names a declared display key answers 409 naming the file and saves nothing, not even its other sections. A patch that names only undeclared keys saves as usual.
- Startup applies only the keys the file names. A key that leaves the file goes back to the UI and keeps the value the file last set, as for any declared value.
- In the SPA a declared key's control in Settings > Display is read-only with the declared note, and the others stay editable.
