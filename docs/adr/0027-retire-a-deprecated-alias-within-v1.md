# Retire a deprecated alias within v1

Amends ADR 0009. Follows the precedent of ADR 0024.

ADR 0009 makes changes within `/api/v1` additive only. Kestrel has no API consumers outside its own SPA, the Silo plugin and the demo, so that rule costs more than it protects when it keeps a deprecated alias alive for ever. The rule for retiring one: an alias that a release marks deprecated, and whose Upgrade Steps tell people to switch, may be removed in a later release, provided the removal is listed under Breaking Changes and Upgrade Steps in that release's notes, and a request that still uses the alias is refused with a `422` problem that names the field. The spec drops the alias; it does not keep it as an undocumented special case. This is a documented exception to ADR 0009, on the same ground as the exceptions in ADR 0024. It covers deprecated aliases only; any other breaking change to `/api/v1` still waits for `/api/v2`.

The first case is `uhd`, the old name for a Profile's 4K resolution. Responses have said `4k` since 0.13.0, whose Upgrade Steps asked people to switch requests to `4k`. In 0.14.0 the `ProfileResolutionInput` schema is gone, requests use `ProfileResolution` (`hd`, `4k`, `any`), and `POST /profiles` with `resolution: uhd` answers `422` naming `resolution`. The Config File already rejected `uhd`, so nothing changes there.

## Considered Options

- **Keep the alias until `/api/v2`.** Rejected: it leaves a second spelling in the spec, the generated code and every client for years, to protect consumers who don't exist.
- **Accept `uhd` silently and never document it.** Rejected: the contract would no longer say what the server does.

## Consequences

- A script that sends `uhd` gets a `422` and must send `4k`.
- Later deprecated aliases follow this rule: deprecate and announce in one release, remove in a later one, list the removal in Breaking Changes.
