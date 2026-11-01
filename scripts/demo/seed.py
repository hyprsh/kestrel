#!/usr/bin/env python3
"""Seeds a fresh Kestrel for the demo. demo.sh start runs it; run it by hand only on a fresh instance.

    python3 -I seed.py --kestrel URL --db <config>/kestrel.db --media DIR --fake URL --parse BIN

Through the API: the account demo / demo-password-123, English and US, Root folders
<media>/movies, <media>/movies-family and <media>/tv, the fake indexer, SABnzbd and Plex,
Plex sign-in on for Requesters (the fake's Ellie signs in with one click),
setup completed, then Paddington (Standard) and Breaking Bad (Standard and 4K), and without
files Paddington 2, Paddington in Peru, El Camino and Better Call Saul.

Straight into SQLite, since Imports would need real downloads: the files of both,
as empty files on disk, each with its parse and an ffprobe snapshot (English audio, Paddington's German too), so the
file popover shows its video codec, HDR, audio format, group, Score and Custom Formats; the Versions are then switched to their own Profile,
which re-scores the files. Paddington has its 1080p BluRay. Breaking Bad has Seasons 1-4
in Standard (S02E12-E13 is one double-episode file) and in 4K, Season 5 half in
Standard and a quarter in 4K, and one Special. BIN is scripts/demo/parse, which
writes each release name's parsed form as Imports stores it. Then the dates around
today (Upcoming's window) are set in the same way: see "Upcoming looks at" below. Paddington and two
Breaking Bad episodes (S05E07-E08) get an imported Grab each, a day or two old, so Recently added has rows.
Behind them 64 older finished Grabs, one every four days back for most of a year and every fifth failed, give Activity
a history longer than a page to scroll.

For the Overview's statistics, in the same way: about 70 more finished Grabs spread over the last 30 days (a few failed, one
or two a day, from the fake indexers NZBgeek, DrunkenSlug, altHUB and NZBPlanet besides the real one), each with the time the
download client took (12 to 31 MB/s), 25 to 50 searches per indexer with their outcome, whether a Release fit, and how long
they took (altHUB slowest, NZBgeek best), and the Season 5 files of Breaking Bad (all but the two Recently added) and
Paddington's imported as filled by a Grab hours after the episode aired, so Time to fill has a median. Older seasons' files
and the 4K Season 4 ones come from Upgrade Grabs in the range, so Top release groups and the growth of the disk have data.
Season 5's Standard episodes 6 to 8 are WEBRip, so Library quality shows all three classes. Sam and Jo ask for a few
Titles too, with dates moved back, so Requests has several requesters.

Then, through the API again, what the Overview shows besides the Library: with the fake indexer's
releases on for a moment, a manual search and a Grab of Paddington in Peru's Release, which the fake
SABnzbd holds at 40 % (Downloading now, Activity's pipeline); with them off again, two Requests from
Ellie through Plex, one for Paddington 2 (Searching, nothing to find) and one for Paddington
(Completed). Needs attention has one row: Paddington 2, Wanted and Long Missing.

For the Log, straight into SQLite as well: about a week of events, so its strip, day headings and folds have something to show.
Each day has an import, a Grab, a refresh, a request, and two bursts of routine search runs (nothing to grab, mostly) that
fold into one row each. Two Grabs failed (one "encrypted" twice, a day apart, so the opened error lists the earlier one), one
Import was rejected, the download client was unreachable twice (Needs attention raised, one clear), an Import stalled and an
Original Offer came in, so Errors and Warnings have rows and the strip has red and amber columns.
"""
import argparse, datetime, http.cookiejar, json, os, sqlite3, subprocess, time, urllib.error, urllib.request

ap = argparse.ArgumentParser()
ap.add_argument("--kestrel", required=True, help="Kestrel's base URL")
ap.add_argument("--db", required=True, help="Kestrel's kestrel.db")
ap.add_argument("--media", required=True, help="directory the Root folders go under")
ap.add_argument("--fake", required=True, help="fake.py's base URL")
ap.add_argument("--parse", required=True, help="the scripts/demo/parse binary")
args = ap.parse_args()
BASE, ROOT, FAKE = args.kestrel.rstrip("/"), args.media.rstrip("/"), args.fake.rstrip("/")
INDEXER = "Demo Indexer"

op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + "/api/v1" + path, data=data, method=method,
                                 headers={"Content-Type": "application/json", "Origin": BASE})
    try:
        with op.open(req) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raise SystemExit(f"seed: {method} {path}: {e.code} {e.read().decode()}")


