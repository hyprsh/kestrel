# Design inventory

Which of Kestrel's own pieces the `@hyprsh/design` system (v0.18.0) already covers, which Kestrel switched to it, and what the design system lacks where Kestrel kept its own. It answers hyprsh/kestrel#321 (and #326, which was merged into it). The gaps are for the maintainer to file in hyprsh/design; none was filed from here.

"Switched" means this change replaced the piece. "Kept" means Kestrel's piece stays, with the reason. The chrome check (`web/scripts/chrome-check.ts`, ADR 0017) now fails a piece declared under a design export's name or a known alias, unless a `// chrome-ok: <reason>` line above it says why.

## Switched in this change

| Kestrel piece | Design component | Notes |
|---|---|---|
| `JumpNav`, `JumpGroup`, `JumpLink` (layout) | `NavList`, `NavList.Group`, `NavItem` | The Settings section list. The "Needs attention" dot is a `StatusDot` as `trailing` with `trailingLabel="Needs attention"`; the search note line is part of the item's children. `current` passes `'true'`, so `aria-current="true"` is unchanged. The layout file is deleted. |
| `Columns`, `ChartTable` for the download client's speed (Overview) | `ColumnChart` | One untoned series in `--chart-series` (teal; it was blue). The design adds its own "View as Table" toggle and screen-reader table, so the hand-made `ChartTable` twin is gone for this card. |
| `BarRow`, `Bar`, `ChartTable` for Top release groups (Overview) | `BarList` (`mono`, `unit="files imported"`) | Rows read "NTb, 18 files imported", as before. The bar colour is `--chart-series`. |
| The Library filter's "/" key cap and key handler (placeholder trick, `Kbd` suffix, `useKey('/')`) | `QueryInput`/`QueryBar` `shortcut="/"` | The design focuses the field from anywhere, shows the key cap while the field is empty and sets `aria-keyshortcuts`. `FilterBar` takes a `shortcut` prop. |
| The Library query help | `QueryHelpButton` (drawn by `QueryBar` itself) | The "?" button and popover were already the design's, drawn by `QueryBar`; there was no local copy to delete. |
| The filter field's clear "x" | still Kestrel's, now in `layout/FieldEnd` | See the gap "QueryInput suffix" below. |

## Layout module pieces (`web/src/layout/`)

