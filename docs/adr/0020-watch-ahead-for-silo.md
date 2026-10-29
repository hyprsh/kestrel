# Watch-ahead for Silo

Note: this builds on ADR 0019, whose Watch-ahead read play history from the Plex server only. The `silo` plugin, the media server and request router that Kestrel already talks to, is the second source.

A Series requested in Silo asks for every season at once, and the household abandons Series there as often as on Plex. So Watch-ahead reads Silo's playback history as well, and a Silo Series Request can come one season at a time.

Kestrel reads Silo's `GET /api/v2/admin/playback-history` with the Silo media server's admin API key, the key the plugin instance already holds. It lists the completed plays across every account and profile, newest first, takes an `ended_after` filter and gives each episode's season and episode numbers. Watch-ahead reads it through the same `PlayHistory` contract as Plex's history, and an episode is resolved to its series' TheTVDB id with `GET /api/v2/catalog/items/{id}`: its `series_id`, then that item's `tvdb_id`. Silo's catalog answers only for a profile of the key's account (`X-Profile-Id`), so Kestrel acts as that account's primary profile, read from `GET /api/v2/profiles`, or else one with no parental limit, so no restriction hides an item.

Watch-ahead reads every source that is switched on: the Plex instance `plex_sign_in` names while its `watch_ahead` is on, and the Silo instance the `silo` section names. Plays from all of them go into the same table by TheTVDB id, so a Request advances whoever watched the Series, on either server, as ADR 0019 says. Each instance keeps its own place in its history. One that cannot be read does not stop the others: the pass still advances Requests from the plays it has and reports the first error.

## Switches

The `silo` section holds `instance`, the `silo` plugin instance whose history is read, and `watch_ahead`. `watch_ahead` is the default for a Silo Series Request that names no seasons, and needs `instance`. Off, a Silo Request asks for the whole Series as before.

The Request API takes an optional `watch_ahead` on `POST /requests`. `true` asks for the Series one season at a time, `false` for the whole Series, and left out takes the source's default: `watch_ahead` of the `silo` section for source `silo`, off for any other source. The Silo plugin's Watch-ahead option (Kestrel default, On or Off, overridable per Silo request route) sends it, so one route can differ from the rest. A Request that names seasons ignores it.

A Silo user can still request the remaining seasons of a Series in Silo (the plugin supports seasons), and those come at once: the Request then names seasons, which Watch-ahead leaves alone.

## Considered Options

- **A Silo `event_consumer.v1` subscription for playback events.** Rejected because the core playback event names are not documented, and Silo retries a delivery for about 20 minutes only, so a Kestrel that is down for longer loses plays. Reading the history from a remembered point loses none.
- **Silo's `watch_sync_provider.v1`.** Rejected because it is linked per profile: each person would have to link their account to Kestrel, which Watch-ahead's "whoever watches it" does not need.
- **Silo's Webhook Sync.** Not an option: it only receives watch state from other servers and sends nothing out.
- **Counting only Silo plays for Silo Requests.** Rejected for the reason ADR 0019 gives: a household shares Series, and where it is watched does not matter.
- **Renaming the Plex-named tables.** Not done: `plex_history_position`, `plex_shows` and `watch_ahead_plays` are already keyed by plugin instance or TheTVDB id, and a rename would be churn with no change in behaviour.

## Consequences

- Watch-ahead for Silo needs the Silo server to be reachable with the admin API key, and Silo to have TheTVDB ids for its series. A series without one never counts, as a Plex show without one does not.
- A Silo instance named in the `silo` section is read even when no Silo Request ever used Watch-ahead, as long as a Watch-ahead Request exists: its plays can advance a Plex Requester's Request too.
- The `silo` section is read by Kestrel only; the Silo plugin learns nothing from it beyond the `watch_ahead` it is sent on each Request.
