# Scoring parity data

`radarr-cf.json` and `sonarr-cf.json` record which TRaSH Custom Formats the
pinned Radarr and Sonarr match for a corpus of release names (PRD #22 Settled
26, ADR 0006). The tests replay them offline, with no Docker, and require
`scoring` to match set for set. The Score is not recorded, only the matched
Custom Formats.

| | Radarr | Sonarr |
|---|---|---|
| Release | `v5.28.0.10274` | `v4.0.20.3014` |
| Image | `ghcr.io/hotio/radarr:release-5.28.0.10274` | `ghcr.io/hotio/sonarr:release-4.0.20.3014` |
| Image digest | `sha256:42ca21d9bab4df84af1898e7256256b85a04b207e72c620ac382ac4151d65dd0` | `sha256:afc94d6134d3e21162bc86b82afee332c7555bedf4a29b710edcd794c9c38e1d` |
| TRaSH commit | `14a4166673996301e588a4f70d03b9cfb760b50f` (TRaSH `master` at the time) | same |

Each file repeats its pins, and a test fails if the TRaSH commit drifts from the
embedded snapshot's (`trash/COMMIT`).

## How it is recorded

`scripts/regen-cf-golden.sh` (dev only, needs Docker and network, never run in
CI) starts both containers, POSTs every Custom Format of the embedded snapshot
to them (the same JSON Recyclarr would send, minus the `trash_*` fields), adds
a few Titles so that "Original" resolves (Radarr: The Matrix en, Das Boot de,
Amelie fr, Spirited Away ja; Sonarr: Breaking Bad en, Dark de, Call My Agent!
fr), and asks `GET /api/v3/parse?title=` about a few hundred names built from
those Titles, about 65 name shapes (languages, sources, HDR, audio, editions,
unwanted formats) and release groups taken from TRaSH's own tier lists. Each
case records the Custom Formats Radarr or Sonarr matched and the languages it
settled on after its aggregation.

- **Movies** run end to end: Kestrel's own parser, then `scoring`.
- **Series** inputs are built from Sonarr's own parse of the name (what its
  Custom Formats saw), so the engine is tested without depending on the Series
  parser.

Regenerate whenever the TRaSH snapshot or an upstream pin moves.
