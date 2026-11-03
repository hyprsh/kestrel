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
| `SidePanelView` (Log, Upcoming, Activity, Health Views) | `NavItem` with `onClick`, `current`, `icon`, `trailing` | A count is a number `trailing` (its words join the name: "Errors, 3"); a toned count (red Errors, amber Checks) is a `trailing` node with `trailingLabel`. `SidePanelViews` is now a `NavList` named "Views" with a "Views" group. `current` passes `'true'`. |
| `QualityBox` (Profile sheet) | `Checkbox` | Name "Accept <quality>" kept; it is a native checkbox now, so `aria-checked` is gone. |
| `SuggestionGroup`, `SuggestionRow`, `SuggestionMore` (Suggested) | `Entity` rows in `Entity.List`, `Collapse` | The Suggested section is a `Collapse` (open or closed by context) and "Other languages" an inline `Collapse`. The group heading with its `role="group"` is a few lines in `profiles/Suggested.tsx`; `Entity.List` has no heading. The language chip stays. |
| `FactStrip`, `Fact` (download client card) | `Description` | Four `Description`s in `layout/DescriptionGrid`, which only places them. The accordion's separate `Fact` stays (see below). |
| The Title's ⋯ menu | `Menu.Sub`, `Menu.SubTrigger` | Metadata (refresh, freeze), Open in (the links), Files (move, clean up). Add Version, Show in Log and Remove Title stay at the top. |
| The filter field's clear "x" | `QueryInput`/`QueryBar` `clearable` (v0.19) | The design draws the × and names it `clearLabel="Clear filter"`; `layout/FieldEnd` is gone. |

## Layout module pieces (`web/src/layout/`)

| Piece | Design component that covers it | Switched? | What the design system lacks |
|---|---|---|---|
| `ListPane`, `WideListPane` | `Pane` in a `SplitView` (v0.20) | Deleted | Nothing used them (the Library's list column is the `SidePanel`), so they are gone. The chrome check's alias list flags both. A screen that wants a list beside a detail uses `SplitView` and a `Pane`. |
| `PhoneTopBar` | none (`TabBar` is the bottom bar; `Breadcrumbs` is not a title bar) | Kept | A phone app header: title plus trailing actions. |
| `PhoneBackHeader` | none (`Button` + heading) | Kept | A back-and-title header for a screen opened over a list. |
| `FilterStrip` | `QueryBar` holds the field and menus; the strip around it has no match | Kept | A toolbar that wraps its filter, tabs and menus onto rows. |
| `FilterButton`, `FacetFilterButton`, `SortButton` | `FilterMenu` (checkable rows), `QueryBar.Menu` (a menu per qualifier, single-choice for sort) | Kept | Include/exclude (`-slot:4k`) rows with a count badge on the button, and a phone icon-only form. |
| `PageSurface`, `WidePage` | none | Kept | A page of its own outside a shell: a centred card (login) and a wide scrolling column (wizard). |
| `PaneHeader`, `PaneFooter` | `Pane`'s `header` and `footer` (v0.20) | Switched | Manual search's phone header and the Add confirmation (header, footer) are a `Pane`; its body is the scroll container. The aliases are flagged by the chrome check. |
| `SettingsHeader` | none | Kept | A page title with a one-line summary. |
| `SettingsSection`, `SettingsCard`, `SettingsBlock` | `Fieldset` (title, subtitle, content, footer) is close | Kept | `Fieldset` has a footer for status and actions but no heading action slot or count. Worth trying; not a drop-in since the cards also hold rows with their own dividers. |
| `SettingRow`, `SettingRowBody` | `SettingRow` (v0.20) | Switched | The local `SettingRow` and `SettingRowBody` are deleted; a row with one control (Select, Input, Toggle, Textarea, Button) is the design's, with `changed` for the unsaved-change edge. The row names its control through `<label for>`, so a control's own `aria-label` stays only where its accessible name differs from the label (Country, Header login, Watch-ahead, Use <preset>) or where a button's text is the name (Adopt, Log Out Everywhere). Notes and errors that sat under a control are now under the card, as `DisplayRows` already had them. `layout/StackedSetting` stays, a heading, help and a full-width form: the design row puts one control in a 280px column and ties it to a `<label for>`, which a form (Root folders, TRaSH, provider keys, password, API key, Plex sign-in) cannot take. `SettingsCard` adds the right padding the design row lacks. |
| `SettingsBar` | none (`Note` and `Banner` are inline, not floating) | Kept | A floating "N unsaved changes, Discard / Save" bar. |
| `StatusLine` | `StatusDot` with `label` | Kept | `StatusDot label` draws the dot and its words, but the words have no tone: `StatusLine` makes them red for a problem, grey for a muted state and green for OK, and wraps long text. A text tone on `StatusDot` would let it go. |
| `FactStrip`, `Fact` | `Description` | Switched | Deleted; see the table above. The accordion `Fact` in `library/accordion.tsx` stays: `Description` is 14px with a 500-weight value and an 8px gap, where the open rows use a 12px label over a 13px value in a tight, column-spanning grid. |
| `SidePanel`, `PanelContent`, `SidePanelViews` | `NavList`/`NavItem` for the rows; no panel | Rows switched | The panel itself (title, filter, views, body and footer; phone variant) has no design component. `SidePanelView` is deleted; `SidePanelViews` wraps a `NavList`. |
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
| `QualityChip`, `QualityChips`, `QualityList`, `QualityItem` | `Pill` or `Badge` for the chips | Kept | The cutoff (dark) and "not accepted" (struck through) chip states. `QualityBox` is now a `Checkbox`. |
| `columnWidths`, `columnOrder` | `Table` (resizing since v0.16; reordering with pinned columns and `Table.ColumnsMenu` since v0.17) | Removed | Both hooks were unused: no table kept a column layout. They are deleted. The design's `Table` reorders only in its data form, and the Episode table is built from parts (roving focus, a fold row, a delete-confirm row, a phone layout), so it can't use that reordering yet. `Table.ColumnsMenu` also has no hide/show. The Log's list is not a table. See #351. |

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
- **toast.update():** Kestrel's toasts (`web/src/toasts.ts`) report an outcome. Progress for a background rename or search needs a job-progress feed the SPA does not use yet.
- **Table.ColumnsMenu and pinned columns:** not used. The Episode table is built from parts, and the design's reordering is for the data form only (#351).

## Gaps in hyprsh/design (to file)

1. `ColumnChart`: a per-column and per-mark `onClick`/`href` and an "open" accessible name (Grabs per day).
2. `BarList`: extra columns with a header, and a row `onClick` (Indexers); `href` only suits a real URL.
3. A clickable `Pill`/`Badge` with a state dot (Slot chips).
4. A split-view pane layout, phone title bar, desktop icon rail and a floating action bar.
6. A settings row (label/help on the left, control on the right) with a dirty mark, and a floating "unsaved changes" bar.
7. A month grid that lists entries per day.
8. A disclosure row (a whole-row button with `aria-expanded`) for Activity's rows.
9. Drag-to-reorder rows in a list.
