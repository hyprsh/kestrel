#!/usr/bin/env python3
"""Seeds a fresh Kestrel for the demo. demo.sh start runs it; run it by hand only on a fresh instance.

    python3 -I seed.py --kestrel URL --db <config>/kestrel.db --media DIR --fake URL --parse BIN

Through the API: the account demo / demo-password-123, English and US, Root folders
<media>/movies, <media>/movies-family and <media>/tv, the fake indexer, SABnzbd and Plex,
Plex sign-in on for Requesters (the fake's Ellie signs in with one click),
setup completed, then Paddington (Standard) and Breaking Bad (Standard and 4K), and without
files Paddington 2, Paddington in Peru, El Camino and Better Call Saul.

Straight into SQLite, since Imports would need real downloads: the files of both,
as empty files on disk. Paddington has its 1080p BluRay. Breaking Bad has Seasons 1-4
in Standard (S02E12-E13 is one double-episode file) and in 4K, Season 5 half in
Standard and a quarter in 4K, and one Special. BIN is scripts/demo/parse, which
writes each release name's parsed form as Imports stores it. Then the dates around
today (Upcoming's window) are set in the same way: see "Upcoming looks at" below.
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
call("POST", "/plugin-instances", {"plugin_id": "newznab", "name": "Demo Indexer",
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
db.execute("PRAGMA foreign_keys=ON")
tid = {r[1]: r[0] for r in db.execute("SELECT id, tmdb_id FROM titles")}
ver = {(r[1], r[2]): r[0] for r in db.execute("SELECT id, title_id, slot FROM versions")}
eps = {(r[1], r[2]): r[0] for r in db.execute("SELECT id, season, number FROM episodes WHERE title_id=?", (tid[1396],))}

files = []  # (version id, path, size, release name, score, [episode ids], parse kind)
movie_folder = "Paddington (2014) {tmdb-116149}"
db.execute("UPDATE titles SET folder=? WHERE id=?", (movie_folder, tid[116149]))
files.append((ver[(tid[116149], "standard")],
              f"{ROOT}/movies/{movie_folder}/{movie_folder} - [Standard][Bluray-1080p][x264]-SPARKS.mkv", 8_589_934_592,
              "Paddington.2014.1080p.BluRay.x264-SPARKS", 1850, [], "movie"))
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
    ep_file("standard", 5, [n], "Breaking.Bad.{code}.1080p.WEB-DL.DD5.1.H.264-NTb", "WEBDL-1080p", 1_700_000_000, 1600)
for n in range(1, 5):
    ep_file("4k", 5, [n], "Breaking.Bad.{code}.2160p.WEB-DL.DDP5.1.HDR.H.265-NTb", "WEBDL-2160p", 6_800_000_000, 2400)
ep_file("standard", 0, [1], "Breaking.Bad.{code}.Minisode.1080p.WEB-DL.AAC2.0.H.264-BTN", "WEBDL-1080p", 180_000_000, 900)

parsed = subprocess.run([args.parse], input="".join(f"{f[6]}\t{f[3]}\n" for f in files),
                        capture_output=True, text=True, check=True).stdout.splitlines()
fe_cols = [r[1] for r in db.execute("PRAGMA table_info(file_episodes)")]
for (v, path, size, rel, score, epids, _), pr in zip(files, parsed, strict=True):
    cur = db.execute("INSERT INTO files(version_id,path,size,release_name,parsed_release,score,imported_at) VALUES (?,?,?,?,?,?,?)",
                     (v, path, size, rel, None if pr == "null" else pr, score, "2026-09-14T18:30:00Z"))
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


def stamp(days):
    return on(days) + "T00:00:00Z"


db.execute("UPDATE versions SET added_at='2026-05-01T00:00:00Z'")
# Older builds have no network, status, air time or episode overview to set.
airing = "air_time" in [r[1] for r in db.execute("PRAGMA table_info(titles)")]
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
db.commit()
print(f"seed: {len(tid)} Titles, {len(files)} files")
