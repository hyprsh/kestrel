# Requests from Plex Watchlists, Watch-ahead for Series, and marks in Plex

Note: this builds on ADR 0018. The Requesters, the owner's token and the `plex_sign_in` section are the ones it introduced.

People who share the household's Plex server already keep a Plex Watchlist of what they want to watch. Asking them to repeat that in Kestrel's request screen is a step most skip. So Kestrel reads the Watchlists itself and turns each title newly added to one into a Request, and once a requested Title is in, it marks it in Plex so the person sees it there.

Kestrel reads Watchlists with the server owner's token, which it already holds (ADR 0018). That token reads the owner's own Watchlist and the Watchlist of every Plex friend whose Watchlist is visible to friends in their Plex privacy settings. Only the owner and friends who may request under `plex_sign_in` (access, then the users list) are read. A Watchlist Request is an ordinary Request with the source `plex_watchlist` and the Plex account as the requester. It asks for what a Requester's Request from the UI asks for: the Standard Slot under Profile resolution, into the person's Root folder when one is set, and for a Series what Watch-ahead says below. So deduplication, My Requests, the admin's Requests screen and the Log treat it like any other.

Watchlist sync is a Background job (ADR 0007), every 10 minutes. Its state is one row per Watchlist entry: the Plex account, the Plex guid, the TMDB or TVDB id it resolved to, when Kestrel first saw it, and the Request it became. The first time sync sees an account, it records that account's Watchlist as a baseline and requests nothing: only titles added after that become Requests.

Marking in Plex is a second Background job. Once a requested Slot is Completed, Kestrel finds the Title's item in Plex and:

- adds the labels `Requested` and `Requested by <name>`, one per requester, and keeps a smart collection named `Requested` on the `Requested` label in each library section it marked. The admin decides where that collection shows, such as Home and Friends' Home.
- stamps a "Requested" badge onto the item's poster, for 30 days by default, then puts the original poster back. The badge names no one, since everyone with access sees it.

The job's state is one row per marked Title: its Plex item, when it was labelled, when the badge went on and when it comes off, and the poster it replaced. Plex scans asynchronously, so an item Plex does not list yet is simply tried again on the next pass.

## Watch-ahead

A requested Series is often abandoned after a few episodes, and downloading every season up front wastes disk and indexer calls. With Watch-ahead, a Requester's Request for a Series (a Watchlist Request or one from the Requester UI) asks for season 1 only, also when a later season is airing. Then, once anyone with access to the Plex server has watched 2 episodes of the newest season the Request holds, Kestrel adds the next season to that same Request. Seasons are counted by TVDB number, specials (season 0) are never added this way, and a next season TVDB does not list yet is added once it does. The admin adding a Series is unchanged.

Kestrel reads who watched what from the Plex server's play history with the owner's token, which covers every account on the server. Watch-ahead is a third Background job: it remembers how far into each Plex history it has read, and decides from the Request's seasons and the episodes played, so a missed pass loses nothing.

## Switches

All of it is switched in the `plex_sign_in` section: `watchlist` turns Watchlist sync on, `watch_ahead` Watch-ahead, `labels` the labels and collection, `poster_badge` the badge and `poster_badge_days` how long it stays. Each is off until set; with `watch_ahead` off, a Requester's Series Request asks for the whole Series as before.

## Considered Options

- **Store each Requester's token and read their Watchlist with it.** Rejected because ADR 0018 deliberately keeps no Requester's token, and a plex.tv token is a key to the whole account. It would cover Plex Home members and private Watchlists, which the owner's token does not.
- **Plex's Watchlist RSS feeds.** Rejected as the source because the friends' feed does not say whose Watchlist an entry is on, so a Request could not carry who asked, and it needs Plex Pass. It may come back as a trigger to sync sooner.
- **Request everything already on a Watchlist when sync is switched on.** Rejected because a Watchlist collects years of "maybe some day", and switching the feature on should not start dozens of downloads at once.
- **Withdraw the Request when a title leaves the Watchlist.** Rejected because a Request never changes or removes a Version, and people take a title off their Watchlist once they have watched it.
- **Placeholder items in Plex for titles not in yet.** Rejected because they would be files in the library that no Version holds. Until a title is in, the person sees it on their own Plex Watchlist and in My Requests.
- **Watch-ahead counting only the requester's plays.** Rejected because a household shares Series: whoever watches it is a reason to have the next season.
- **Watch-ahead on finishing a season, or half of it.** Rejected because the next season would often not be in yet when it is wanted. Two episodes is the sign someone stayed with it, and gives the download a head start.
- **Starting with season 1 plus the airing season.** Rejected to keep one rule: seasons come in order as people watch.
- **Labels only, or the badge only.** The household wanted both: the labels make a collection to browse, and the badge is what people notice.

## Consequences

- The friends' Watchlist call is not a documented Plex API, so Kestrel keeps it in `plextv` behind one function and treats an unexpected answer as plex.tv being unavailable, not as an empty Watchlist.
- A friend whose Watchlist is private, and a managed Plex Home member, gets no Watchlist Requests. Kestrel cannot tell a private Watchlist from an empty one.
- A Plex guid is resolved to a TMDB id for a Movie and a TVDB id for a Series through Plex's metadata. An entry that resolves to neither is kept and not requested, so it is not looked up again on every pass.
- Kestrel now writes to the Plex server: labels, a collection and posters. Switching `labels` or `poster_badge` off takes back what Kestrel added on the next pass, and only that.
- A poster Kestrel replaced is put back only if the item still shows Kestrel's badge, so a poster someone chose by hand in the meantime is kept.
