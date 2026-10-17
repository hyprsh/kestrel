# PROTOTYPE, throwaway: Kestrel main screens in Geist style

Answers the wayfinder ticket [Main screens in Geist style](https://github.com/hyprsh/kestrel/issues/13): what should Kestrel's main screens look like and contain? This lives on the `prototype/main-screens` branch only and is never merged.

> Three variants of the whole Kestrel UI on one page, switchable via `?variant=A|B|C`, the floating pink bar, or ← / →. Press `D` for dark mode.

```sh
cd web/prototype-main-screens && pnpm install && pnpm dev
```

The data is all mock, in memory (`src/mock.ts`). "Today" is 2026-10-17, and the household's Primary Language is German. Nothing persists, and buttons that would change data only change local state.

## The variants

They disagree about structure, not about colour:

| | A · Dashboard | B · Posters | C · Command |
|---|---|---|---|
| Navigation | Left sidebar | Top header with Geist tabs | ⌘K command menu plus a thin icon rail |
| Home | Library table | Poster grid | "Needs attention" overview |
| Title detail | Full page with tabs | Side sheet over the grid | Split pane (list left, detail right) |
| Episodes | Season accordion, one row per episode, a column per Slot | Season tabs with episode cards | Heat-map matrix: episodes × Slots |
| Activity | Tabs: Queue / History / Blocklist | One timeline feed with filters | Merged into the overview plus a log |
| Wizard | Full-page stepper with a step list | Centred card, one step at a time | One long page with sections |

## The screens every variant covers

Navigate with the `screen` param, e.g. `?variant=A&screen=title&id=severance`.

- `library`: every Title with its Slots/Versions and their status.
- `title&id=…`: poster, English title plus the Primary-Language title as a secondary line, IDs, Request ("Requested by Anna via Silo"), Versions per Slot (Profile, file, score, long-missing flag, actions: search, manual search, switch Profile, remove), and for a Series its seasons and episodes with monitoring toggles.
- `search&id=…&slot=…`: manual search, started from a Version. It lists every Release with its score, custom formats and rejection reasons; you can grab rejected Releases, but not blocklisted ones or ones that fit another Slot.
- `add`: one TMDB-backed search for Movies and Series together; the add dialog shows the preselected Slot and Profile (e.g. "Kids (FSK 6)"); a Series not on TheTVDB is listed but can't be added.
- `upcoming`: a list, not a calendar.
- `activity`: queue, history, blocklist.
- `settings`: Profiles (enable, default per Slot per kind, English fallback), indexers, SABnzbd, root folders, Primary Language, release-date country, Kids rule, display language, provider API key overrides, API key, update from TRaSH.
- `wizard`: first run in five steps: Primary Language, SABnzbd, indexer, root folders, Profiles (with the Kids rule and the release-date country).
- `about`: TMDB and TheTVDB attribution.