for d in ("movies", "movies-family", "tv"):
    os.makedirs(f"{ROOT}/{d}", exist_ok=True)

call("POST", "/setup/account", {"username": "demo", "password": "demo-password-123"})
call("PATCH", "/settings", {"language_region": {"primary_language": "en", "release_date_country": "US"},
                            "root_folders": {"movies": [f"{ROOT}/movies", f"{ROOT}/movies-family"], "series": [f"{ROOT}/tv"]},
                            "check_github_updates": False})
call("POST", "/plugin-instances", {"plugin_id": "newznab", "name": INDEXER,
                                   "config": {"url": FAKE + "/nzb", "api_key": "demo-key"}})
call("POST", "/plugin-instances", {"plugin_id": "sabnzbd", "name": "SABnzbd",
                                   "config": {"url": FAKE + "/sab", "api_key": "demo-key", "movie_category": "movies", "tv_category": "tv"}})
call("POST", "/plugin-instances", {"plugin_id": "plex", "name": "Plex",
                                   "config": {"url": FAKE + "/plex", "token": "demo-owner-token"}})
call("PUT", "/settings/plex-sign-in", {"enabled": True, "instance": "Plex", "users": [], "user_root_folders": []})
call("POST", "/setup/complete")

profiles = call("GET", "/profiles")
items = profiles["items"] if isinstance(profiles, dict) and "items" in profiles else profiles


def default(slot, kind):
    enabled = [p for p in items if p["slot"] == slot and p["enabled"]]
    return next((p["key"] for p in enabled if p.get("default_" + kind)), enabled[0]["key"])


std_m, std_s, k4_s = default("standard", "movies"), default("standard", "series"), default("4k", "series")
call("POST", "/titles", {"kind": "movie", "tmdb_id": 116149, "versions": [{"slot": "standard", "profile": std_m}],
                         "root_folder": f"{ROOT}/movies"})
call("POST", "/titles", {"kind": "series", "tmdb_id": 1396, "series_monitor": "all",
                         "versions": [{"slot": "standard", "profile": std_s}, {"slot": "4k", "profile": k4_s}]})
# Without files, for Upcoming: two Paddington films, El Camino and a Series that has not started.
for tmdb in (346648, 516729, 559969):
    call("POST", "/titles", {"kind": "movie", "tmdb_id": tmdb, "versions": [{"slot": "standard", "profile": std_m}],
                             "root_folder": f"{ROOT}/movies"})
call("POST", "/titles", {"kind": "series", "tmdb_id": 60059, "series_monitor": "none",
                         "versions": [{"slot": "standard", "profile": std_s}]})
time.sleep(2)

db = sqlite3.connect(args.db)
db.row_factory = sqlite3.Row  # columns by name
db.execute("PRAGMA foreign_keys=ON")
tid = {r["tmdb_id"]: r["id"] for r in db.execute("SELECT id, tmdb_id FROM titles")}
ver = {(r["title_id"], r["slot"]): r["id"] for r in db.execute("SELECT id, title_id, slot FROM versions")}
eps = {(r["season"], r["number"]): r["id"] for r in db.execute("SELECT id, season, number FROM episodes WHERE title_id=?", (tid[1396],))}

files = []  # (version id, path, size, release name, score, [episode ids], parse kind)
movie_folder = "Paddington (2014) {tmdb-116149}"
db.execute("UPDATE titles SET folder=? WHERE id=?", (movie_folder, tid[116149]))
files.append((ver[(tid[116149], "standard")],
              f"{ROOT}/movies/{movie_folder}/{movie_folder} - [Standard][Bluray-1080p][x264]-DON.mkv", 8_589_934_592,
              "Paddington.2014.1080p.BluRay.DTS.5.1.x264-DON", 1850, [], "movie"))
series_folder = "Breaking Bad (2008) {tvdb-81189}"
db.execute("UPDATE titles SET folder=? WHERE id=?", (series_folder, tid[1396]))


def ep_file(slot, s, nums, rel, q, size, score):
    code = f"S{s:02d}" + "".join(f"E{n:02d}" for n in nums)
    codepath = f"S{s:02d}E{nums[0]:02d}" + (f"-E{nums[-1]:02d}" if len(nums) > 1 else "")
    sub = "Specials" if s == 0 else f"Season {s:02d}"
    tag = "[Standard][" + q + "][x264]" if slot == "standard" else "[4K][" + q + "][HDR10][h265]"
    grp = rel.rsplit("-", 1)[1]
    path = f"{ROOT}/tv/{series_folder}/{sub}/Breaking Bad (2008) - {codepath} - {tag}-{grp}.mkv"
    files.append((ver[(tid[1396], slot)], path, size, rel.format(code=code), score, [eps[(s, n)] for n in nums], "series"))


