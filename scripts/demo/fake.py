#!/usr/bin/env python3
"""The demo's stand-ins for TMDB, TheTVDB, a Newznab indexer, SABnzbd, plex.tv and a Plex server, on one port.

    python3 -I fake.py --port 7690 --posters <dir>   serve
    python3 -I fake.py --titles                      list "kind<TAB>tmdb id<TAB>title<TAB>year" for posters.mjs

Routes: TMDB API /3, TMDB images /t/p (files <kind>-<tmdb id>.jpg from --posters),
TheTVDB /v4, Newznab /nzb/api, SABnzbd /sab/api, plex.tv /plextv and the Plex server /plex.

What it knows (MOVIES and SERIES below):
- Movies: Paddington, Paddington 2, Paddington in Peru, El Camino.
- Series: Breaking Bad (every real episode, German names for some, Specials),
  Better Call Saul, The Adventures of Paddington Bear, and two with trouble on
  purpose: Friends (TheTVDB answers after 25 s, for loading states) and
  Twin Peaks (TheTVDB answers 500, for error states).
- Searches match "padd", "breaking"/"camino", "saul", "friends", "twin".
- The indexer has no releases until GET /_ctl?releases=1 (=0 empties it again).
  Then it offers releases for every Movie and for Breaking Bad, never other Series.
- GET /_ctl?unlisted=1 (=0 removes them) adds Breaking Bad releases TheTVDB does not list: the
  episode after the last listed one of the season asked for (Placeholder Episodes,
  episode_not_listed) and the season after the last (season_not_listed), as a pack and an
  episode 1. It needs releases on, and with it off the indexer offers exactly what it did.
- SABnzbd accepts every NZB into a queue at 40 %; nothing ever completes.
- plex.tv (/plextv, KESTREL_PLEX_TV_URL) knows the owner (token DEMO_OWNER_TOKEN, the one
  seeded into the Plex instance) and Ellie, a friend whose share includes the Plex server
  (/plex, whose /identity answers DEMO_MACHINE). Its sign-in page (/plextv/auth,
  KESTREL_PLEX_APP_URL) authorises the PIN in the URL as Ellie the moment it is visited and
  sends the browser on to the forwardUrl, so a Requester signs in with one click.
- The Plex server also keeps a play history for Watch-ahead (see the PLEX PLAY HISTORY block):
  GET /plex/_play?season=1&episode=2 records a play of Breaking Bad now, and
  /plex/status/sessions/history/all lists the plays.
- plex.tv's Watchlists (discover and community APIs, see the Watchlist block below): the owner
  has Breaking Bad on theirs and Ellie Paddington; GET /_ctl?watchlist=1 adds two more titles
  that Watchlist sync requests on its next pass (=0 removes them).
"""
import argparse, json, os, sys, time, datetime, hashlib
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from xml.sax.saxutils import escape

STATE = {"releases": False, "unlisted": False, "queue": [], "pins": {}}
DEMO_OWNER_TOKEN = "demo-owner-token"
DEMO_REQUESTER_TOKEN = "demo-requester-token"
DEMO_MACHINE = "demo-plex-machine"
PLEX_SHOW_KEY = "/library/metadata/456"
PLEX_PLAYS = []  # the Plex server's play history, oldest first
PLEX_ACCOUNTS = {
    DEMO_OWNER_TOKEN: dict(id=1, uuid="demo-owner", username="owner", title="owner", thumb=""),
    DEMO_REQUESTER_TOKEN: dict(id=2, uuid="demo-ellie", username="ellie", title="Ellie", thumb=""),
}
PLEX_AUTH_PAGE = """<!doctype html><meta charset="utf-8"><title>Plex (demo)</title>
<p>Signing in with the demo Plex account...</p>
<script>
const p = new URLSearchParams(location.hash.replace(/^#\\??/, ''))
fetch('_authorise?code=' + encodeURIComponent(p.get('code') || '')).then(() => location.replace(p.get('forwardUrl') || '/'))
</script>"""
POSTERS = "."
PORT = 7690

