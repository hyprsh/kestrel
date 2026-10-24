# Coding standards

Judgement calls for writing and reviewing Kestrel code. Mechanical rules are not here: `make lint-web` enforces them (see `web/src/layout/conventions.ts`).

- **One helper per job.** Reuse `src/loading.tsx` for delayed loading, the sizes in `src/poster.tsx` for posters, and an existing `src/layout` piece before adding a new one. Grep before writing a helper, because a second copy drifts from the first.
- **Interface text uses `GLOSSARY.md` terms.** Write "Root folder", not "Folder", so the screen and the docs name things the same way.
- **Adopting a design component keeps every behaviour the screen had.** That covers keyboard shortcuts, accessible names and visuals the ticket does not mention (the Agenda's rail dots, for one). A user notices what vanished, and a ticket's silence is not a request to drop it.
- **A `role="option"` or listbox row holds no focusable control.** Delegate clicks from the list, so Tab keeps one stop and `aria-activedescendant` stays valid.
- **A row list is `Entity.List`.** That means rows with their own layout, actions or status. A plain `ul` is for prose lists and small groups, such as file names or buttons.
- **A change stays in its ticket's area.** When it needs an edit elsewhere, call that edit out in the PR so the reviewer looks at it on purpose.
