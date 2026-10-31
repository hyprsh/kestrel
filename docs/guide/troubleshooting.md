# Troubleshooting and FAQ

Start with the Overview. Its **Happening now** list (which holds Needs attention) and the **Health** pill, which opens the Health screen, name most problems in plain words, and the [Log](#where-are-the-logs-and-backups) says what Kestrel did and why. This page covers the ones that come up most.

## A download is stuck

Needs attention says "Download of … is stuck". Kestrel flags a Grab when the download client has it paused, or when its downloaded amount hasn't grown for an hour. It clears by itself as soon as the download moves again. The row offers two buttons:

- **Search Again** cancels the download, puts the Release on the Blocklist and searches for the next best Release.
- **Cancel download** cancels it and removes its job and files from the download client, without blocklisting the Release.

Whoever requested the Title sees "Taking longer than usual".

## Silo stopped asking about a Request

Needs attention says "Silo stopped asking about the Request for …. It may have been cancelled in Silo." Silo polls Kestrel for each Request it made, and this one hasn't been polled for over six hours. Choose:

- **Open the Request** to look at it in Requests.
- **End** to close it as a rejected Request is closed. Kestrel stops asking for it on Silo's behalf, but the Title and its Versions stay Wanted, since someone else may want them too.
- **Dismiss** to hide the row. It comes back if Silo goes quiet again.

## Imports are copied, not hardlinked

You see this warning in Needs attention: "Imports into /data/media/movies are copied, not moved: the download folder is on another filesystem."

A hardlink is a second name for the same file, so an Import takes no extra space and the download can keep seeding or cleaning up on its own. It only works inside one filesystem. When downloads and library sit on different mounts, Kestrel falls back to a verified copy. Nothing fails, but each Import uses double the space until the download is cleaned up.

To fix it, put both under one mount, the way [Getting started](getting-started.md#the-data-layout) shows:

- Mount the same host folder as `/data` in Kestrel and in SABnzbd, not `/downloads` and `/movies` as separate volumes.
- Point SABnzbd's completed folder at a folder inside that mount, such as `/data/usenet/complete`.
- Keep your root folders inside it too, such as `/data/media/movies`.

On Docker, two bind mounts of folders on the same disk are still two mounts. Mount their common parent once.

## Kestrel can't find a finished download

SABnzbd tells Kestrel where a download finished, as a path inside SABnzbd's container. Kestrel opens that same path. If the two containers mount the data folder at different places, the Import stalls.

Mount it at the same container path in both, `/data` in the examples. Kestrel doesn't map paths.

## Permission denied, or a folder is not writable

Needs attention says "Root folder /data/media/movies is not writable", "does not exist (is the drive mounted?)" or an Import fails with "permission denied".

- **A missing folder** is usually a drive that isn't mounted. Mount it and the warning clears within five minutes.
- **A folder Kestrel can't write to** belongs to another user. Kestrel runs as `PUID` and `PGID` (both `1000` by default). Find your own numbers with `id` on the host, set both in Kestrel's and SABnzbd's `environment`, and make sure they own the data folder:

  ```sh
  sudo chown -R 1000:1000 /srv/data
  ```

- **Files Kestrel writes can't be read by Plex or Jellyfin.** Use `UMASK=002` on every container, so files are group-writable, and give your media server the same group.
- **Kestrel can't start and `/config` is the problem.** The entrypoint takes ownership of `/config`. That fails when it is a read-only mount. Mount the Config File [outside `/config`](configuration.md#an-example).

Kestrel never changes ownership of `/data`. That is yours to set.

## Searches and Titles show an error about TMDB or TheTVDB

Kestrel looks up Titles at TMDB (Movies) and TheTVDB (Series). Adding a Title answers `502 upstream_unavailable` when a lookup can't be made. Health shows a warning once a provider has failed for a day, and a blocking one when it rejects the key.

- **If you built Kestrel yourself,** a build has no key embedded. Set `KESTREL_TMDB_API_KEY` and `KESTREL_TVDB_API_KEY`, or enter them in Settings > Provider keys. [Provider keys](configuration.md#provider-keys) lists the order of precedence.
- **If a key is rejected,** check it at the provider and enter it again. A key saved in the UI outranks the variable, so remove a stale one there.
- **If the provider is down,** wait. Nothing is lost, and Kestrel retries.

## An indexer's daily limit

Many indexers allow only so many API requests, and so many downloads, a day. In Settings > Indexers, each indexer has two optional limits:

- **API requests per day:** Kestrel stays under it by pausing searches. Set it a little under your indexer's limit.
- **Grabs per day:** once it is reached, Kestrel stops grabbing from that indexer until the UTC day ends.

If the indexer reports its limits, Kestrel shows them on the Health screen next to the indexer ("18 searches today"). An indexer that says it is rate limiting Kestrel is left alone for as long as it asks.

To stop downloads altogether for a while, such as when you reach a monthly cap, switch on **Pause Grabs** in Settings > Grabs. Searches keep running, so Wanted and Upgrade candidates still show up, but nothing is sent to the download client on its own. A Release you grab by hand still goes through. Switch it off and the next search sweep grabs as usual.

## Nothing is downloading

Check these in order:

1. **Is the Version Wanted?** Open the Title. A Version that is unmonitored, or not released yet (it says "Unreleased"), isn't searched. [Concepts](concepts.md#wanted) says when something counts as released.
2. **Is Pause Grabs on?** See above.
3. **Is Needs attention asking for something?** A Release in your language may have been held back, because the Profile offers Releases that have only the Original Language ([Concepts](concepts.md#profile)). Accept or dismiss it.
4. **Did the search find a Release that scores well enough?** Open the Title and choose Manual search. It lists every Release with its Score, and says why one was rejected. "Grab anyway" overrides most rejections.
5. **Are the download client and indexer healthy?** Health shows each with a status. Settings > Download client and Settings > Indexers have a Test connection button.
6. **Has the indexer run out of API requests or grabs for today?** See above.

## I forgot my password

The only command line Kestrel has resets the admin password and logs every session out. It works while Kestrel is running:

```sh
docker exec -it kestrel kestrel reset-password
```

It asks for the new password. Pass `--password-stdin` to read it from stdin instead.

If a [Config File](configuration.md#the-config-file) declares the account, Kestrel refuses: change the password's environment variable and restart.

## Where are the logs and backups?

- **What Kestrel did:** the Log screen lists every search, Grab, Import and rename with its Title, and you can filter it (try `kind:` and `title:`). Done and Failed Grabs in Activity reach back 7 days. The Log keeps routine events for 30 days.
- **The server's own output:** `docker logs kestrel`. Set `KESTREL_LOG_LEVEL=debug` for more.
- **Database backups:** `/config/backups/` (the host folder you mount as `/config`, then `backups/`). Kestrel copies the database there before each schema migration and keeps the newest five. To go back to one, stop Kestrel and copy the backup over `/config/kestrel.db`. Kestrel never downgrades: a database newer than the binary stops startup and names the backup to restore.
- **Where it keeps everything else:** the database and poster cache are in `/config`. Your media is never in it.

## Common questions

**Does Kestrel do torrents?** No. Kestrel is usenet only, and SABnzbd is the one download client it supports today.

**Does it work with Prowlarr?** Kestrel has no Prowlarr integration. It talks to Newznab indexers directly: add each indexer's Newznab URL and API key in Settings > Indexers.

**Can I change how files are named?** No. Kestrel uses one fixed naming scheme, so that Plex and Jellyfin group a Title's Standard and 4K Versions as one item ([ADR 0003](../adr/0003-fixed-naming-scheme-with-slot-labels.md)).

**Why does a Title have only Standard and 4K?** A Title has at most one Version per Slot, and there are two Slots ([ADR 0012](../adr/0012-two-slots-standard-and-4k.md)). Which one plays, and who may watch 4K, is your media server's choice.

**Can I edit the Scores?** No. Custom Formats and Scores come from [TRaSH Guides](https://trash-guides.info), and Kestrel updates them daily unless you switch that off in Settings > TRaSH. [Moving from Radarr and Sonarr](moving-from-radarr-and-sonarr.md#what-has-no-equivalent) lists what else is different.

**Something else is wrong.** [Open an issue](https://github.com/hyprsh/kestrel/issues) with your Kestrel version (Settings > About) and the Log lines around the problem. Remove API keys first. Report a security problem privately, as [SECURITY.md](../../SECURITY.md) says.
