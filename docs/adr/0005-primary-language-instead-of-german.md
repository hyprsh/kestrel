# One household Primary Language instead of hard-coded German

Kestrel was charted for a German household, so Profiles, Dual-Language Releases, release parsing and title search all said "German". We replaced that with a **Primary Language**, chosen once in the setup wizard. Everything that said German now derives from it:

- the audio a Profile requires,
- what DL/MULTi means in a release name,
- the title variants and transliteration used in text searches and matching,
- the default release-date country, and through it the age-rating system behind the Kids rule.

v1 offers English (pre-selected), German and French, because those are the languages TRaSH publishes profiles for. English uses TRaSH's standard profiles. German uses the `[German]` profiles. French uses `[French MULTi.VF]` for Primary-Language Profiles and `[French MULTi.VO]` for Original-Language Profiles. The UI itself stays English-only.

## Considered Options

- **Keep German hard-coded.** This is simplest for the one household Kestrel was charted for, but it bakes one language into names, parsing and scoring, and that would be costly to undo later.
- **Any language, with Kestrel-generated scoring.** Following TRaSH's Dutch pattern (a "not X" custom format at −10000 plus a small bonus) would cover every language. Rejected because Kestrel would have to write and maintain its own scores. That contradicts both "TRaSH is the reference" and "no custom format editor in v1".

## Consequences

- The wizard gains a Primary Language step, with an explainer of what the choice changes. It can be changed later in Settings, but a change only affects scoring and Grabs from then on. Existing files are left alone.
- The release-name parser does not depend on the Primary Language. It recognises every language the Radarr/Sonarr parser knows, including French tokens (`MULTi`, `VFF`/`TRUEFRENCH`, `VFQ`, `VF2`, `VOSTFR` and others) and German `DL`/`ML` (ADR 0006). The Primary Language only acts after parsing.
- The naming scheme's language tag follows the Primary Language (`[German DL]`, `[French MULTi]`).
- When a Title's Original Language is the Primary Language, the two Profiles of a Slot aim for the same audio. We accept that overlap.
- Adding a language later needs TRaSH data for it. A language without TRaSH data would mean revisiting the Kestrel-generated scoring option.