counts = {1: 7, 2: 13, 3: 13, 4: 13, 5: 16}
for s in range(1, 5):
    n = 1
    while n <= counts[s]:
        nums = [n, n + 1] if (s, n) == (2, 12) else [n]
        ep_file("standard", s, nums, "Breaking.Bad.{code}.1080p.BluRay.x264-ROVERS", "Bluray-1080p", 2_400_000_000 * len(nums), 1850)
        n += len(nums)
    for n in range(1, counts[s] + 1):
        ep_file("4k", s, [n], "Breaking.Bad.{code}.2160p.WEB-DL.DDP5.1.HDR.H.265-NTb", "WEBDL-2160p", 6_800_000_000, 2400)
for n in range(1, 9):
    ep_file("standard", 5, [n], "Breaking.Bad.{code}.1080p.WEB-DL.DD5.1.H.264-NTb" if n < 6 else "Breaking.Bad.{code}.1080p.WEBRip.DD5.1.x264-NTb",
            "WEBDL-1080p" if n < 6 else "WEBRip-1080p", 1_700_000_000, 1600)
for n in range(1, 5):
    ep_file("4k", 5, [n], "Breaking.Bad.{code}.2160p.WEB-DL.DDP5.1.HDR.H.265-NTb", "WEBDL-2160p", 6_800_000_000, 2400)
ep_file("standard", 0, [1], "Breaking.Bad.{code}.Minisode.1080p.WEB-DL.AAC2.0.H.264-BTN", "WEBDL-1080p", 180_000_000, 900)


def probe_of(f):
    """The ffprobe snapshot Imports store in files.probe (Go field names): frame size by Slot, the codecs, HDR and English audio the release name says
    (DDP is E-AC-3, DTS is DTS, AAC is stereo, a name with no audio token gets AC-3 5.1), Paddington with a German AC-3 track too."""
    name = f[3]
    uhd = "2160p" in name
    codec, channels = ("eac3", 6) if "DDP" in name else ("dts", 6) if "DTS" in name else ("aac", 2) if "AAC" in name else ("ac3", 6)
    audio = [{"Index": 1, "Codec": codec, "Channels": channels, "Profile": "DTS" if codec == "dts" else "", "Language": "eng", "Default": True}]
    if f[6] == "movie":
        audio.append({"Index": 2, "Codec": "ac3", "Channels": 6, "Language": "deu", "Default": False})
    return json.dumps({"Size": f[2], "Duration": 3_000_000_000_000, "HasVideo": True, "Width": 3840 if uhd else 1920, "Height": 2160 if uhd else 1080,
                       "VideoCodec": "hevc" if uhd else "h264", "HDR": "HDR10" if "HDR" in name else "", "Audio": audio}, separators=(",", ":"))


parsed = subprocess.run([args.parse], input="".join(f"{f[6]}\t{f[3]}\n" for f in files),
                        capture_output=True, text=True, check=True).stdout.splitlines()
fe_cols = [r["name"] for r in db.execute("PRAGMA table_info(file_episodes)")]
for (v, path, size, rel, score, epids, kind), pr in zip(files, parsed, strict=True):
    cur = db.execute("INSERT INTO files(version_id,path,size,release_name,parsed_release,probe,score,imported_at) VALUES (?,?,?,?,?,?,?,?)",
                     (v, path, size, rel, None if pr == "null" else pr, probe_of((v, path, size, rel, score, epids, kind)), score, "2026-09-14T18:30:00Z"))
    for e in epids:
        if "version_id" in fe_cols:
            db.execute("INSERT INTO file_episodes(file_id,version_id,episode_id) VALUES (?,?,?)", (cur.lastrowid, v, e))
        else:
            db.execute("INSERT INTO file_episodes(file_id,episode_id) VALUES (?,?)", (cur.lastrowid, e))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "w").close()

# Upcoming looks at a few weeks around today, so the dates are moved there: Breaking Bad's fifth season
# airs again (some of it imported, some Wanted, a long gap, a group and the finale), Better Call Saul starts
# in three days with five episodes still undated, and the films get dates in every state. Both Slots were
# "added" months ago, so a Version Wanted since a release counts from the release.
today = datetime.date.today()