MOVIES = {
    116149: dict(title="Paddington", year=2014, date="2014-11-28", imdb="tt1109624", runtime=95, va=7.3, vc=4912,
                 overview="A young Peruvian bear with a passion for all things British travels to London in search of a home. Finding himself lost and alone at Paddington Station, he meets the kindly Brown family.",
                 genres=["Comedy", "Family", "Adventure"], de="Paddington", cert="PG"),
    346648: dict(title="Paddington 2", year=2017, date="2017-11-10", imdb="tt4468740", runtime=104, va=7.6, vc=3115,
                 overview="Paddington, now happily settled with the Browns, picks up a series of odd jobs to buy the perfect present for his Aunt Lucy, only for it to be stolen.",
                 genres=["Adventure", "Comedy", "Family"], de="Paddington 2", cert="PG"),
    516729: dict(title="Paddington in Peru", year=2024, date="2024-11-08", imdb="tt5822536", runtime=106, va=7.1, vc=612,
                 overview="Paddington travels to Peru to visit his beloved Aunt Lucy, who now resides at the Home for Retired Bears. With the Brown family in tow, a thrilling adventure ensues.",
                 genres=["Adventure", "Comedy", "Family"], de="Paddington in Peru", cert="PG"),
    559969: dict(title="El Camino: A Breaking Bad Movie", year=2019, date="2019-10-11", imdb="tt9243946", runtime=123, va=6.9, vc=5321,
                 overview="In the wake of his dramatic escape from captivity, Jesse Pinkman must come to terms with his past in order to forge some kind of future.",
                 genres=["Crime", "Drama", "Thriller"], de="El Camino: Ein \"Breaking Bad\"-Film", cert="TV-MA"),
}

BB = {
    0: [("Good Cop Bad Cop", "2009-02-17"), ("Wedding Day", "2009-02-17"), ("TwaüghtHammer", "2009-02-17"),
        ("Marie's Confession", "2009-02-17"), ("The Break-In", "2009-02-17"), ("", None)],
    1: ["Pilot", "Cat's in the Bag...", "...And the Bag's in the River", "Cancer Man", "Gray Matter",
        "Crazy Handful of Nothin'", "A No-Rough-Stuff-Type Deal"],
    2: ["Seven Thirty-Seven", "Grilled", "Bit by a Dead Bee", "Down", "Breakage", "Peekaboo", "Negro y Azul",
        "Better Call Saul", "4 Days Out", "Over", "Mandala", "Phoenix", "ABQ"],
    3: ["No Más", "Caballo sin Nombre", "I.F.T.", "Green Light", "Más", "Sunset", "One Minute", "I See You",
        "Kafkaesque", "Fly", "Abiquiu", "Half Measures", "Full Measure"],
    4: ["Box Cutter", "Thirty-Eight Snub", "Open House", "Bullet Points", "Shotgun", "Cornered", "Problem Dog",
        "Hermanos", "Bug", "Salud", "Crawl Space", "End Times", "Face Off"],
    5: ["Live Free or Die", "Madrigal", "Hazard Pay", "Fifty-One", "Dead Freight", "Buyout", "Say My Name",
        "Gliding Over All", "Blood Money", "Buried", "Confessions", "Rabid Dog", "To'hajiilee", "Ozymandias",
        "Granite State", "Felina"],
}
BB_START = {1: "2008-01-20", 2: "2009-03-08", 3: "2010-03-21", 4: "2011-07-17", 5: "2012-07-15"}
BB_DE = {
    (1, 1): "Der Einstieg", (1, 2): "Die Katze ist im Sack …", (1, 3): "… und der Sack ist im Fluss",
    (1, 4): "Der Krebsmann", (1, 5): "Graue Substanz", (1, 6): "Verrückt nach nichts", (1, 7): "Ganz ohne Gewalt",
    (2, 1): "Sieben-Dreißig-Sieben", (2, 2): "Gegrillt", (2, 3): "Von einer toten Biene gestochen", (2, 4): "Am Boden",
    (2, 5): "Bruchware", (2, 8): "Better Call Saul", (2, 12): "Phoenix",
    (5, 1): "Lebe frei oder stirb", (5, 2): "Madrigal", (5, 7): "Sag meinen Namen", (5, 14): "Ozymandias",
    (5, 16): "Felina", (0, 1): "Guter Bulle, böser Bulle",
}


def bb_episodes():
    out = []
    eid = 349000
    for s in sorted(BB):
        for i, e in enumerate(BB[s], 1):
            eid += 1
            if s == 0:
                name, aired = e
            else:
                name = e
                d = datetime.date.fromisoformat(BB_START[s]) + datetime.timedelta(days=7 * (i - 1))
                if s == 5 and i > 8:
                    d = datetime.date(2013, 8, 11) + datetime.timedelta(days=7 * (i - 9))
                aired = d.isoformat()
            out.append(dict(id=eid, seriesId=81189, name=name, aired=aired, number=i, seasonNumber=s, de=BB_DE.get((s, i))))
    return out


def generic_eps(tvdb, seasons, start_year, prefix):
    out, eid = [], tvdb * 10
    for s, n in enumerate(seasons, 1):
        for i in range(1, n + 1):
            eid += 1
            d = datetime.date(start_year + s - 1, 9, 22) + datetime.timedelta(days=7 * (i - 1))
            out.append(dict(id=eid, seriesId=tvdb, name=f"{prefix} {i}", aired=d.isoformat(), number=i, seasonNumber=s, de=None))
    return out


