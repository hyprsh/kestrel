#!/usr/bin/env python3
"""Grows a seeded demo to a big Library, for measuring: demo.sh start runs it after seed.py when DEMO_TITLES is set.

    python3 -I seed_big.py --db <config>/kestrel.db --media DIR --titles N

Straight into SQLite, as seed.py does, so 4,000 Titles take a few seconds. Adds N minus what is there: three Movies to
one Series, named from word lists (the same every run). Of the Movies, about 55 % have a Standard file, 12 % a 4K one
too, 23 % have none and are Wanted, and 10 % are not monitored. A Series has 2 to 6 Seasons of 6 to 12 episodes; 60 %
have a Standard file for every aired episode, 15 % a 4K one for the first Seasons, 20 % are missing the latest
Season's last episodes (Wanted), 8 % are not monitored, and the newest episodes have not aired. A few hundred finished
Grabs give Activity's history more to page. Empty files are made on disk where the rows say they are.
"""
import argparse, datetime, json, os, random, sqlite3

ap = argparse.ArgumentParser()
ap.add_argument("--db", required=True)
ap.add_argument("--media", required=True)
ap.add_argument("--titles", type=int, required=True)
args = ap.parse_args()

rnd = random.Random(4000)
db = sqlite3.connect(args.db, timeout=60)
db.execute("PRAGMA foreign_keys = ON")
now = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0)
iso = lambda d: d.strftime("%Y-%m-%dT%H:%M:%SZ")
day = lambda n: (now + datetime.timedelta(days=n)).strftime("%Y-%m-%d")

have = db.execute("select count(*) from titles").fetchone()[0]
want = args.titles - have
if want <= 0:
    raise SystemExit(f"seed_big: {have} Titles already")
movies_file = db.execute("select parsed_release, probe from files where version_id = (select id from versions where slot='standard' and title_id=1)").fetchone()
k4_file = db.execute("select parsed_release, probe from files where version_id in (select id from versions where slot='4k') limit 1").fetchone()
std_ep_file = db.execute("select parsed_release, probe from files where version_id = (select id from versions where slot='standard' and title_id=2) limit 1").fetchone()
for need in (movies_file, k4_file, std_ep_file):
    assert need, "seed_big: run it after seed.py"
profile = {"standard": "hd-primary", "4k": "4k-primary"}

A = "Silent Golden Crimson Hidden Broken Last First Dark Bright Lost Wild Iron Paper Glass Winter Summer Midnight Distant Hollow Burning Quiet Fallen Rising Secret Electric Velvet Savage Gentle Frozen".split()
B = "River Garden Empire Harbor Signal Mirror Kingdom Circus Orchard Station Lantern Voyage Archive Frontier Shadow Meridian Outpost Cascade Carnival Horizon Citadel Reckoning Inheritance Eclipse Covenant Odyssey Pursuit Masquerade Expedition Uprising".split()
C = "of the North|in Paris|Returns|Rising|Begins|Forever|Unbound|Reloaded|Redux|Awakens|at Dawn|of Tomorrow||||".split("|")
used = set()


def name():
    while True:
        n = f"{rnd.choice(A)} {rnd.choice(B)} {rnd.choice(C)}".strip()
        if n not in used:
            used.add(n)
            return n


def pick(*weights):
    r, acc = rnd.random(), 0
    for i, w in enumerate(weights):
        acc += w
        if r < acc:
            return i
    return len(weights) - 1


movies_root, tv_root = f"{args.media}/movies", f"{args.media}/tv"
base_id = db.execute("select coalesce(max(id),0) from titles").fetchone()[0]
nid = lambda t: db.execute(f"select coalesce(max(id),0)+1 from {t}").fetchone()[0]
vid, fid, eid, gid = nid("versions"), nid("files"), nid("episodes"), nid("grabs")
files_on_disk = []
added = iso(now - datetime.timedelta(days=200))
t_rows, v_rows, e_rows, s_rows, f_rows, fe_rows, g_rows = [], [], [], [], [], [], []


def file_row(version, path, size, release, snap, score, when, grab=None):
    global fid
    f_rows.append((fid, version, path, size, release, snap[0], snap[1], score, grab, when))
    files_on_disk.append(path)
    fid += 1
    return fid - 1


