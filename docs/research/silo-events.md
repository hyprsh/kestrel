# Silo events: can they tell Kestrel a Request was cancelled or a Title deleted

Answers hyprsh/kestrel issues #90 and #252. Short answer: no. Silo publishes no event for a cancelled Request or a deleted Title, and its rules mean a Request cannot be cancelled, declined or deleted once Kestrel has been handed it.

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

One gap was left open here and is answered in "Cancel after a failed Fulfill" below: it can happen.

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

## Cancel after a failed Fulfill

Answers hyprsh/kestrel issue #252. Short answer: yes, it can happen. Silo commits the approval before it calls `Fulfill`, and a `Fulfill` that errors leaves the request approved with no target, which Silo lets the requester or an admin cancel or decline. Kestrel's side is safe to repeat, but nothing tells Kestrel to stop. Read at `silo:internal/requests` on the same commit as above (`d31eecb8010d1aabba92d55e819c398fd98fc76b`).

### Does Silo commit before it calls Fulfill

Yes. Approval, by an admin or by policy at submit, is committed first. Then `submitAfterCommit` (`service.go`) runs `submitApprovedRequest`. Its comment says the approval stands whatever happens next, so a submission error is only logged and "the reconcile pass retries the submission anyway". Retry (`Service.Retry`, admin) reopens a `failed` request and goes the same way.

The submission claim is a lease. `ClaimSubmission` (`repository.go`) sets `submit_lease_until` 10 minutes ahead (`submitLease`, `service.go`) and counts `submit_attempts`. The Silo request is `approved` and `active` the whole time. `recordTargets` writes the `media_request_targets` rows only after `Fulfill` returns, and `RecordSubmission` (`targets.go`) then releases the lease. There is no state between "claimed" and "has targets" that records that a Kestrel Request may exist.

What `Fulfill` leaves behind:

| Outcome of the call | Silo state afterwards |
|---|---|
| Returns targets | Targets stored, status `queued`. Cancel and decline refused. |
| Returns no targets (Kestrel refuses with 422, or a message only) | `markSubmissionFailed`: outcome `failed`, no targets. Already over for the requester. |
| Returns an error, or the call times out | `DeferSubmission`: lease cleared, `next_submit_at` set, `last_error` set, still `approved` and `active`, no targets. |
| Silo dies mid-call | Lease stays until it expires (10 minutes), then reconcile claims it again. No targets. |
| Kestrel created the Request but Silo failed to store the targets | Same as an error: no targets. |

In a routed setup (`submitRouted`) with more than one tier, an error on a later tier after an earlier one returned targets is recorded as that tier's failure, not retried. The gap is the first call: an error with no targets yet returns the error and retries the whole submission.

### Does Silo retry, and with which id

It retries, and the id does not travel. `ReconcileRequests` runs every 5 minutes and calls `submitApprovedRequest` for each `approved` request. It retries with backoff of 5 minutes doubling to 1 hour (`submitBackoff`), up to 10 claimed attempts (`maxSubmitAttempts`), about six hours. After that the request is `failed` and an admin may retry or close it.

Silo does not send its request id. `routerDescriptor` (`provider.go`) builds the `RequestDescriptor` from the external ids, title, year, anime flag, requester identity and seasons, and `sdk:proto/silo/plugin/v1/request_router.proto` has no request id or idempotency field in `RequestDescriptor` or `FulfillRequest`. So Kestrel cannot be idempotent on Silo's request id.

Kestrel is already idempotent without it. `idempotencyKey` (`internal/silo/router.go`) builds `SourceRequestID` from the requester, media type, Title, seasons, Slots and Root folder, and its comment says a repeated Fulfill must land on the same Kestrel Request. A retry of the same Silo request therefore reuses the Kestrel Request the failed call may have created.

### Can the requester or an admin cancel, decline or delete it

Cancel and decline: yes, in the deferred state. `guardWithdrawable` accepts `approved` and `active` with `UnsentOnly`, and `guardCondition` (`repository.go`) refuses only a row that has a live lease or a target row. After `DeferSubmission` the lease is NULL and there is no target, so `Service.Cancel` (the requester or an admin), `AdminCancel` and `Service.Decline` (admin) all succeed. The types.go comment for the guard names this state: "backing off after a failed attempt". The same holds once a dead server's lease has expired. While an attempt is running its lease blocks them, so a call that hangs for the whole timeout narrows the window but does not remove it.

Delete: no, as in the first section. There is no delete route.

Cancel is Silo-local. `cancel` and `SetOutcome` only set outcome `cancelled`, record the event and forget the title's follows. Nothing calls the router, and `Router` has no cancel method (`provider.go`: `Fulfill` and `CheckStatus`). The reconcile pass skips a request that is no longer `active`, so Silo stops retrying and does not ask Kestrel anything.

### So can the case happen

Yes, with this chain: Kestrel's `createRequest` succeeds but Silo does not get the answer (timeout, dropped connection, Silo restart, or a database error storing the targets). Silo defers. Within the backoff the requester cancels. Kestrel now holds a Request that no Silo request points to. Kestrel is not told, because no event or call exists for it (see above), and `CheckStatus` is only called for stored targets, so there are none to poll.

How likely: it needs a failure after Kestrel has committed, inside a window of at least 5 minutes of backoff, and a cancel in that window. It is a narrow race, not a normal path. The cost is a Kestrel Request nobody wants, which Kestrel would search for and may download. Two softening facts: a later request for the same Title by the same user lands on the same Kestrel Request through the key, and an admin can still end the orphan in Kestrel's own UI.

### Proposed follow-up ticket

Not filed, per the ticket.

**Title:** Silo cancel can orphan a Kestrel Request created by a failed Fulfill

**Body:**

Silo commits an approval before it calls `Fulfill`. When `Fulfill` errors or times out after Kestrel created its Request, Silo keeps the request `approved` with no target and retries with backoff (5 minutes up to 1 hour, 10 attempts). In that state the requester or an admin can cancel or decline it (`guardWithdrawable` in `silo:internal/requests`, commit `d31eecb`), and Silo then neither retries nor tells Kestrel. Kestrel keeps a Request nobody wants. See `docs/research/silo-events.md`, "Cancel after a failed Fulfill".

Silo's `RequestDescriptor` has no request id, so Kestrel cannot key on one. It already repeats safely on its own key (`idempotencyKey`).

Smallest fix on Kestrel's side, with no Silo change: expire a Request that came from Silo and that no `CheckStatus` has asked about. Concretely, when a Request with `Source: "silo"` has had no `CheckStatus` call for longer than Silo's whole retry span (about 6 hours plus the 10-minute lease), treat it as orphaned and end it the way a rejected Request ends. Silo calls `CheckStatus` for each stored target while the request runs, so a Request with a Silo target is polled and never expires. A Request whose targets were never stored is not polled. Open points for the owner: whether Kestrel ends the Request or only flags it for the Operator, and where the "last polled" time is kept.

Silo-side alternatives, for the owner to raise upstream: add a request id (or an idempotency key) to `RequestDescriptor`, and give `Router` a `Cancel` call that `cancel` makes after a deferred submission. Both change the plugin contract.

Acceptance:
- [ ] A Silo-sourced Request with no `CheckStatus` for the retry span is ended or flagged, with a test using a fake clock.
- [ ] A Silo-sourced Request that is polled is never expired.
- [ ] The Request's history says why it was ended.
