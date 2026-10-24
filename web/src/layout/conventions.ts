// The layout module and the chrome check (ADR 0017, hyprsh/kestrel#205). Read this before adopting a screen.
//
// WHAT THE MODULE IS
// Kestrel owns its layout: the strips, headers, footers and pages that frame the design components. They live
// here, one file per piece, and there is no index file: import from the piece's own file
// (`import { FilterStrip } from '../layout/FilterStrip'`), so area tickets add pieces without touching each
// other's files. A piece uses design tokens and documented utilities only, takes `children` (and a callback or
// a count where it needs one), and never takes `className`, `style` or any other styling prop. If a screen
// needs a piece to look different, change the piece or add another; do not pass styling in.
//
// THE PIECES
// One file per piece, except where noted: a file that exports two pieces lists both.
//   FilterStrip.tsx       filter/tab strip above a list          <FilterStrip>{tabs, filter field}</FilterStrip>
//   JumpNav.tsx           JumpNav and JumpLink: sticky links     <JumpNav label="Sections"><JumpLink href onClick>{name}</JumpLink></JumpNav>
//                         that jump to sections of the page
//   ListPane.tsx          list column beside a detail pane       <ListPane>{list}</ListPane>
//   PageSurface.tsx       centred card page (Login)              <PageSurface>{form}</PageSurface>
//   Pane.tsx              PaneHeader and PaneFooter: top and     <PaneHeader>{title, controls}</PaneHeader>
//                         bottom of a pane                       <PaneFooter>{status, actions}</PaneFooter>
//   PhoneBackHeader.tsx   Back button and title over a phone     <PhoneBackHeader onBack={...}>{title}</PhoneBackHeader>
//                         screen
//   RowList.tsx           RowList, stackedRow, stackedRight: a    <RowList>{<Entity className={stackedRow} rightClassName={stackedRight} />}</RowList>
//                         list whose rows stack their right content when the list is narrow (container query)
//   Rail.tsx              Rail and RailSpacer: the desktop       <Rail>{icon buttons}<RailSpacer /></Rail>
//                         navigation rail and its gap
//   SectionBlock.tsx      static section with a title and count  <SectionBlock title="Downloading" count={3}>{rows}</SectionBlock>
//   SelectionBar.tsx      count, select-all, Clear and actions  <SelectionBar selection={...} shown={n}>{actions}</SelectionBar>
//                         for a ticked selection
//   TopBar.tsx            TopBar and PhoneTopBar: the app        <TopBar title end>{command box}</TopBar>
//                         header on a desktop and on a phone     <PhoneTopBar title>{actions}</PhoneTopBar>
//   WidePage.tsx          wide, long page of cards (setup)       <WidePage>{cards}</WidePage>
//
// WHAT THE CHECK FORBIDS
// `make lint-web` runs `npm --prefix web run chrome` (web/scripts/chromeCheck.ts) over the SPA source. This
// comment is the rules' single source of truth: a new rule is documented here. Outside this module (and the
// marked files below) the check fails on the following. Each message names the file, line and the fix.
//
// 1. Chrome classes. In any string in a .ts or .tsx file, these class tokens, with any variant prefix
//    (`hover:`, `max-sm:`, `[&_.x]:`):
//      rounded-*  border-*  shadow-*  ring-*  bg-*  divide-*   (and the bare `rounded`, `border`, `shadow`, `ring`, `divide`)
//      !-important utilities (`!w-full`, `max-sm:!bottom-4`)
//      arbitrary `.hy-*` selectors (`[&_.hy-scroller__content]:w-full`)
//      `*-subtle` (`bg-amber-subtle`): use the hue plus `contrast="low"` (ADR 0017)
//    Layout utilities (flex, gap, p-*, w-*, text-*, label-*) are fine anywhere.
// 2. Hand-built elements. An intrinsic (lower-case) JSX element that a design component replaces:
//      button -> Button, or Entity as="button"      a -> Link or ButtonLink
//      input -> Input, Checkbox, Radio, Toggle or Switch      select -> Select      textarea -> Textarea
//      label -> Label      table -> Table      hr -> Separator      dialog -> Modal or Sheet
//      progress -> Progress      kbd -> Kbd or KeyboardInput      code -> Code or Snippet
//      pre -> CodeBlock      svg -> Icon
//    `ul`, `ol`, `li`, `img`, `nav` and `header` are not flagged: CODING_STANDARDS.md says when a list is an
//    Entity.List.
// 3. Hand-built roles. A `role` attribute on an intrinsic element (a design component may take a role, as in
//    `<Note role="alert">`):
//      dialog -> Modal      alertdialog -> DestructiveActionModal      switch -> Toggle
//      tab, tablist -> Tabs      menu, menuitem -> Menu      listbox, option -> Select or Combobox
//      progressbar -> Progress      tooltip -> Tooltip      alert -> Error
// 4. Hand-built overlays. `window.confirm`, `window.alert` and `window.prompt` -> Modal or
//    DestructiveActionModal; `createPortal` -> Toast, Popover or Sheet.
// 5. Tests. In `*.test.ts(x)` and src/test/, `toHaveClass(`, `.className`, `classList` and
//    `querySelector(All)('.` or `('[class`: tests assert what the user sees (role, name, text), not classes.
//    Rules 1-4 do not read tests.
//
// THE LINE EXEMPTION
// A comment on the line directly above exempts that one line from rules 1-3 (and from rule 5 in a test):
//
//   // chrome-ok: <reason>                 in code, or between the attributes of a JSX element
//   {/* chrome-ok: <reason> */}            in JSX children
//
// The reason says why no design component fits, and must not be empty. An exemption whose next line has
// nothing to exempt fails as stale. Prefer a design component; use the exemption for a domain visual (the
// episode grid) or a pattern with no component (a cursor list that is not a picker).
//
// THE MARKER
// A file that is wholly one thing may opt out of rules 1-3 with one comment line in the comment block at the
// top of the file, before any code (the very first line is the usual place):
//
//   // chrome: layout                    only for files in src/layout/; the file is a layout piece
//   // chrome: domain-visual             an allowlisted domain visual (poster frame, Agenda timeline, health
//                                        tile, episode grid); added on purpose, in review
//   // chrome: waiting hyprsh/design#N   a spot that waits for a library change; N is the issue, and the
//                                        marker without it fails
//   // chrome: pending                   not adopted yet; the file must still have chrome, or the check fails
//                                        with "stale marker"
//
// An area ticket that adopts a file removes its `pending` marker in the same change. Adopting means the file
// then has no chrome, so the check passes unmarked; if some chrome remains for a good reason, replace
// `pending` with `domain-visual` or `waiting`, never leave it. Anything else after `chrome:` fails as unknown.
//
// Pieces are not used by screens until their area ticket adopts them, so knip lists `src/layout/*.tsx` as
// entry files (web/knip.json).
export {}