SERIES = {
    1396: dict(name="Breaking Bad", tvdb=81189, imdb="tt0903747", date="2008-01-20", last="2013-09-29", status="Ended",
               va=8.9, vc=14523, network="AMC", runtime=47, genres=["Drama", "Crime"], de="Breaking Bad",
               overview="Walter White, a New Mexico chemistry teacher, is diagnosed with Stage III cancer and given a prognosis of only two years left to live. He becomes filled with a sense of fearlessness and an unrelenting desire to secure his family's financial future at any cost as he enters the dangerous world of drugs and crime.",
               eps=bb_episodes, cert=[("US", "TV-MA"), ("DE", "16")], airs="21:00"),
    1668: dict(name="Friends", tvdb=79168, imdb="tt0108778", date="1994-09-22", last="2004-05-06", status="Ended",
               va=8.4, vc=9128, network="NBC", runtime=22, genres=["Comedy", "Drama"], de="Friends",
               overview="Six young people from New York City, on their own and struggling to survive in the real world, find the companionship, comfort and support they get from each other to be the perfect antidote to the pressures of life.",
               eps=lambda: generic_eps(79168, [24, 24, 25, 24, 24, 25, 24, 24, 24, 18], 1994, "Episode"),
               cert=[("US", "TV-14")], slow=True),
    1920: dict(name="Twin Peaks", tvdb=70533, imdb="tt0098936", date="1990-04-08", last="1991-06-10", status="Ended",
               va=8.1, vc=2236, network="ABC", runtime=47, genres=["Drama", "Mystery"], de="Das Geheimnis von Twin Peaks",
               overview="The body of Laura Palmer is washed up on a beach near the small Washington state town of Twin Peaks. FBI Special Agent Dale Cooper is called in to investigate her strange demise only to uncover a web of mystery.",
               eps=lambda: generic_eps(70533, [8, 22], 1990, "Episode"), cert=[("US", "TV-14")], broken=True),
    60059: dict(name="Better Call Saul", tvdb=273181, imdb="tt3032476", date="2015-02-08", last="2022-08-15", status="Ended",
                va=8.7, vc=5611, network="AMC", runtime=46, genres=["Crime", "Drama"], de="Better Call Saul",
                overview="Six years before Saul Goodman meets Walter White. We meet him when the man who will become Saul Goodman is known as Jimmy McGill, a small-time lawyer searching for his destiny, and, more immediately, hustling to make ends meet.",
                eps=lambda: generic_eps(273181, [10, 10, 10, 10, 10, 13], 2015, "Episode"), cert=[("US", "TV-MA")], airs="22:00"),
    61814: dict(name="The Adventures of Paddington Bear", tvdb=76543, imdb="tt0461612", date="1997-09-07", last="2000-03-01",
                status="Ended", va=6.9, vc=31, network="Teletoon", runtime=22, genres=["Animation", "Family"], de="Die Abenteuer von Paddington Bär",
                overview="Animated adventures of the bear from darkest Peru who lives with the Brown family in London.",
                eps=lambda: generic_eps(76543, [13, 13, 13], 1997, "Episode"), cert=[("US", "TV-Y")]),
}
TVDB = {v["tvdb"]: k for k, v in SERIES.items()}


def poster_path(kind, tid):
    return f"/{kind}-{tid}.jpg"


def search(q):
    q = q.lower()
    res = []
    def mv(i):
        m = MOVIES[i]
        return dict(id=i, media_type="movie", title=m["title"], original_title=m["title"], original_language="en",
                    overview=m["overview"], poster_path=poster_path("movie", i), release_date=m["date"],
                    vote_average=m["va"], vote_count=m["vc"], popularity=50)
    def tv(i):
        s = SERIES[i]
        return dict(id=i, media_type="tv", name=s["name"], original_name=s["name"], original_language="en",
                    overview=s["overview"], poster_path=poster_path("tv", i), first_air_date=s["date"],
                    vote_average=s["va"], vote_count=s["vc"], popularity=40)
    if "padd" in q:
        res = [mv(116149), mv(346648), mv(516729), tv(61814)]
    elif "breaking" in q or "camino" in q:
        res = [tv(1396), mv(559969)]
    elif "saul" in q:
        res = [tv(60059), tv(1396)]
    elif "friends" in q:
        res = [tv(1668)]
    elif "twin" in q:
        res = [tv(1920)]
    return {"page": 1, "results": res, "total_pages": 1, "total_results": len(res)}


