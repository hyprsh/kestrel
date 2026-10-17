# Live UI state is SSE hints derived from the events log

The UI gets live state over one Server-Sent Events stream, `GET /api/v1/stream`. Most events are `changed` hints (`{resource, id}`): the SPA invalidates its cache on them and refetches the resource over the REST API. `queue` and `activity` events carry snapshots of the in-memory download progress and running loops. The hints come from the `events` log, not from an event bus. An `api` goroutine reads new rows by id about once a second and maps each `kind` to hints. Handlers emit hints for changes made through the API itself, and the `queue`/`activity` snapshots come from polling in-memory state every 2 s. We chose this to keep the rule that calls only go downwards with no event bus (see [Module boundaries, schema and job model](https://github.com/hyprsh/kestrel/issues/15)), while an Import landing in a background loop still reaches an open tab within a second.

## Considered Options

- **A leaf `live` pub/sub module** that every module publishes to. It's an event bus in all but name, and it puts a UI concern into every module. Rejected.
- **WebSocket.** Nothing needs to travel from the client to the server, and it needs a library plus proxy upgrade configuration. Rejected.
- **Polling** `/queue` and `/attention`. It's chatty, and changes elsewhere in the UI, such as an Import landing on an open Title, would lag. Rejected.

## Consequences

- A change made by a background loop that the UI must see has to record an event. Routine kinds count too, because they're only pruned after 30 days.
- The stream never replays. On reconnect, the SPA refetches whatever it's showing, and every streamed state also has a snapshot resource (`/queue`, `/activity`, `/attention`).
- Browsers allow only 6 HTTP/1.1 connections per origin, so the SPA keeps one stream per browser. The tab holding a Web Locks lock owns the `EventSource` and passes events to the other tabs over a `BroadcastChannel`.
