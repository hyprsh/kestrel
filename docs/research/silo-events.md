# Silo events: can they tell Kestrel a Request was cancelled or a Title deleted

Answers hyprsh/kestrel issue #90. Short answer: no. Silo publishes no event for a cancelled Request or a deleted Title, and its rules mean a Request cannot be cancelled, declined or deleted once Kestrel has been handed it.

## Sources

- **SDK:** `github.com/Silo-Server/silo-plugin-sdk` v0.28.0, read from the Go module cache. Cited as `sdk:<path>`.
- **Silo server:** `github.com/Silo-Server/silo-server`, `main` at `d31eecb8010d1aabba92d55e819c398fd98fc76b` (committed 2026-10-31), shallow clone, nothing run. Cited as `silo:<path>`.
- "Silo request" below means Silo's `media_requests` row, which Kestrel's Request router capability serves. Domain words follow `GLOSSARY.md`.

## Which events a plugin can subscribe to

Silo documents no list of core event names. `sdk:docs/runtime-host.md` ("Receiving events") covers delivery only, and `sdk:proto/silo/plugin/v1/event_consumer.proto` defines `HandleEventRequest{event_name, payload, event_id}`. The names come from the code, in `silo:internal/plugins/event_dispatcher.go`. A subscription matches an event when its `subscriptions` entry equals the event name, from two sources:

1. **Bus events** (`ObservePublish`): the `Type` of any `cache.Event` published on the catalog, admin or playback channel. The constants are in `silo:internal/cache/redis.go`: `scan_complete`, `metadata_updated`, `catalog_item_changed`, `user_deleted`, `user_disabled`, `settings_changed`, `policy_changed`, `plugins_changed`, `markers_updated` and similar. The payload is the bus string, decoded as JSON when it is JSON (for example `catalog_item_changed` carries a bare content id).
2. **Hub events** (`consumeHub`): any `events.Envelope` published on this server that is not `V2Only`, matched on `Envelope.Event`. These include `catalog.item.changed`, `catalog.library.changed`, `library.changed`, `library.item_added`, `metadata.updated`, `job.*` (`silo:internal/notifications/hub.go`) and `notification.created` (`silo:internal/notifications/dispatcher.go`). The payload is the envelope's JSON `data`.

Both paths deliver at least once with a stable `event_id`, with no ordering, and an event is lost if its server stops before storing it or if the intake queue (1024) is full.

## Request events

Silo does not publish Request transitions on the bus or the hub. `silo:internal/requests` has no `Publish` call. A transition is written to the `media_request_events` table (`recordEvent` in `repository.go`) and, for submit, approve and decline, passed to `LifecycleNotifier` (`silo:internal/requests/notify.go`).

| Transition | Event a plugin can hear | Notes |
|---|---|---|
| Cancelled (`Service.cancel`) | None | Not on the `LifecycleNotifier` interface, which has only `RequestSubmitted`, `RequestApproved` and `RequestDeclined`. |
| Declined (`Service.Decline`) | `notification.created`, indirectly | `RequestDeclined` creates a notification for the requesting Profile, and the websocket dispatcher publishes it on the hub. Its payload is `PayloadForRow`: `type` is `request.declined`, and `reason_flags` is `RequestFlags` with `request_id` (the Silo request id), `tmdb_id`, `media_type`, `title`, `year` and `reason`. It exists only when the request has a requesting Profile with notifications enabled, so it is not a reliable signal. |
| Approved, submitted, fulfilled | Same route (`request.approved`, `request.fulfilled`) | Not needed here. |
| Deleted | None | Silo has no request delete route. The one `DELETE FROM media_requests` (`repository.go`) removes the requester's own `failed` requests for the same title when they ask again. |

### Cancel and decline cannot reach a Request Kestrel holds

`Service.Cancel` and `Service.Decline` both use `guardWithdrawable` (`silo:internal/requests/types.go`). Its comment says: "Decline and cancel accept these; once a submission is in flight or a target exists, the request stays in the pipeline." `guardCondition` in `repository.go` enforces it: an approved request is withdrawable only while it has no submit lease and no row in `media_request_targets`. A `media_request_targets` row is what `Fulfill` returns (`FulfillResponse.targets`). So once `Fulfill` has returned targets, Silo refuses a cancel or decline. `AdminCancel` also closes a `failed` request, but a failed request is already over.

So the cases the ticket describes, a requester cancelling or an admin denying "after approval", are refused by Silo once Kestrel has a target. Before that, Kestrel holds nothing to stop.

One gap is not settled by the source I read: a `Fulfill` call that fails or times out after Kestrel created something, while Silo has no target yet. Silo may then let the request be cancelled, and Kestrel would keep that Request. `silo:internal/requests/service.go` (`submitAfterCommit`) was not traced for this.

## Title (catalog item) deleted

No event names a deleted Title. The nearest are:

- `library.changed` and `catalog.library.changed`: `missing` is a count with `library_id` and no item ids (`libraryChangePayload` in `silo:internal/notifications/hub.go`).
- `catalog.item.changed` and `catalog_item_changed`: `change` is always `metadata_updated` in the source (the only values set are in `libraryingest/executor.go` and `adminjob`). The bus form carries a content id only.
- `scan_complete`: a scan folder id.

A "missing" file after a scan is also not a delete of a Title. Silo's catalog ids are its own content ids, and none of these payloads carries a TMDB or TVDB id.

## Does a consumer get a Kestrel connection

No. `HandleEventRequest` carries only `event_name`, `payload` and `event_id`. The Kestrel base URL and API key reach the plugin as a `RouterConnection` on each request router call (`FulfillRequest.connections`, `sdk:proto/silo/plugin/v1/request_router.proto`), and the router header says "the plugin stores no credentials". An event consumer would need its own settings through `runtime.WithConfigure` (`sdk:README.md`, "Auth providers"), such as a global config entry. I did not check how the admin sets such an entry for a plugin that has no auth provider capability.

## What each event could do

Only `notification.created` with `type: request.declined` could drive an action, and Silo's guard means it only ever concerns a Request that has no Kestrel targets. Nothing in Kestrel would need to change for it.

## Conclusion

No usable event exists for the two cases in the ticket. Close #90 as not possible, with the facts above. If Kestrel wants to learn that a Request is gone, the supported way left is polling: `CheckStatus` already runs while a Request runs, and Silo calls it for each target it still tracks.