def movie(i):
    m = MOVIES[i]
    return {
        "id": i, "imdb_id": m["imdb"], "title": m["title"], "original_title": m["title"], "original_language": "en",
        "release_date": m["date"], "runtime": m["runtime"], "overview": m["overview"],
        "poster_path": poster_path("movie", i), "genres": [{"name": g} for g in m["genres"]],
        "external_ids": {"imdb_id": m["imdb"]}, "vote_average": m["va"], "vote_count": m["vc"],
        "alternative_titles": {"titles": []},
        "translations": {"translations": [{"iso_3166_1": "DE", "iso_639_1": "de", "data": {"title": m["de"]}}]},
        "release_dates": {"results": [
            {"iso_3166_1": "US", "release_dates": [
                {"certification": m["cert"], "release_date": m["date"] + "T00:00:00.000Z", "type": 3},
                {"certification": m["cert"], "release_date": str(m["year"] + 1) + "-03-01T00:00:00.000Z", "type": 4},
                {"certification": m["cert"], "release_date": str(m["year"] + 1) + "-04-14T00:00:00.000Z", "type": 5}]},
            {"iso_3166_1": "DE", "release_dates": [
                {"certification": "0", "release_date": m["date"] + "T00:00:00.000Z", "type": 3},
                {"certification": "0", "release_date": str(m["year"] + 1) + "-06-18T00:00:00.000Z", "type": 5}]},
        ]},
    }


def tv(i):
    s = SERIES[i]
    return {
        "id": i, "name": s["name"], "original_name": s["name"], "original_language": "en", "first_air_date": s["date"],
        "episode_run_time": [s["runtime"]], "overview": s["overview"], "poster_path": poster_path("tv", i),
        "vote_average": s["va"], "vote_count": s["vc"], "genres": [{"name": g} for g in s["genres"]],
        "networks": [{"name": s["network"]}], "external_ids": {"imdb_id": s["imdb"], "tvdb_id": s["tvdb"]},
        "alternative_titles": {"results": []},
        "translations": {"translations": [{"iso_3166_1": "DE", "iso_639_1": "de", "data": {"name": s["de"]}}]},
        "content_ratings": {"results": [{"iso_3166_1": c, "rating": r} for c, r in s["cert"]]},
    }


def caps():
    return """<?xml version="1.0" encoding="UTF-8"?>
<caps><server version="0.2" title="Demo Indexer"/><limits max="100" default="50"/>
<searching><search available="yes" supportedParams="q"/>
<tv-search available="yes" supportedParams="q,tvdbid,imdbid,tmdbid,season,ep"/>
<movie-search available="yes" supportedParams="q,imdbid,tmdbid"/></searching>
<categories><category id="2000" name="Movies"><subcat id="2040" name="HD"/><subcat id="2045" name="UHD"/></category>
<category id="5000" name="TV"><subcat id="5040" name="HD"/><subcat id="5045" name="UHD"/></category></categories></caps>"""