def on(days):
    return (today + datetime.timedelta(days=days)).isoformat()


def stamp(days, **delta):
    """A timestamp: midnight UTC `days` from today, or with delta (hours=...) that long from now, plus days."""
    if not delta:
        return on(days) + "T00:00:00Z"
    return (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=days, **delta)).strftime("%Y-%m-%dT%H:%M:%SZ")


db.execute("UPDATE versions SET added_at='2026-05-01T00:00:00Z'")
# Older builds have no network, status, air time or episode overview to set.
airing = "air_time" in [r["name"] for r in db.execute("PRAGMA table_info(titles)")]
if airing:
    db.execute("UPDATE titles SET network='AMC', tvdb_status='continuing', air_time='21:00', air_timezone='America/New_York' WHERE tmdb_id=1396")
for n, days in {1: -13, 2: -12, 3: -11, 4: -10, 5: -7, 6: -7, 7: -5, 8: -4, 9: -2, 10: -1, 11: 0,
                12: 7, 13: 7, 14: 7, 15: 7, 16: 14}.items():
    db.execute("UPDATE episodes SET air_date=? WHERE id=?", (on(days), eps[(5, n)]))
db.execute("UPDATE episodes SET air_date=?, monitored=1 WHERE id=?", (on(2), eps[(0, 1)]))
if airing:
    for n, over in {10: "Walt and Jesse are out of ideas, and out of time.", 16: "Everything Walter White built comes to an end."}.items():
        db.execute("UPDATE episodes SET overview=? WHERE id=?", (over, eps[(5, n)]))

saul = tid[60059]
if airing:
    db.execute("UPDATE titles SET network='AMC', air_time='22:00', air_timezone='America/New_York' WHERE id=?", (saul,))
db.execute("UPDATE episodes SET air_date=NULL, monitored=0 WHERE title_id=?", (saul,))
for n, days in {1: 3, 2: 3, 3: 10, 4: 17, 5: 24}.items():
    db.execute("UPDATE episodes SET air_date=?, monitored=1 WHERE title_id=? AND season=1 AND number=?", (on(days), saul, n))
db.execute("UPDATE episodes SET monitored=1 WHERE title_id=? AND season=1 AND number BETWEEN 6 AND 10", (saul,))


def release_dates(tmdb, dates):  # US only: type 3 theatrical, 4 digital, 5 physical
    db.execute("DELETE FROM title_release_dates WHERE title_id=?", (tid[tmdb],))
    for typ, days in dates.items():
        db.execute("INSERT INTO title_release_dates(title_id,country,type,date,certification) VALUES (?,?,?,?,?)",
                   (tid[tmdb], "US", typ, stamp(days), "PG"))


release_dates(116149, {3: -40, 4: -9, 5: 12})  # Paddington is imported
release_dates(346648, {3: -150, 4: -100, 5: -10})  # Paddington 2: Wanted since its digital release, long ago
release_dates(516729, {3: -30, 4: -4, 5: 30})  # in Peru: out for four days, Blu-ray still to come
release_dates(559969, {})  # El Camino: nothing announced
# Recently added lists the Imports of the last week, and an Import is a file with a Grab.
indexer = db.execute("SELECT id FROM plugin_instances WHERE name=?", (INDEXER,)).fetchone()["id"]
sab = db.execute("SELECT id FROM plugin_instances WHERE name='SABnzbd'").fetchone()["id"]


def imported(patterns, when, guid):
    """Gives the files whose path matches any of the LIKE patterns one imported Grab, since Recently added and Activity's Done list Grabs."""
    rows = db.execute("SELECT f.id, f.version_id, v.title_id, f.size, f.release_name, f.parsed_release, f.score FROM files f "
                      "JOIN versions v ON v.id = f.version_id WHERE " + " OR ".join("f.path LIKE ?" for _ in patterns) + " ORDER BY f.id",
                      patterns).fetchall()
    first = rows[0]
    # The Grab's verdict mirrors scoring.Verdict (internal/scoring/evaluate.go), whose fields Go encodes by name.
    verdict = {"Accepted": True, "Score": first["score"], "MinScore": 0, "Matched": None,
               "Languages": [{"id": 1, "name": "English"}], "Rejections": None}
    cur = db.execute("INSERT INTO grabs(title_id,version_id,release_guid,release_name,indexer_id,indexer_name,size,published_at,score,"
                     "parsed,verdict,client_instance_id,client_id,state,created_at,updated_at) "
                     "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'imported',?,?)",
                     (first["title_id"], first["version_id"], guid, first["release_name"], indexer, INDEXER,
                      sum(r["size"] for r in rows), when, first["score"], first["parsed_release"] or "{}",
                      json.dumps(verdict, separators=(",", ":")), sab, "SABnzbd_nzo_" + guid, when, when))
    for r in rows:
        db.execute("UPDATE files SET grab_id=?, imported_at=? WHERE id=?", (cur.lastrowid, when, r["id"]))
        for e in db.execute("SELECT episode_id FROM file_episodes WHERE file_id=?", (r["id"],)).fetchall():
            db.execute("INSERT INTO grab_episodes(grab_id,episode_id) VALUES (?,?)", (cur.lastrowid, e["episode_id"]))


