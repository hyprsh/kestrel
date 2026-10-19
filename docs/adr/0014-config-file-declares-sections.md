# A Config File may declare sections, overriding the UI for those sections

Kestrel still takes its bootstrap settings from environment variables and keeps everything else in SQLite, set in the UI, unless a deployment names a Config File with `KESTREL_CONFIG_FILE`. The Config File may declare the account, the language and region, the root folders, the Profiles, plugin instances, the reverse proxy and the GitHub update check. Every section is optional. At startup, after the store opens and before the reconcilers run, Kestrel validates the whole file through the same rules the API uses, then brings each declared section to the file's state. While a section is declared, the UI and the API can't change it: writes answer 409 naming the file, and reads report `from_config_file`. We chose this because deployments such as hyprsh/cloud want Kestrel set up the same way every time, and until now they did it by driving the HTTP API after boot with a long script that reads every answer back and diffs it. It extends what `KESTREL_API_KEY` already does for the API key.

## Considered Options

- **Keep driving the API from outside.** Rejected because every deployment re-implements the same create-or-update-then-diff logic, and the UI can silently drift from what the script last set.
- **Seed once, then hand over to the UI.** Rejected because a seeded value the UI later changed is no longer what the deployment declared, and the next deploy can't tell drift from intent.
- **Environment variables per setting.** Rejected because root folder lists, Profiles and plugin instances with their configs don't fit flat variables.

## Consequences

- A section is declared or not as a whole: there are no read-only fields inside a section the UI otherwise manages. A declared plugin instance is read-only as a whole, `enabled` included, so switching one off means a file change and a restart.
- Profiles are declared together or not at all, because rules such as one default per Slot span Profiles.
- Plugin instances are known by name. Kestrel records which instances the file declared, deletes a declared instance once it leaves the file, and never touches instances created in the UI. Renaming a declared instance in the file deletes it and creates a new one. Declared names can't be taken in the UI.
- On the first start, a UI-created instance with a declared name and the same plugin is taken over rather than duplicated. Anything ambiguous fails startup.
- The Config File never holds a secret value: a secret is named by its environment variable.
- A section that leaves the file goes back to the UI and keeps the value the file last set.
- An invalid file, or a declared instance that would break a contract's enabled cap, fails startup. A declared instance that can't reach its service at startup is only logged.