for i in range(want):
    tid = base_id + 1 + i
    is_series = i % 4 == 3
    n = name()
    year = rnd.randint(1985, 2026)
    folder = f"{n} ({year}) {{{'tvdb' if is_series else 'tmdb'}-{800000 + i}}}"
    monitored = 0 if rnd.random() < (0.08 if is_series else 0.10) else 1
    t_rows.append((tid, "series" if is_series else "movie", None if is_series else 800000 + i, 800000 + i if is_series else None,
                   n, n, n, year, "en", f"{n}: a made-up Title for a big demo Library.", 47 if is_series else 105, monitored,
                   "all" if is_series else None, f"{tv_root if is_series else movies_root}", folder, added, added,
                   round(rnd.uniform(4, 9), 1), rnd.randint(50, 9000), "AMC" if is_series else "", ("ended" if rnd.random() < .6 else "continuing") if is_series else ""))
    if not is_series:
        state = pick(0.55, 0.12, 0.23, 0.10)  # std file / std+4k / wanted / (unmonitored handled above)
        v_std = vid; vid += 1
        v_rows.append((v_std, tid, "standard", profile["standard"], added))
        if state in (0, 1):
            p = f"{movies_root}/{folder}/{folder} - [Standard][Bluray-1080p][x264]-DEMO.mkv"
            file_row(v_std, p, rnd.randint(4, 14) << 30, f"{n.replace(' ', '.')}.{year}.1080p.BluRay.DTS.5.1.x264-DEMO", movies_file, rnd.choice((1500, 1800, 1900)), iso(now - datetime.timedelta(days=rnd.randint(1, 180))))
        if state == 1:
            v4 = vid; vid += 1
            v_rows.append((v4, tid, "4k", profile["4k"], added))
            p = f"{movies_root}/{folder}/{folder} - [4K][WEBDL-2160p][HEVC]-DEMO.mkv"
            file_row(v4, p, rnd.randint(15, 40) << 30, f"{n.replace(' ', '.')}.{year}.2160p.WEB-DL.DDP5.1.HDR.H.265-DEMO", k4_file, 2100, iso(now - datetime.timedelta(days=rnd.randint(1, 90))))
        continue
    seasons = rnd.randint(2, 6)
    shape = pick(0.60, 0.15, 0.20, 0.05)  # complete / complete + 4K / missing the last of the newest Season / nothing
    has_4k = shape == 1
    v_std = vid; vid += 1
    v_rows.append((v_std, tid, "standard", profile["standard"], added))
    v_4k = None
    if has_4k:
        v_4k = vid; vid += 1
        v_rows.append((v_4k, tid, "4k", profile["4k"], added))
    for s in range(1, seasons + 1):
        s_rows.append((tid, s, 1))
        count = rnd.randint(6, 12)
        for e in range(1, count + 1):
            newest = s == seasons
            offset = (e - count) * 7 - (0 if shape != 3 else 0)
            air = day(offset - (seasons - s) * 120 - (0 if not newest else rnd.choice((0, 0, 0, -20, 40))) )
            if newest and shape == 2 and e > count - 2:
                air = day(-10 - (count - e))
            if newest and e == count and rnd.random() < 0.3:
                air = day(rnd.randint(2, 60))  # not aired yet
            e_rows.append((eid, tid, s, e, 9000000 + eid, f"Episode {e}", air, 1, f"Episode {e}", f"Season {s}, episode {e} of {n}."))
            aired = air <= day(0)
            if shape in (0, 1, 2) and aired and not (shape == 2 and newest and e > count - 2):
                p = f"{tv_root}/{folder}/Season {s:02d}/{n} - S{s:02d}E{e:02d} - [Standard][WEBDL-1080p][x264]-DEMO.mkv"
                f = file_row(v_std, p, rnd.randint(1, 3) << 30, f"{n.replace(' ', '.')}.S{s:02d}E{e:02d}.1080p.WEB-DL.DDP5.1.H.264-DEMO", std_ep_file, 1700, iso(now - datetime.timedelta(days=rnd.randint(1, 150))))
                fe_rows.append((f, v_std, eid))
                if has_4k and s <= 2:
                    p4 = f"{tv_root}/{folder}/Season {s:02d}/{n} - S{s:02d}E{e:02d} - [4K][WEBDL-2160p][HEVC]-DEMO.mkv"
                    f4 = file_row(v_4k, p4, rnd.randint(3, 6) << 30, f"{n.replace(' ', '.')}.S{s:02d}E{e:02d}.2160p.WEB-DL.DDP5.1.HDR.H.265-DEMO", k4_file, 2100, iso(now - datetime.timedelta(days=rnd.randint(1, 90))))
                    fe_rows.append((f4, v_4k, eid))
            eid += 1

with db:
    db.executemany("""insert into titles (id, kind, tmdb_id, tvdb_id, title, original_title, primary_title, year, original_language, overview, runtime,
        monitored, series_monitor, root_folder, folder, added_at, refreshed_at, tmdb_vote_average, tmdb_vote_count, network, tvdb_status)
        values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", t_rows)
    db.executemany("insert into versions (id, title_id, slot, profile_key, added_at) values (?,?,?,?,?)", v_rows)
    db.executemany("insert into seasons (title_id, number, monitored) values (?,?,?)", s_rows)
    db.executemany("insert into episodes (id, title_id, season, number, tvdb_id, name, air_date, monitored, primary_name, overview) values (?,?,?,?,?,?,?,?,?,?)", e_rows)
    db.executemany("insert into files (id, version_id, path, size, release_name, parsed_release, probe, score, grab_id, imported_at) values (?,?,?,?,?,?,?,?,?,?)", f_rows)
    db.executemany("insert into file_episodes (file_id, version_id, episode_id) values (?,?,?)", fe_rows)
    # A few hundred finished Grabs for Activity's history.
    movie_versions = [r for r in db.execute("select v.id, v.title_id, t.title from versions v join titles t on t.id = v.title_id where v.slot='standard' and t.id > ? limit 400", (base_id,))]
    for k, (v, t, n) in enumerate(movie_versions):
        when = iso(now - datetime.timedelta(hours=k * 11 + 5))
        db.execute("""insert into grabs (id, title_id, version_id, release_guid, release_name, indexer_id, indexer_name, size, published_at, score, parsed, verdict, client_instance_id,
            client_id, state, created_at, updated_at) values (?,?,?,?,?,1,'Demo Indexer',?,?,1800,'{}','{}',2,?,'imported',?,?)""",
                   (gid, t, v, f"big-{gid}", f"{n.replace(' ', '.')}.1080p.BluRay.x264-DEMO", 6 << 30, when, f"SABnzbd_nzo_big-{gid}", when, when))
        gid += 1

for p in files_on_disk:
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "a").close()
print(f"seed_big: {want} Titles ({sum(1 for t in t_rows if t[1]=='series')} Series), {len(e_rows)} episodes, {len(f_rows)} files, {len(movie_versions)} Grabs")