def rss(items):
    now = datetime.datetime(2026, 10, 18, 9, 0, tzinfo=datetime.timezone.utc)
    parts = []
    for n, (title, size, cat, attrs) in enumerate(items):
        guid = hashlib.sha1(title.encode()).hexdigest()[:16]
        pub = (now - datetime.timedelta(days=n * 37 + 3)).strftime("%a, %d %b %Y %H:%M:%S +0000")
        a = "".join(f'<newznab:attr name="{k}" value="{escape(str(v))}"/>' for k, v in attrs.items())
        parts.append(f"""<item><title>{escape(title)}</title><guid isPermaLink="false">{guid}</guid>
<link>http://127.0.0.1:{PORT}/nzb/get/{guid}.nzb</link><pubDate>{pub}</pubDate>
<enclosure url="http://127.0.0.1:{PORT}/nzb/get/{guid}.nzb" length="{size}" type="application/x-nzb"/>
<newznab:attr name="category" value="{cat}"/><newznab:attr name="size" value="{size}"/>
<newznab:attr name="grabs" value="{120 - n * 13}"/>{a}</item>""")
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:newznab="http://www.newznab.com/DTD/2010/feeds/attributes/"><channel><title>Demo Indexer</title>
<newznab:response offset="0" total="{len(items)}"/>{''.join(parts)}</channel></rss>"""


def unlisted_bb(season, ep):
    """Breaking Bad releases past what TheTVDB lists: the next episode of the season asked for, and
    the season after the last, when the query is not for one episode that is neither."""
    last = max(s for s in BB if s > 0)
    after = [(season, len(BB[season]) + 1)] if season in BB and season > 0 else []
    after.append((last + 1, 1))
    out = []
    for s, n in after:
        if ep and int(ep) != n:
            continue
        for code, big, small in ([(f"S{s:02d}E{n:02d}", 7_100_000_000, 2_300_000_000)] + ([] if ep else [(f"S{s:02d}", 9_800_000_000, 4_100_000_000)])):
            out.append((f"Breaking.Bad.{code}.2160p.WEB-DL.DDP5.1.HDR.H.265-NTb", big, 5045))
            out.append((f"Breaking.Bad.{code}.1080p.BluRay.x264-ROVERS", small, 5040))
    return out


def releases(qs):
    t = qs.get("t", [""])[0]
    if not STATE["releases"] or t not in ("tvsearch", "movie", "search"):
        return rss([])
    if t == "tvsearch":
        tvdb = int(qs.get("tvdbid", ["0"])[0] or 0)
        if tvdb != 81189:
            return rss([])
        season = int(qs.get("season", ["1"])[0] or 1)
        ep = qs.get("ep", [""])[0]
        code = f"S{season:02d}" + (f"E{int(ep):02d}" if ep else "")
        attrs = {"tvdbid": 81189, "season": f"S{season:02d}"}
        if ep:
            attrs["episode"] = f"E{int(ep):02d}"
        rows = [
            (f"Breaking.Bad.{code}.2160p.WEB-DL.DDP5.1.HDR.H.265-NTb", 9_800_000_000 if not ep else 7_100_000_000, 5045),
            (f"Breaking.Bad.{code}.1080p.BluRay.x264-ROVERS", 4_100_000_000 if not ep else 2_300_000_000, 5040),
            (f"Breaking.Bad.{code}.1080p.WEB-DL.DD5.1.H.264-NTb", 3_000_000_000 if not ep else 1_700_000_000, 5040),
            (f"Breaking.Bad.{code}.720p.HDTV.x264-CTU", 1_400_000_000 if not ep else 900_000_000, 5040),
            (f"Breaking.Bad.{code}.German.DL.1080p.BluRay.x264-iNTENTiON", 4_400_000_000 if not ep else 2_500_000_000, 5040),
        ]
        if STATE["unlisted"]:
            rows += unlisted_bb(season, ep)
        return rss([(a, b, c, attrs) for a, b, c in rows])
    tm = int(qs.get("tmdbid", ["0"])[0] or 0)
    if tm not in MOVIES:
        return rss([])
    m = MOVIES[tm]
    base = m["title"].replace(" ", ".").replace(":", "")
    y = m["year"]
    attrs = {"imdb": m["imdb"][2:], "tmdbid": tm}
    rows = [
        (f"{base}.{y}.2160p.UHD.BluRay.x265.10bit.HDR.DTS-HD.MA.7.1-SWTYBLZ", 21_000_000_000, 2045),
        (f"{base}.{y}.1080p.BluRay.x264-SPARKS", 8_600_000_000, 2040),
        (f"{base}.{y}.1080p.WEB-DL.DD5.1.H264-FGT", 4_200_000_000, 2040),
        (f"{base}.{y}.720p.BluRay.x264-AMIABLE", 4_400_000_000, 2040),
    ]
    return rss([(a, b, c, attrs) for a, b, c in rows])


NZB = b"""<?xml version="1.0" encoding="iso-8859-1" ?>
<!DOCTYPE nzb PUBLIC "-//newzBin//DTD NZB 1.1//EN" "http://www.newzbin.com/DTD/nzb/nzb-1.1.dtd">
<nzb xmlns="http://www.newzbin.com/DTD/2003/nzb"><file poster="demo" date="1700000000" subject="demo"><groups><group>alt.binaries.demo</group></groups><segments><segment bytes="100" number="1">demo@demo</segment></segments></file></nzb>"""


# ---- Watchlist stand-in (ADR 0019): plex.tv's discover and community APIs -------------------------
# A separate block: discover (/plextv/discover) serves the owner's Watchlist and the metadata of every
# entry, and the community GraphQL API (/plextv/community/api) lists friends and their Watchlists.
# The owner has Breaking Bad on theirs and Ellie, the friend, has Paddington. GET /_ctl?watchlist=1
# adds Paddington in Peru to Ellie's and El Camino to the owner's, which Watchlist sync requests on its
# next pass; =0 takes them off again. The first pass only records what is there (the baseline).
WATCH = {"added": False}
WATCH_KEYS = {  # rating key -> (Plex type, kind, TMDB id)
    "demo-bb": ("show", "series", 1396),
    "demo-pad": ("movie", "movie", 116149),
    "demo-peru": ("movie", "movie", 516729),
    "demo-camino": ("movie", "movie", 559969),
}
WATCH_FRIEND = dict(uuid="demo-ellie", username="ellie", displayName="Ellie")


def watch_title(key):
    typ, kind, tid = WATCH_KEYS[key]
    return typ, (MOVIES if kind == "movie" else SERIES)[tid]


def watchlist_of(who):
    keys = {"owner": ["demo-bb"] + (["demo-camino"] if WATCH["added"] else []),
            WATCH_FRIEND["uuid"]: ["demo-pad"] + (["demo-peru"] if WATCH["added"] else [])}.get(who)
    return keys


def watch_node(key):
    typ, m = watch_title(key)
    return dict(ratingKey=key, id=key, guid="plex://%s/%s" % (typ, key), type=typ, title=m.get("title") or m.get("name"))


def watch_guids(key):
    typ, kind, tid = WATCH_KEYS[key]
    if kind == "movie":
        return [{"id": "tmdb://%d" % tid}, {"id": "imdb://" + MOVIES[tid]["imdb"]}]
    return [{"id": "tmdb://%d" % tid}, {"id": "tvdb://%d" % SERIES[tid]["tvdb"]}]


class WatchlistStandIn:
    def watchlist_ctl(self, qs):
        WATCH["added"] = qs["watchlist"][0] == "1"
        return self.send(200, {"watchlist_added": WATCH["added"]})

    def watchlist_discover(self, p, qs):  # GET /plextv/discover/...
        if self.headers.get("X-Plex-Token") not in PLEX_ACCOUNTS:
            return self.send(401, {})
        if p == "/plextv/discover/library/sections/watchlist/all":
            keys = watchlist_of("owner")
            start = int(qs.get("X-Plex-Container-Start", ["0"])[0])
            size = int(qs.get("X-Plex-Container-Size", ["50"])[0])
            page = keys[start:start + size]
            mc = {"size": len(page), "totalSize": len(keys), "offset": start}
            if page:
                mc["Metadata"] = [watch_node(k) for k in page]
            return self.send(200, {"MediaContainer": mc})
        key = p.rsplit("/", 1)[-1]
        if p.startswith("/plextv/discover/library/metadata/") and key in WATCH_KEYS:
            node = watch_node(key)
            node["Guid"] = watch_guids(key)
            return self.send(200, {"MediaContainer": {"size": 1, "Metadata": [node]}})
        return self.send(404, {})

    def watchlist_graphql(self, body):  # POST /plextv/community/api
        if self.headers.get("X-Plex-Token") != DEMO_OWNER_TOKEN:
            return self.send(401, {})
        q = json.loads(body or b"{}")
        if "allFriendsV2" in q.get("query", ""):
            user = dict(id=WATCH_FRIEND["uuid"], username=WATCH_FRIEND["username"], displayName=WATCH_FRIEND["displayName"], avatar="")
            return self.send(200, {"data": {"allFriendsV2": [{"user": user, "createdAt": "2024-01-01T00:00:00Z"}]}})
        keys = watchlist_of(q.get("variables", {}).get("user", {}).get("id", ""))
        if "watchlist(" in q.get("query", "") and keys is not None:
            nodes = [dict(id=k, title=watch_node(k)["title"], type=watch_node(k)["type"].upper()) for k in keys]
            return self.send(200, {"data": {"userV2": {"watchlist": {"nodes": nodes, "pageInfo": {"hasNextPage": False, "endCursor": None}}}}})
        return self.send(200, {"errors": [{"message": "unknown query"}]})


class H(WatchlistStandIn, BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *a):
        sys.stderr.write("%s %s\n" % (self.command, self.path))

    def send(self, code, body, ctype="application/json"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body)
        if isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        u = urlparse(self.path)
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n) if n else b""
        if u.path == "/v4/login":
            return self.send(200, {"data": {"token": "tok"}, "status": "success"})
        if u.path == "/sab/api":
            return self.sab(parse_qs(u.query), body)
        if u.path == "/plextv/community/api":
            return self.watchlist_graphql(body)
        if u.path == "/plextv/api/v2/pins":
            pid = len(STATE["pins"]) + 1
            code = "demo%03dabcdefghijklmnopq" % pid
            STATE["pins"][pid] = {"code": code, "token": None}
            return self.send(201, {"id": pid, "code": code, "authToken": None})
        self.send(404, {"status": "failure"})

    def do_GET(self):
        u = urlparse(self.path)
        p, qs = u.path, parse_qs(u.query)
        if p == "/_ctl" and "watchlist" in qs:
            return self.watchlist_ctl(qs)
        if p.startswith("/plextv/discover/"):
            return self.watchlist_discover(p, qs)
        if p == "/_ctl":
            if "releases" in qs:
                STATE["releases"] = qs["releases"][0] == "1"
            if "unlisted" in qs:
                STATE["unlisted"] = qs["unlisted"][0] == "1"
            return self.send(200, {"releases": STATE["releases"], "unlisted": STATE["unlisted"]})
        if p.startswith("/t/p/"):
            f = os.path.join(POSTERS, os.path.basename(p))
            if not os.path.exists(f):
                return self.send(404, "no")
            return self.send(200, open(f, "rb").read(), "image/jpeg")
        if p.startswith("/3/"):
            return self.tmdb(p[2:], qs)
        if p.startswith("/v4/"):
            return self.tvdb(p[3:], qs)
        if p == "/nzb/api":
            if qs.get("t", [""])[0] == "caps":
                return self.send(200, caps(), "application/xml")
            return self.send(200, releases(qs), "application/rss+xml")
        if p.startswith("/nzb/get/"):
            return self.send(200, NZB, "application/x-nzb")
        if p == "/sab/api":
            return self.sab(qs, b"")
        if p.startswith("/plextv/"):
            return self.plextv(p[len("/plextv"):], qs)
        if p.startswith("/plex/"):
            return self.plex(p[len("/plex"):])
        self.send(404, {"status_code": 34})

    def plextv(self, p, qs):
        if p == "/auth":
            return self.send(200, PLEX_AUTH_PAGE, "text/html; charset=utf-8")
        if p == "/_authorise":  # what the sign-in page does for the account that visits it
            for pin in STATE["pins"].values():
                if pin["code"] == qs.get("code", [""])[0]:
                    pin["token"] = DEMO_REQUESTER_TOKEN
            return self.send(200, {"ok": True})
        parts = p.strip("/").split("/")
        if parts[:3] == ["api", "v2", "pins"] and len(parts) == 4 and parts[3].isdigit():
            pin = STATE["pins"].get(int(parts[3]))
            if not pin or pin["code"] != qs.get("code", [""])[0]:
                return self.send(404, {"errors": [{"code": 1020, "message": "Code not found or expired"}]})
            return self.send(200, {"id": int(parts[3]), "code": pin["code"], "authToken": pin["token"]})
        acct = PLEX_ACCOUNTS.get(self.headers.get("X-Plex-Token", ""))
        if parts == ["api", "v2", "user"] and acct:
            return self.send(200, acct)
        if parts == ["api", "users"] and self.headers.get("X-Plex-Token") == DEMO_OWNER_TOKEN:
            e = PLEX_ACCOUNTS[DEMO_REQUESTER_TOKEN]
            return self.send(200, '<?xml version="1.0" encoding="UTF-8"?><MediaContainer size="1">'
                             '<User id="%d" title="%s" username="%s" home="0" restricted="0">'
                             '<Server id="1" name="Plex" machineIdentifier="%s"/></User></MediaContainer>'
                             % (e["id"], e["title"], e["username"], DEMO_MACHINE), "application/xml")
        self.send(401 if parts[:2] == ["api", "v2"] or parts[:1] == ["api"] else 404, {"errors": [{"code": 1001, "message": "User could not be authenticated"}]})

    def plex(self, p):
        if self.plex_history(p):
            return
        if p == "/identity":
            return self.send(200, {"MediaContainer": {"size": 0, "claimed": True, "machineIdentifier": DEMO_MACHINE, "version": "1.41.0"}})
        if p == "/library/sections":
            return self.send(200, {"MediaContainer": {"size": 0, "Directory": []}})
        self.send(404, {})

    # --- PLEX PLAY HISTORY (Watch-ahead) -------------------------------------------------
    # The Plex server's play history of every account and the show metadata Kestrel reads to
    # map a play to a TheTVDB id. All plays are of Breaking Bad (Plex key PLEX_SHOW_KEY).

    def plex_history(self, p):
        """Answers the history calls; False for any other Plex path."""
        qs = parse_qs(urlparse(self.path).query)
        if p == "/_play":
            at = int(time.time())
            PLEX_PLAYS.append(dict(type="episode", grandparentKey=PLEX_SHOW_KEY, parentIndex=int(qs.get("season", ["1"])[0]),
                                   index=int(qs.get("episode", ["1"])[0]), viewedAt=at, accountID=1))
            self.send(200, {"plays": len(PLEX_PLAYS)})
        elif p == "/status/sessions/history/all":
            lo = int((qs.get("viewedAt>") or ["0"])[0])
            start, size = int((qs.get("X-Plex-Container-Start") or ["0"])[0]), int((qs.get("X-Plex-Container-Size") or ["200"])[0])
            rows = [x for x in PLEX_PLAYS if x["viewedAt"] >= lo][start:start + size]
            self.send(200, {"MediaContainer": {"size": len(rows), "Metadata": rows}})
        elif p == PLEX_SHOW_KEY:
            self.send(200, {"MediaContainer": {"size": 1, "Metadata": [dict(type="show", title="Breaking Bad", guid="plex://show/demo",
                                                                          Guid=[dict(id="tvdb://81189"), dict(id="imdb://tt0903747")])]}})
        else:
            return False
        return True

    def tmdb(self, p, qs):
        parts = p.strip("/").split("/")
        if parts == ["search", "multi"]:
            return self.send(200, search(qs.get("query", [""])[0]))
        if parts[0] == "find":
            i = parts[1]
            mv = [{"id": k} for k, m in MOVIES.items() if m["imdb"] == i]
            tvr = [{"id": k} for k, s in SERIES.items() if s["imdb"] == i or str(s["tvdb"]) == i]
            return self.send(200, {"movie_results": mv, "tv_results": tvr})
        if parts[1:] == ["changes"]:
            return self.send(200, {"results": [], "page": 1, "total_pages": 1, "total_results": 0})
        if parts[0] == "movie" and int(parts[1]) in MOVIES:
            return self.send(200, movie(int(parts[1])))
        if parts[0] == "tv" and int(parts[1]) in SERIES:
            if len(parts) == 3 and parts[2] == "external_ids":
                s = SERIES[int(parts[1])]
                return self.send(200, {"id": int(parts[1]), "imdb_id": s["imdb"], "tvdb_id": s["tvdb"]})
            return self.send(200, tv(int(parts[1])))
        self.send(404, {"status_code": 34, "status_message": "The resource you requested could not be found."})

    def tvdb(self, p, qs):
        parts = p.strip("/").split("/")
        if parts[0] == "updates":
            return self.send(200, {"status": "success", "data": [], "links": {"next": None}})
        if parts[0] == "search":
            i = parts[-1]
            for s in SERIES.values():
                if s["imdb"] == i:
                    return self.send(200, {"status": "success", "data": [{"series": {"id": s["tvdb"]}}]})
            return self.send(200, {"status": "success", "data": []})
        if parts[0] == "series":
            tid = int(parts[1])
            if tid not in TVDB:
                return self.send(404, {"status": "failure", "message": "NotFoundException"})
            s = SERIES[TVDB[tid]]
            if s.get("broken"):
                return self.send(500, {"status": "failure", "message": "Internal Server Error"})
            if s.get("slow"):
                time.sleep(25)
            if len(parts) == 2 or parts[2] == "extended":  # the extended record adds the air time and the network
                return self.send(200, {"status": "success", "data": {
                    "id": tid, "name": s["name"], "firstAired": s["date"], "lastAired": s["last"],
                    "status": {"name": s["status"]}, "year": s["date"][:4], "originalLanguage": "eng", "aliases": [],
                    "originalCountry": "usa", "airsTime": s.get("airs", ""),
                    "originalNetwork": {"name": s["network"], "country": "usa"}}})
            eps = s["eps"]()
            lang = parts[4] if len(parts) > 4 else None
            out = []
            for e in eps:
                d = {k: e[k] for k in ("id", "seriesId", "name", "aired", "number", "seasonNumber")}
                d["overview"] = f"Season {e['seasonNumber']}, episode {e['number']} of {s['name']}: {e['name']}." if e["name"] else ""
                if lang == "deu":
                    d["name"] = e["de"]
                elif lang:
                    d["name"] = None
                out.append(d)
            return self.send(200, {"status": "success", "data": {"series": {"id": tid}, "episodes": out},
                                   "links": {"prev": None, "next": None}})
        self.send(404, {"status": "failure"})

    def sab(self, qs, body):
        mode = qs.get("mode", [""])[0]
        if mode == "version":
            return self.send(200, {"version": "4.5.1"})
        if mode == "get_config":
            return self.send(200, {"config": {"misc": {"complete_dir": "/downloads/complete"},
                                              "categories": [{"name": "*"}, {"name": "movies"}, {"name": "tv"}]}})
        if mode in ("addfile", "addurl"):
            nzo = "SABnzbd_nzo_%d" % (len(STATE["queue"]) + 1)
            name = qs.get("nzbname", [""])[0] or "download"
            STATE["queue"].append({"index": len(STATE["queue"]), "nzo_id": nzo, "filename": name,
                                   "cat": qs.get("cat", ["tv"])[0], "status": "Downloading", "priority": "-100",
                                   "mb": "2200.00", "mbleft": "1320.00", "percentage": "40", "timeleft": "0:12:30", "labels": []})
            return self.send(200, {"status": True, "nzo_ids": [nzo]})
        if mode == "queue":
            if qs.get("name", [""])[0] == "delete":
                STATE["queue"] = [s for s in STATE["queue"] if s["nzo_id"] != qs.get("value", [""])[0]]
                return self.send(200, {"status": True})
            return self.send(200, {"queue": {"version": "4.5.1", "paused": False, "slots": STATE["queue"]}})
        if mode == "history":
            if qs.get("name", [""])[0] == "delete":
                return self.send(200, {"status": True})
            return self.send(200, {"history": {"noofslots": 0, "slots": []}})
        self.send(200, {"status": False, "error": "unknown mode"})


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Fake TMDB, TheTVDB, Newznab, SABnzbd, plex.tv and Plex for the Kestrel demo.")
    ap.add_argument("--port", type=int, default=PORT)
    ap.add_argument("--posters", default=POSTERS, help="directory of <kind>-<tmdb id>.jpg posters")
    ap.add_argument("--titles", action="store_true", help="list the titles for posters.mjs and exit")
    args = ap.parse_args()
    if args.titles:
        for k, m in MOVIES.items():
            print(f"movie\t{k}\t{m['title']}\t{m['year']}")
        for k, s in SERIES.items():
            print(f"tv\t{k}\t{s['name']}\t{s['date'][:4]}")
        sys.exit(0)
    PORT, POSTERS = args.port, os.path.abspath(args.posters)
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
