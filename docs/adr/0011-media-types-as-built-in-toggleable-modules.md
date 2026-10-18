# Media types are built-in modules, toggled per instance, not plugins

Each media type Kestrel manages (Movies and Series today, Music and Audiobooks later) is a module compiled into the binary that an instance switches on or off, first in the setup wizard and later in settings. A module owns everything stateful about its type: its kind of Title and its tables, its reconcilers, its fixed naming scheme, its Profiles and Custom Formats, its library pages and its wizard steps. What varies by provider stays behind plugin contracts, as ADR 0008 has it: indexers and download clients as now, plus metadata providers per type (such as MusicBrainz and Deezer for Music, or an Audible-based source for Audiobooks), and other sources (such as a yt-dlp plugin, #72). We chose modules over media-type plugins because a media type is mostly state and domain rules, while ADR 0008 keeps plugins stateless and data-only, and because one binary with one schema keeps upgrades, migrations and the domain language in one place.

## Considered Options

- **Media types as plugins.** A Music or Audiobooks plugin bringing its own tables, reconcilers and UI. Rejected because it breaks ADR 0008 (plugins keep no state), would need a plugin-owned schema and migrations, and a UI extension point, all for a second plugin author that doesn't exist yet.
- **Everything always on.** Rejected because most instances want only some types, and every type shown but unused adds wizard steps, empty pages, health checks and background lookups (MusicBrainz at 1 request/s, for instance) for nothing.
- **A separate app per type**, as the *arr suite does. Rejected because Kestrel exists to be one app.

## Consequences

- The wizard asks which media types to manage before any type-specific step. Movies and Series are on by default, and new types are off until chosen. Only the steps, pages, Profiles and reconcilers of enabled modules appear and run.
- Switching a module off hides it and stops its reconcilers, but keeps its data, so switching it back on resumes where it was. Deleting a type's data is a separate, explicit action.
- Every module's tables and migrations ship in the binary, whether or not it's enabled, so the schema is the same on every instance.
- A new media type is added in the codebase, with its glossary terms and an ADR for its metadata sources, as ADR 0002 is for Movies and Series.
- A provider for an existing type is added as a plugin under that type's metadata contract, without touching the module.