# Activity pages Done and Failed as far back as there are Grabs: 64 older ones (no files behind them, like Grabs whose
# files were since replaced), one every four days for most of a year, every fifth of them failed.
older = db.execute("SELECT v.id, v.title_id FROM versions v JOIN titles t ON t.id = v.title_id "
                   "WHERE v.slot='standard' AND t.title IN ('Paddington','Breaking Bad') ORDER BY v.id").fetchall()
for n in reversed(range(64)):  # oldest first, so ids run with time as the list's order does
    v, when = older[n % len(older)], stamp(-(9 + 4 * n))
    failed = n % 5 == 4
    name = f"{'Paddington.2014' if v['title_id'] == older[0]['title_id'] else 'Breaking.Bad.S01E0' + str(n % 7 + 1)}.1080p.WEB-DL.DDP5.1.H.264-OLD{n}"
    db.execute("INSERT INTO grabs(title_id,version_id,release_guid,release_name,indexer_id,indexer_name,size,published_at,score,"
               "parsed,verdict,client_instance_id,client_id,state,failure,created_at,updated_at) "
               "VALUES (?,?,?,?,?,?,?,?,?,'{}','{}',?,?,?,?,?,?)",
               (v["title_id"], v["id"], f"seed-old-{n}", name, indexer, INDEXER, 4 << 30, when, 1200,
                sab, f"SABnzbd_nzo_seed-old-{n}", "failed" if failed else "imported", "download_failed" if failed else None, when, when))
imported([f"{ROOT}/movies/%"], stamp(-2, hours=-3), "seed-paddington")
imported(["%S05E07 - [Standard]%", "%S05E08 - [Standard]%"], stamp(-1, hours=-7), "seed-breaking-bad")

# ---- the Overview's statistics ----
import random

rnd = random.Random(7)
FAKE_INDEXERS = {"NZBgeek": 9001, "DrunkenSlug": 9002, "altHUB": 9003, "NZBPlanet": 9004}  # gone from Settings, as a removed indexer's would be
# (imported Grabs, failed Grabs, searches, Hit rate, median answer in seconds) per indexer
PROFILE = {"NZBgeek": (30, 1, 50, 0.81, 0.6), "DrunkenSlug": (17, 0, 40, 0.74, 0.9), "altHUB": (8, 3, 30, 0.52, 2.4),
           "NZBPlanet": (5, 1, 25, 0.40, 1.1), INDEXER: (2, 0, 6, 0.90, 0.5)}
