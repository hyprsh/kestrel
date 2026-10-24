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
// `make lint-web` runs `npm --prefix web run chrome` (web/scripts/chromeCheck.ts) over the SPA source, tests
// excluded. In any string in a .ts or .tsx file, outside this module, these class tokens fail, with any
// variant prefix (`hover:`, `max-sm:`, `[&_.x]:`):
//   rounded-*  border-*  shadow-*  ring-*  bg-*  divide-*   (and the bare `rounded`, `border`, `shadow`, `ring`, `divide`)
//   !-important utilities (`!w-full`, `max-sm:!bottom-4`)
//   arbitrary `.hy-*` selectors (`[&_.hy-scroller__content]:w-full`)
// Layout utilities (flex, gap, p-*, w-*, text-*, label-*) are fine anywhere. The message names the file,
// line and class. The fix is a design component (with its props), or a piece from this module.
//
// THE MARKER
// A file may opt out with one comment line in the comment block at the top of the file, before any code
// (the very first line is the usual place):
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
