# Third-party ratings (IMDb, Rotten Tomatoes)

Kestrel shows TMDB's own score for a Title (#120) and nothing else: no IMDb
rating, no Rotten Tomatoes score.

## Why this is out of scope

Neither IMDb nor Rotten Tomatoes has a free official API. The practical route
to both is OMDb, and OMDb doesn't fit how Kestrel handles metadata keys:

- Every OMDb request needs an API key, and keys are issued per person. The
  free tier allows 1,000 requests a day per key, so one key embedded in Kestrel
  would share that quota across every install. TMDB and TheTVDB work out of
  the box with built-in keys; OMDb can't.
- That leaves a key every user has to request and paste into Settings, for a
  line on the Title page. That's too much setup for too little gain.
- Rotten Tomatoes has no API of its own, so without OMDb there's no source for
  it at all.

TMDB's score already covers the "is this any good?" question on the Title page
and in the Add Title panel.

IMDb's free non-commercial datasets (`title.ratings.tsv.gz`) would give IMDb
ratings without a key. We considered them and decided TMDB's score is enough.
Raise them in a new issue if that changes.

## Prior requests

- #133: "Ratings from IMDb and Rotten Tomatoes through an optional OMDb key"
