# Kestrel adapts to @hyprsh/design

Kestrel's web UI is built on `@hyprsh/design`. The v0.11.0 audit (`docs/research/design-adoption-audit.md`) found 100 hand-built patterns: 36 that an existing component already covers, 24 that a documented prop covers, and 40 that no component covers. Each gap can be closed in one of two ways: Kestrel changes to fit an existing component, or the library grows to fit Kestrel. Every hyprsh app uses the library, so all of them carry the cost of anything shaped around Kestrel. Kestrel's own restyles of a component also drift whenever the design changes.

So Kestrel adapts by default. The library changes only under these rules:

- **A library change must be small, or it isn't made.** It is a new prop, variant or CSS custom property on an existing component. It must be generic to any hyprsh app and named without Kestrel's terms. A new component never counts as small.
- **Kestrel owns layout.** The rail, the top bar, pane headers and footers, filter and tab strips, and the Login and Wizard pages all live in one layout module in `web/src`. That module uses only design tokens and documented utilities.
- **Domain visuals stay in Kestrel.** The poster frame, the Agenda timeline, the health tile and the episode grid with its season rows have no counterpart in the design. A library prop is considered only where an existing component already does the same job.
- **Kestrel follows the design guidelines and reworks its UX to fit them.** The library is asked for a change only when following a guideline would take away a capability users need.
- **The design's look wins.** Where Kestrel's look and the design's differ, Kestrel takes the design's: 14px body text instead of 13px, `accent-*` instead of `blue-*`, `contrast="low"` badges, `Entity.List` cards instead of flush lists, and the Table cursor tint instead of NavRow's.

A check in `make lint-web` enforces the rules. These utilities fail outside the layout module and an allowlist of domain visuals:

- `rounded-*`, `border-*`, `shadow-*`, `ring-*` and `bg-*`
- `!`-important
- arbitrary `.hy-*` selectors

`KestrelLogo` is on the allowlist as Kestrel's brand asset. It follows the design's Logo rules: `currentColor`, 20–24px, never recoloured.

## Library changes

Four changes passed these rules:

- **Toast reads `--tab-bar-height`.** Its bottom offset adds `var(--tab-bar-height, 0px)`, so toasts clear the phone TabBar. TabBar already publishes the property as public API. Today Kestrel lifts the toast stack with an `!important` override.
- **DotsMenu forwards `tabIndex` and `onFocus` to its button.** The episode grid moves focus between cells itself. A row's menu button must therefore stay out of the tab order and hand focus back to its cell. Without these props the grid would need a hand-built menu button.
- **Button takes `badge`, `badgeTone` and `badgeLabel`, as TabBar.Item does.** The rail's Needs-attention count then looks the same as the phone tab bar's. Today Kestrel pins a Badge over the rail button.
- **Entity takes `current`, styled exactly like TableRow `current`.** That means the `gray-alpha-100` tint, the 2px marker and `aria-current`. It replaces NavRow, and the Library list becomes Entity rows that use it.

In every other entry of the audit, Kestrel adapts or owns the pattern. The audit's Decision column records which, entry by entry.

## Considered Options

- **Grow the library to fit Kestrel.** Rejected because a sidebar, page-header, timeline or poster component would be shaped by one app and carried by all of them.
- **Keep Kestrel's restyles through `className`.** Rejected because those overrides reach into the component's internals and break when the design changes. That happened to the EmptyStates with `m-4` when v0.10 made EmptyState full width.
- **Ship the library changes first, then adopt everything in one pass.** Rejected because most of the work needs nothing from the library, and waiting would stall it.

## Consequences

- Kestrel starts adopting now. The four places that wait for a library change keep their current code, sit on the lint allowlist and are marked as waiting. The version bump that brings the library release removes both the markers and the allowlist entries.
- Users see some UX changes:
  - The Log's kind badge no longer filters; the Kind filter menu does that.
  - "Search queued" becomes a Toast without a link.
  - A Needs-attention row shows its first action as a button and moves the rest into a menu.
  - The command menu loses its footer and its match highlighting.
  - On a phone, the episode grid no longer pins the Episode column.
- The UI also looks a little different: body text is larger, lists that were flush get cards, and the blue accent replaces Kestrel's `blue-*`.
- A new domain visual or layout piece joins the allowlist or the layout module on purpose, in review. Everything else uses a design component.