| Piece | Design component that covers it | Switched? | What the design system lacks |
|---|---|---|---|
| `ListPane`, `WideListPane` | none (`Scroller` scrolls, but does not give a fixed-width list column with a divider) | Kept | A pane/split-view layout: fixed-width side column with a divider and a containing block for a floating bar. |
| `PhoneTopBar` | none (`TabBar` is the bottom bar; `Breadcrumbs` is not a title bar) | Kept | A phone app header: title plus trailing actions. |
| `PhoneBackHeader` | none (`Button` + heading) | Kept | A back-and-title header for a screen opened over a list. |
| `FilterStrip` | `QueryBar` holds the field and menus; the strip around it has no match | Kept | A toolbar that wraps its filter, tabs and menus onto rows. |
| `FilterButton`, `FacetFilterButton`, `SortButton` | `FilterMenu` (checkable rows), `QueryBar.Menu` (a menu per qualifier, single-choice for sort) | Kept | Include/exclude (`-slot:4k`) rows with a count badge on the button, and a phone icon-only form. |
| `PageSurface`, `WidePage` | none | Kept | A page of its own outside a shell: a centred card (login) and a wide scrolling column (wizard). |
| `PaneHeader`, `PaneFooter` | none | Kept | Pane header and footer bars with a divider. |
| `SettingsHeader` | none | Kept | A page title with a one-line summary. |
| `SettingsSection`, `SettingsCard`, `SettingsBlock` | `Fieldset` (title, subtitle, content, footer) is close | Kept | `Fieldset` has a footer for status and actions but no heading action slot or count. Worth trying; not a drop-in since the cards also hold rows with their own dividers. |
| `SettingRow`, `SettingRowBody` | none | Kept | A label/help on the left and a control on the right, with a dirty-edge mark and a stacked form. |
| `SettingsBar` | none (`Note` and `Banner` are inline, not floating) | Kept | A floating "N unsaved changes, Discard / Save" bar. |
| `StatusLine` | `StatusDot` with `label` | Kept | A dot with a sentence and a muted/problem tone for the words. `StatusDot label` may cover most of it; the tone for the text does not exist. |
| `FactStrip`, `Fact` | `Description` is a candidate | Kept | A caption-over-value grid that fills as many columns as fit. Not verified against `Description`. |
| `SidePanel`, `PanelContent`, `SidePanelViews`, `SidePanelView` | `NavList`/`NavItem` for the rows; no panel | Views rows kept, Settings rows switched | The panel itself (title, filter, views, body and footer; phone variant) has no design component. `SidePanelView` (name, icon, count, `onSelect` button) is what `NavItem` with `onClick` and a numeric `trailing` now does: it can switch once the rows' look is checked on the Log, Upcoming and Library screens. |
| `FilterChips` | none (`Pill`/`Badge` are static; `FilterParams` is a query-parameter bar) | Kept | Removable chips ("Remove Wanted"). `FilterParams` may fit; not checked. |
| `SelectionBar` | none | Kept | A bar for ticked rows with select-all controls. |
| `FloatingBar` | none | Kept | A floating or sticky toolbar over a list's foot. |
| `SectionBlock` | none | Kept | A titled, counted block of rows. A `heading` and a list is all it is. |
| `StatCard`, `StatTile` | none (`Gauge` is a dial) | Kept | A dashboard card with a heading and aside, and a figure tile. |
| `NowCard`, `NowSub`, `NowList`, `NowRow`, `NowEmpty` | `Entity.List` for rows | Kept | Overview's cards of rows with a lead, a right side and j/k navigation. |
| `Rail`, `RailSpacer` | none (`TabBar` is a bottom bar) | Kept | A desktop icon rail. |
| `PagerStrip` | `Pager` is the control; the strip around it has no match | Kept | Placement only. |
| `RowList`, `stackedRow`, `stackedRight` | `Entity.List` | Kept as a thin wrapper | Rows that stack their right side when the list is narrow (container query). |
| `IndexerHead`, `IndexerLine`, `SlotHead`, `SlotLine` | `Table` (resizable columns, reordering and pinned columns since v0.16/v0.17) | Kept | These are drag-sortable lists with a handle, switch and menu per row. `Table` has column reordering but not row reordering. |
| `ProfileCard`, `ProfileFacts`, `DefaultsLine` | `Entity` for the head row | Kept | A card of a Profile: name, uses, action, chips and facts. Kestrel's own domain; the chips and facts are not general. |
| `QualityChip`, `QualityChips`, `QualityList`, `QualityItem`, `QualityBox` | `Pill` or `Badge` for the chips; `Checkbox` for the box | Kept | The cutoff (dark) and "not accepted" (struck through) chip states. `QualityBox` is a hand-built checkbox look, which `Checkbox` should cover: a candidate for a follow-up. |
| `SuggestionGroup`, `SuggestionRow`, `SuggestionMore` | `Entity` rows, `Collapse` or `ShowMore` for the disclosure | Kept | The pieces would map to `Entity` plus `Collapse`; not switched in this change (Settings: Slots and Profiles was merging). |
| `columnWidths`, `columnOrder` | `Table` (resizing since v0.16; reordering with pinned columns and `Table.ColumnsMenu` since v0.17) | Kept | The design's `Table` now does what both hooks do, with its own menu. Switching changes the Episode table and the Log's table, which are being changed in other open PRs, so it is a separate change. |
| `layout/FieldEnd` (new) | none | New | `QueryInput` no longer takes a `suffix` from the app (v0.18 sets it from `shortcut` only); the x of the filter field goes into the field's box through this piece. |

## Raw elements outside the layout module