IDS = {**FAKE_INDEXERS, INDEXER: indexer}
speeds = [18, 22, 25, 12, 28, 31, 24, 20, 26, 27, 15, 23, 29, 24, 21, 19, 25, 26, 14, 30, 22, 24, 27, 23, 20, 28, 25, 22, 26, 24]  # MB/s by day ago, 0 first


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def at_day(days_ago, hour, minute=0):
    d = datetime.datetime.now(datetime.timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    return d - datetime.timedelta(days=days_ago) + datetime.timedelta(hours=hour, minutes=minute)


def finished(version, title, name, ixname, size, when, state, failure=None, is_upgrade=0, file_ids=(), tag="x"):
    """A finished Grab whose download the client took size / speed seconds, ending at `when`; returns its id."""
    speed = speeds[max(0, (datetime.datetime.now(datetime.timezone.utc) - when).days)] * 1_000_000 * rnd.uniform(0.85, 1.15)
    took = datetime.timedelta(seconds=size / speed)
    stamped = state == "imported" or failure == "download_failed"
    cur = db.execute("INSERT INTO grabs(title_id,version_id,release_guid,release_name,indexer_id,indexer_name,size,published_at,score,parsed,verdict,"
                     "is_upgrade,client_instance_id,client_id,state,failure,created_at,updated_at,download_started_at,download_done_at) "
                     "VALUES (?,?,?,?,?,?,?,?,?,'{}','{}',?,?,?,?,?,?,?,?,?)",
                     (title, version, f"seed-{tag}-{when.timestamp():.0f}-{rnd.random():.6f}", name, IDS[ixname], ixname, size, iso(when - took), 1600, is_upgrade,
                      sab, f"SABnzbd_nzo_{tag}{rnd.random():.6f}", state, failure, iso(when - took - datetime.timedelta(seconds=40)), iso(when),
                      iso(when - took) if stamped else None, iso(when) if state == "imported" else None))
    for f in file_ids:
        db.execute("UPDATE files SET grab_id=?, imported_at=? WHERE id=?", (cur.lastrowid, iso(when), f))
    return cur.lastrowid


std_bb = ver[(tid[1396], "standard")]
k4_bb = ver[(tid[1396], "4k")]
pad = ver[(tid[116149], "standard")]


def file_ids(where, *args):
    return [r["id"] for r in db.execute("SELECT f.id FROM files f WHERE " + where + " ORDER BY f.id", args)]


# Grabs hours after the episode aired: Season 5 of Breaking Bad but the two Recently added, and Paddington.
fills = 0
for slot_, versionid, nums in (("[Standard]", std_bb, range(1, 7)), ("[4K]", k4_bb, range(1, 5))):
    for n in nums:
        fid = file_ids("f.path LIKE ?", f"%S05E{n:02d} - {slot_}%")
        air = datetime.date.fromisoformat(db.execute("SELECT air_date FROM episodes WHERE id=?", (eps[(5, n)],)).fetchone()["air_date"])
        when = datetime.datetime(air.year, air.month, air.day, tzinfo=datetime.timezone.utc) + datetime.timedelta(days=1, hours=2 + rnd.randint(1, 7), minutes=rnd.randint(0, 59))
        size = db.execute("SELECT size FROM files WHERE id=?", (fid[0],)).fetchone()["size"]
        finished(versionid, tid[1396], f"Breaking.Bad.S05E{n:02d}.seed", "NZBgeek" if n % 3 else "DrunkenSlug", size, when, "imported", file_ids=fid, tag="fill")
        for e in (eps[(5, n)],):
            db.execute("INSERT INTO grab_episodes(grab_id, episode_id) SELECT MAX(id), ? FROM grabs", (e,))
        fills += 1
# Upgrades in the range, whose files bring the groups and the growth: WEB-DL 4K Season 4 and Bluray Season 3, one a day or two.
for i, fid in enumerate(file_ids("f.path LIKE ?", "%Season 04%[4K]%") + file_ids("f.path LIKE ?", "%Season 03%[Standard]%")):
    size = db.execute("SELECT size FROM files WHERE id=?", (fid,)).fetchone()["size"]
    when = at_day(1 + i * 29 // 26, 9 + i % 9, rnd.randint(0, 59))
    finished(k4_bb if i < 13 else std_bb, tid[1396], f"Breaking.Bad.S0{4 if i < 13 else 3}.upgrade{i}", ["NZBgeek", "DrunkenSlug", "NZBgeek", "altHUB"][i % 4],
             size, when, "imported", is_upgrade=1, file_ids=[fid], tag="up")

# The other finished Grabs of the last 30 days: the mock-up's rhythm, imported by indexer and a few failed.
per_day_ok = [1, 2, 0, 3, 2, 1, 4, 2, 2, 0, 1, 3, 2, 2, 7, 1, 0, 2, 3, 1, 2, 4, 1, 2, 3, 2, 1, 3, 2, 2]
per_day_bad = [0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]
pool = [n for n, (ok, _bad, *_r) in PROFILE.items() for _ in range(ok)]
rnd.shuffle(pool)
bad_pool = ["altHUB", "altHUB", "altHUB", "NZBgeek", "NZBPlanet", "altHUB"]
nbad = 0
for day_ago in range(30):
    for _ in range(per_day_ok[day_ago]):
        ix = pool[rnd.randrange(len(pool))]
        finished(std_bb, tid[1396], f"Breaking.Bad.S0{rnd.randint(1, 4)}E0{rnd.randint(1, 9)}.1080p.WEB-DL.DDP5.1.H.264-NTb", ix,
                 int(rnd.uniform(2, 14) * 1e9), at_day(day_ago, rnd.randint(1, 22), rnd.randint(0, 59)), "imported", tag="d")
    for _ in range(per_day_bad[day_ago]):
        ix = bad_pool[nbad % len(bad_pool)]
        nbad += 1
        finished(pad, tid[116149], "Paddington.2014.2160p.WEB-DL.x265-FAIL", ix, int(rnd.uniform(3, 9) * 1e9), at_day(day_ago, rnd.randint(1, 22), rnd.randint(0, 59)),
                 "failed", failure="download_failed", tag="f")

# The two Recently added Grabs and the Paddington one get a download, too.
for row in db.execute("SELECT id, size, created_at FROM grabs WHERE release_guid IN ('seed-paddington','seed-breaking-bad')").fetchall():
    done = datetime.datetime.strptime(row["created_at"], "%Y-%m-%dT%H:%M:%SZ")
    db.execute("UPDATE grabs SET download_started_at=?, download_done_at=? WHERE id=?",
               (iso(done - datetime.timedelta(minutes=8)), iso(done), row["id"]))

# Searches: how often each indexer was asked in the 30 days, whether it answered, whether a Release fit and how long it took.
for name, (_ok, _bad, n_searches, hit, answer) in PROFILE.items():
    for _ in range(n_searches):
        when = at_day(rnd.uniform(0, 29.9), 0)
        answered = rnd.random() > 0.04
        fit = answered and rnd.random() < hit
        releases = rnd.randint(1, 30) if answered and rnd.random() < hit + 0.1 else 0
        db.execute("INSERT INTO indexer_searches(indexer_id,indexer_name,at,ok,releases,fit,duration_ms) VALUES (?,?,?,?,?,?,?)",
                   (IDS[name], name, iso(when), int(answered), releases if answered else 0, int(fit), max(120, int(rnd.gauss(answer, answer * 0.25) * 1000)) if answered else 8000))
db.commit()
versions = [(r["id"], r["profile_key"]) for r in db.execute("SELECT DISTINCT v.id, v.profile_key FROM versions v JOIN files f ON f.version_id = v.id")]
db.close()
# The scores above are round numbers. Switching a Version to the Profile it has re-scores its files from the
# parse and probe just stored, as Imports would have scored them, so each popover's Custom Formats add up to its Score.
for vid, profile in versions:
    call("PATCH", f"/versions/{vid}", {"profile": profile})


def ctl(query):
    urllib.request.urlopen(f"{FAKE}/_ctl?{query}").read()


# A Grab downloading: search Paddington in Peru by hand and grab the Blu-ray, as a user would. The
# fake indexer offers nothing unless its releases are on, so they are on only for this.
peru = ver[(tid[516729], "standard")]
ctl("releases=1")
try:
    found = call("POST", f"/versions/{peru}/releases", {})["items"]
    pick = next(r for r in found if r["fits"] and "BluRay.x264" in r["name"])
    call("POST", "/grabs", {"version_id": peru, "release_id": pick["release_id"]})
finally:
    ctl("releases=0")

# Requests: Ellie's fulfilled and waiting, and more from Sam and Jo. Plex is the source Ellie signs in with.
for n, who, tmdb in ((1, ("demo-ellie", "Ellie"), 116149), (2, ("demo-ellie", "Ellie"), 346648), (3, ("demo-sam", "Sam"), 116149),
                     (4, ("demo-sam", "Sam"), 559969), (5, ("demo-jo", "Jo"), 516729)):
    call("POST", "/requests", {"source": "plex", "source_request_id": f"demo-{n}", "requester": {"id": who[0], "name": who[1]},
                               "title": {"kind": "movie", "tmdb_id": tmdb}, "slots": [{"slot": "standard"}]})
# The API stamps them all with now: move them back, and the fulfilled ones' Slots to some hours after the ask.
db = sqlite3.connect(args.db)
for n, days_ago, took_hours in ((1, 12, 5), (3, 6, 30), (2, 3, None), (4, 2, None), (5, 1, None)):
    created = at_day(days_ago, 14)
    rid = db.execute("SELECT id FROM requests WHERE source_request_id=?", (f"demo-{n}",)).fetchone()[0]
    db.execute("UPDATE requests SET created_at=? WHERE id=?", (iso(created), rid))
    if took_hours is not None:
        db.execute("UPDATE request_slots SET filled_at=? WHERE request_id=?", (iso(created + datetime.timedelta(hours=took_hours)), rid))
db.commit()
db.close()
# The Log: a week of events, written as the app records them (messages and payloads of internal/history), oldest first.
db = sqlite3.connect(args.db)
grabs = db.execute("SELECT id, title_id, version_id, release_name FROM grabs ORDER BY id DESC").fetchall()
gb = next(g for g in grabs if g[1] == tid[1396]) if any(g[1] == tid[1396] for g in grabs) else grabs[0]
gp = next(g for g in grabs if g[1] == tid[116149]) if any(g[1] == tid[116149] for g in grabs) else grabs[0]
log = []


def ev(days_ago, hour, minute, kind, message, title=None, grab=None, routine=0, data=None):
    when = at_day(days_ago, hour, minute)
    if when > datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=2):
        return
    log.append((iso(when), kind, routine, tid[title] if title else None,
                ver[(tid[title], "standard")] if title else None, grab, message, json.dumps(data) if data else None))


names = {1396: "Breaking Bad", 116149: "Paddington", 346648: "Paddington 2", 559969: "El Camino", 516729: "Paddington in Peru"}
for d in range(7, -1, -1):
    for burst, hour in enumerate((3, 13)):
        for i in range(8 + (d + burst) % 5):
            t = (346648, 559969, 516729, 1396, 116149)[(i + d) % 5]
            res = "grabbed 1 Release" if (d, burst, i) in ((5, 1, 3), (1, 0, 2), (0, 1, 4)) else "nothing to grab"
            scope = " for S05" if t == 1396 else ""
            ev(d, hour, i * 2, "search", f"Searched by hand{scope} in Standard: {res}", title=t, routine=1)
    ev(d, 9, 15, "title_refreshed", "Refreshed from the metadata providers", title=1396, routine=1)
    ev(d, 10, 15, "import", f"Imported {gb[3]} as /data/media/tv/Breaking Bad/Season 05/e.mkv", title=1396, grab=gb[0], data={"path": "/data/media/tv/Breaking Bad/Season 05/e.mkv"})
    ev(d, 10, 2, "grab", f"Sent {gb[3]} to the download client", title=1396, grab=gb[0], data={"by": ("by_search", "by_hand", "by_rss")[d % 3]})
    ev(d, 11, 31, "request", "Request from Ellie via Plex", title=346648)
    ev(d, 21, 5, "adoption_scanned", "Adoption scan: 4 matched, 0 need a choice, 0 skipped", routine=1)
ev(6, 8, 30, "adoption", "Adopted El Camino (2019) in Standard", title=559969)
ev(5, 18, 2, "grab_failed", f"Download failed (encrypted): {gp[3]}", title=116149, grab=gp[0])
ev(4, 6, 12, "health_raised", "SABnzbd refused the connection", data={"key": "download_client", "kind": "download_client_unreachable", "severity": "blocking"})
ev(4, 6, 40, "health_cleared", "Cleared: SABnzbd refused the connection", data={"key": "download_client", "kind": "download_client_unreachable", "severity": "blocking"})
ev(3, 15, 20, "import_rejected", f"Import of {gb[3]} rejected: not_upgrade", title=1396, grab=gb[0])
ev(2, 12, 50, "import_stalled", f"Import of {gp[3]} stalled: /data/media/movies is not writable", title=116149, grab=gp[0])
ev(1, 17, 40, "original_offered", "Standard has the Original Language only: accept or dismiss it in Needs attention", title=516729, routine=1)
ev(1, 18, 2, "grab_failed", f"Download failed (encrypted): {gp[3]}", title=116149, grab=gp[0])
ev(0, 0, 40, "health_raised", "SABnzbd refused the connection", data={"key": "download_client", "kind": "download_client_unreachable", "severity": "blocking"})
ev(0, 0, 55, "health_raised", "Plex refused the connection", data={"key": "media_server", "kind": "media_server_unreachable", "severity": "warning"})
# Events get ids in the order they are written and the Log lists by id, so the ones the API wrote a moment ago make way.
db.execute("DELETE FROM events")
for row in sorted(log):
    db.execute("INSERT INTO events(at,kind,routine,title_id,version_id,grab_id,message,data) VALUES (?,?,?,?,?,?,?,?)", row)
db.commit()
db.close()

print(f"seed: {len(tid)} Titles, {len(files)} files, {fills} fills, 1 Grab, 5 Requests")