| File | Element | Design component | Switched? | Reason or gap |
|---|---|---|---|---|
| `activity/InProgress.tsx:98` | `<button>` wrapping a two-line title, toggling a phone row open | `Entity as="button"` or `Collapse` | Kept | The button holds two text lines that stack (`flex-col`) and toggles `aria-expanded`; `Entity` has no expandable row. Needs a disclosure row. |
| `activity/History.tsx:136` | `<button>` that is the whole row, toggling its detail | `Collapse` | Kept | A full-width row with j/k navigation and a detail; `Collapse` has its own header and spacing. |
| `library/SlotChip.tsx:100` | `<button>` per Slot chip | `Pill`, `Badge` | Kept | A `Badge` or `Pill` is not clickable. A clickable pill with a state dot is missing. |
| `upcoming/AgendaRow.tsx:50` | `<button>` that opens the entry | `Entity as="button"` | Kept | Carries `data-nav`, `aria-current` and a composed `aria-label` for the j/k list; the row is custom. |
| `upcoming/MonthView.tsx:89, 105, 119` | `<button>` for the day, an entry and "+N more" | `Calendar` | Kept | `Calendar` picks a date; the Month view lists entries per day cell. A month grid with entries is missing. |
| `overview/charts.tsx` | `<table>` (screen-reader twin, kept for Grabs, Indexers, Library quality) | `ColumnChart`'s own table | Partly | Gone from the two cards that switched; stays for the cards that kept local marks. |
| `overview/charts.tsx` | `<button>` per column and mark of `Columns`, per row of `BarRow` | `ColumnChart`, `BarList` | Kept | See "Overview charts" below. |
| `layout/NowCard.tsx:83` | `<button>` that opens a row | `Entity as="button"` | Kept | The lead and children are one button with the j/k `navIndex` and `current` marker. |
| `layout/columnWidths.tsx`, `layout/columnOrder.tsx` | no raw element (the match is in a comment) | `Table` | Kept | See the layout table. |

## Overview charts

Switched where the design component fits, kept where it does not:

- **Download client speed** (`ColumnChart`): no drill-down existed, so it switched.
- **Top release groups** (`BarList`): no drill-down existed, so it switched.
- **Grabs per day**: kept as `Columns`. A click on a column opens Activity for that day, and a click on a mark opens it for the stage (#340). `ColumnChart` has no per-column or per-mark click or `href`.
- **Indexers**: kept as `BarRow`/`BarHeader`/`Bar`. A row opens Activity for the indexer (#340) and carries three more columns (Hit, Answer, Failed) with a column header. `BarList` has one bar and a figure per row, an `href` (no handler for an in-app route) and no extra columns.
- **Library quality**: kept as `SegmentedBar`. `Progress` has multiple segments with a 2px gap since v0.17 and is the likely match. It was not switched because each part is a focus target with its own tooltip and the three classes use a blue ramp; `Progress` segment tones are status colours. Not checked in the demo.

The chart tokens (`chart-seq-*`, `chart-series`) are used through `ColumnChart` and `BarList`. Kestrel's own marks still use `blue-*`, `green-700` and `red-700` classes.

## What was not switched from the issue's list, and why

- **Sparkbars:** no screen shows per-run histories (job runs, indexer requests) today, so there is nothing to replace.
- **Menu.Sub:** the Title's ⋯ menu was not restructured; that is a redesign of a screen, outside this change's "swap only" scope.
- **toast.update():** Kestrel's toasts (`web/src/toasts.ts`) report an outcome. Progress for a background rename or search needs a job-progress feed the SPA does not use yet.
- **Table.ColumnsMenu and pinned columns:** see `columnWidths`/`columnOrder` above.

## Gaps in hyprsh/design (to file)

1. `ColumnChart`: a per-column and per-mark `onClick`/`href` and an "open" accessible name (Grabs per day).
2. `BarList`: extra columns with a header, and a row `onClick` (Indexers); `href` only suits a real URL.
3. `QueryInput`: a `suffix` that survives `shortcut` (v0.18 drops the app's suffix), or a built-in clear button. Kestrel's × now goes in through `FieldEnd`, which depends on the `.hy-input` class.
4. A clickable `Pill`/`Badge` with a state dot (Slot chips).
5. A split-view pane layout, phone title bar, desktop icon rail and a floating action bar.
6. A settings row (label/help on the left, control on the right) with a dirty mark, and a floating "unsaved changes" bar.
7. A month grid that lists entries per day.
8. A disclosure row (a whole-row button with `aria-expanded`) for Activity's rows.
9. Drag-to-reorder rows in a list.
