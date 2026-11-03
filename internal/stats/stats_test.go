package stats_test

import (
	"context"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/stats"
	"github.com/hyprsh/kestrel/internal/store"
	"github.com/hyprsh/kestrel/internal/store/storetest"
)

// now is Saturday 2026-10-31 noon UTC; the 30-day range is 2026-10-02 to 2026-10-31.
var now = time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC)

type rig struct {
	t  *testing.T
	st *store.Store
}

func newRig(t *testing.T) rig {
	t.Helper()
	st, err := store.Open(context.Background(), store.Options{Dir: storetest.Dir(t)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return rig{t, st}
}

func (r rig) exec(q string, args ...any) {
	r.t.Helper()
	if _, err := r.st.Write().ExecContext(context.Background(), q, args...); err != nil {
		r.t.Fatalf("%s: %v", q, err)
	}
}

func at(days int, hours int) string {
	return now.AddDate(0, 0, days).Add(time.Duration(hours) * time.Hour).Format(time.RFC3339)
}

var guid atomic.Int64

// grab inserts a Grab by indexer 1 or 2 that ended in state at updated.
func (r rig) grab(indexer int, state, failure, updated string, size int64, started, done string) int64 {
	r.t.Helper()
	n := guid.Add(1)
	var f, s, d any
	if failure != "" {
		f = failure
	}
	if started != "" {
		s, d = started, done
	}
	res, err := r.st.Write().ExecContext(context.Background(), `INSERT INTO grabs (release_guid, release_name, indexer_id, indexer_name, size, published_at, score, parsed, verdict,
		client_instance_id, client_id, state, failure, created_at, updated_at, download_started_at, download_done_at)
		VALUES (?, 'x', ?, ?, ?, ?, 0, '{}', '{}', 9, ?, ?, ?, ?, ?, ?, ?)`,
		fmt.Sprint("g", n), indexer, fmt.Sprint("Indexer ", indexer), size, updated, fmt.Sprint("c", n), state, f, updated, updated, s, d)
	if err != nil {
		r.t.Fatal(err)
	}
	id, _ := res.LastInsertId()
	return id
}

func (r rig) compute(rng string, disks ...stats.Disk) stats.Result {
	r.t.Helper()
	rg, ok := stats.ParseRange(rng)
	if !ok {
		r.t.Fatalf("range %q", rng)
	}
	res, err := stats.New(r.st).Compute(context.Background(), now, rg, disks)
	if err != nil {
		r.t.Fatal(err)
	}
	return res
}

func TestRangesAreSevenThirtyAndNinetyDays(t *testing.T) {
	t.Parallel()
	for key, days := range map[string]int{"7d": 7, "30d": 30, "90d": 90} {
		r, ok := stats.ParseRange(key)
		if !ok || r.Days != days {
			t.Errorf("ParseRange(%q) = %v, %v", key, r, ok)
		}
	}
	if _, ok := stats.ParseRange("1d"); ok {
		t.Error("ParseRange accepted 1d")
	}
	w := stats.WindowOf(now, stats.DefaultRange)
	if w.From != time.Date(2026, 10, 2, 0, 0, 0, 0, time.UTC) || w.To != time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC) {
		t.Errorf("window = %v to %v", w.From, w.To)
	}
	if w.PrevTo != w.From || w.PrevFrom != time.Date(2026, 9, 2, 0, 0, 0, 0, time.UTC) {
		t.Errorf("previous = %v to %v", w.PrevFrom, w.PrevTo)
	}
}

func TestGrabsPerDayCountsFinishedGrabsAndFillsEmptyDays(t *testing.T) {
	t.Parallel()
	r := newRig(t)
	r.grab(1, "imported", "", at(0, -1), 1, "", "")
	r.grab(1, "imported", "", at(0, -2), 1, "", "")
	r.grab(2, "failed", "download_failed", at(0, -3), 1, "", "")
	r.grab(1, "imported", "", at(-3, 0), 1, "", "")
	r.grab(1, "downloading", "", at(-3, 0), 1, "", "") // not finished
	r.grab(1, "imported", "", at(-40, 0), 1, "", "")   // before the range
	res := r.compute("30d")
	if len(res.Days) != 30 {
		t.Fatalf("%d days, want 30", len(res.Days))
	}
	last, mid := res.Days[29], res.Days[26]
	if last.Imported != 2 || last.Failed != 1 || mid.Imported != 1 || mid.Failed != 0 || res.Days[0].Imported != 0 {
		t.Errorf("days = today %+v, three days ago %+v, first %+v", last, mid, res.Days[0])
	}
	if res.Imported != 3 || res.Failed != 1 {
		t.Errorf("totals = %d imported, %d failed, want 3 and 1", res.Imported, res.Failed)
	}
	if got := r.compute("7d"); got.Imported != 3 || len(got.Days) != 7 {
		t.Errorf("7d = %d imported over %d days", got.Imported, len(got.Days))
	}
	r.grab(1, "imported", "", at(-20, 0), 1, "", "")
	if got := r.compute("7d").Imported; got != 3 {
		t.Errorf("7d counts a Grab from 20 days ago: %d", got)
	}
}

func TestIndexersCountGrabsHitsAndMedianAnswer(t *testing.T) {
	t.Parallel()
	r := newRig(t)
	for range 3 {
		r.grab(1, "imported", "", at(-1, 0), 1, "", "")
	}
	r.grab(1, "failed", "download_failed", at(-1, 0), 1, "", "")
	r.grab(2, "imported", "", at(-1, 0), 1, "", "")
	search := func(id, ok, fit, ms int) {
		r.exec(`INSERT INTO indexer_searches (indexer_id, indexer_name, at, ok, releases, fit, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			id, fmt.Sprint("Indexer ", id), at(-1, 0), ok, fit, fit, ms)
	}
	search(1, 1, 1, 500)
	search(1, 1, 1, 900)
	search(1, 1, 0, 700)
	search(1, 0, 0, 5000) // unanswered: neither a hit nor an answer time
	search(2, 1, 0, 2000)
	r.exec(`INSERT INTO indexer_searches (indexer_id, indexer_name, at, ok, releases, fit, duration_ms) VALUES (1, 'Indexer 1', ?, 1, 1, 1, 1)`, at(-60, 0))

	res := r.compute("30d")
	if len(res.Indexers) != 2 {
		t.Fatalf("indexers = %+v", res.Indexers)
	}
	one, two := res.Indexers[0], res.Indexers[1]
	if one.Name != "Indexer 1" || one.Imported != 3 || one.Failed != 1 || one.Searches != 4 || one.Hits != 2 {
		t.Errorf("indexer 1 = %+v", one)
	}
	if one.HitRate == nil || *one.HitRate < 0.66 || *one.HitRate > 0.67 {
		t.Errorf("indexer 1 hit rate = %v, want 2 of the 3 answered searches", one.HitRate)
	}
	if one.MedianAnswer == nil || *one.MedianAnswer != 700*time.Millisecond {
		t.Errorf("indexer 1 median answer = %v, want 700ms", one.MedianAnswer)
	}
	if two.HitRate == nil || *two.HitRate != 0 || two.Imported != 1 {
		t.Errorf("indexer 2 = %+v", two)
	}
	if res.Best != 0 {
		t.Errorf("best = %d, want indexer 1", res.Best)
	}
}

func TestBestIndexerNeedsAHitRateOfHalfAndTheMostImportedGrabs(t *testing.T) {
	t.Parallel()
	rate := func(f float64) *float64 { return &f }
	ixs := []stats.Indexer{
		{Name: "Busy but missing", Imported: 30, HitRate: rate(0.4)},
		{Name: "No searches", Imported: 40},
		{Name: "Steady", Imported: 12, HitRate: rate(0.5), Failed: 3},
		{Name: "Steadier", Imported: 12, HitRate: rate(0.5), Failed: 1},
		{Name: "Nothing imported", Imported: 0, HitRate: rate(1)},
	}
	if got := stats.BestIndexer(ixs); got != 3 {
		t.Errorf("best = %d, want Steadier (same imports and hit rate as Steady, fewer failures)", got)
	}
	ixs[2].HitRate = rate(0.9)
	if got := stats.BestIndexer(ixs); got != 2 {
		t.Errorf("best = %d, want Steady (higher hit rate on equal imports)", got)
	}
	if got := stats.BestIndexer(ixs[:2]); got != -1 {
		t.Errorf("best = %d, want none when nobody has a hit rate of 50%%", got)
	}
	if got := stats.BestIndexer(nil); got != -1 {
		t.Errorf("best of none = %d", got)
	}
}

// done is a time n seconds after the RFC 3339 time start.
func done(t *testing.T, start string, n int) string {
	t.Helper()
	st, err := time.Parse(time.RFC3339, start)
	if err != nil {
		t.Fatal(err)
	}
	return st.Add(time.Duration(n) * time.Second).Format(time.RFC3339)
}

func TestDownloadClientAveragesSpeedAndTakesTheMedianDownloadTime(t *testing.T) {
	t.Parallel()
	r := newRig(t)
	const mb = 1_000_000
	// 600 MB in 60 s, 1200 MB in 120 s and 9000 MB in 600 s: 10800 MB over 780 s.
	for _, d := range []struct{ size, secs int64 }{{600 * mb, 60}, {1200 * mb, 120}, {9000 * mb, 600}} {
		start := at(-1, 0)
		r.grab(1, "imported", "", start, d.size, start, done(t, start, int(d.secs)))
	}
	r.grab(1, "failed", "download_failed", at(-2, 0), mb, "", "")
	r.grab(1, "failed", "lost", at(-2, 0), mb, "", "")
	r.grab(1, "failed", "download_failed", at(-50, 0), mb, "", "") // before the range

	c := r.compute("30d").Client
	if c.Completed != 3 {
		t.Errorf("completed = %d, want 3", c.Completed)
	}
	if c.AvgBytesPerSecond == nil || int64(*c.AvgBytesPerSecond) != 10800*mb/780 {
		t.Errorf("average speed = %v, want %d", deref(c.AvgBytesPerSecond), 10800*mb/780)
	}
	if c.MedianDownload == nil || *c.MedianDownload != 2*time.Minute {
		t.Errorf("median download = %v, want 2m", c.MedianDownload)
	}
	if c.Failed != 1 {
		t.Errorf("failed in the client = %d, want the one download_failed in the range (a lost job is not the client's failure)", c.Failed)
	}
	if len(c.SpeedColumns) != 5 {
		t.Fatalf("speed columns = %d, want the 5 weeks of 30 days", len(c.SpeedColumns))
	}
	if w := c.SpeedColumns[4]; w.BytesPerSecond == nil || int64(*w.BytesPerSecond) != 10800*mb/780 {
		t.Errorf("last week's speed = %v", deref(w.BytesPerSecond))
	}
	if old := c.SpeedColumns[0]; old.BytesPerSecond != nil {
		t.Errorf("a week without a download has a speed: %v", *old.BytesPerSecond)
	}
}

func TestDownloadSpeedHasTheColumnsOfTheGrabsChartForEveryRange(t *testing.T) {
	t.Parallel()
	r := newRig(t)
	start := at(-1, 0)
	r.grab(1, "imported", "", start, 600_000_000, start, done(t, start, 60))
	for rng, want := range map[string]int{"7d": 7, "30d": 5, "90d": 13} {
		res := r.compute(rng)
		if len(res.Client.SpeedColumns) != want || len(res.Columns) != want {
			t.Errorf("%s: %d speed columns and %d Grabs columns, want %d", rng, len(res.Client.SpeedColumns), len(res.Columns), want)
			continue
		}
		for i, c := range res.Client.SpeedColumns {
			if c.Period != res.Columns[i].Period {
				t.Errorf("%s: speed column %d is %v, the Grabs column %v", rng, i, c.Period, res.Columns[i].Period)
			}
		}
		yesterday := res.Window.To.AddDate(0, 0, -2)
		for _, c := range res.Client.SpeedColumns {
			in := !yesterday.Before(c.From) && !yesterday.After(c.To)
			if in != (c.BytesPerSecond != nil) {
				t.Errorf("%s: column %v to %v has speed %v, yesterday's download is in it: %v", rng, c.From, c.To, c.BytesPerSecond != nil, in)
			}
		}
	}
}

func TestDownloadClientWithoutTimingsSaysNothing(t *testing.T) {
	t.Parallel()
	r := newRig(t)
	r.grab(1, "imported", "", at(-1, 0), 1, "", "")
	c := r.compute("30d").Client
	if c.Completed != 0 || c.AvgBytesPerSecond != nil || c.MedianDownload != nil {
		t.Errorf("client = %+v, want nothing for Grabs recorded before the timings", c)
	}
}

// library inserts a Movie and a Series Title with a Version each and returns their Version ids.
func (r rig) library() (movieVersion, seriesVersion int64) {
	r.t.Helper()
	r.exec(`INSERT INTO titles (id, kind, tmdb_id, title, original_title, primary_title, root_folder, added_at, refreshed_at) VALUES
		(1, 'movie', 1, 'M', 'M', 'M', '/m', ?, ?), (2, 'series', 2, 'S', 'S', 'S', '/s', ?, ?)`, at(-100, 0), at(-100, 0), at(-100, 0), at(-100, 0))
	r.exec(`INSERT INTO versions (id, title_id, slot, profile_key, added_at) VALUES (1, 1, 'standard', 'hd-primary', ?), (2, 2, 'standard', 'hd-primary', ?), (3, 2, '4k', '4k-primary', ?)`, at(-100, 0), at(-100, 0), at(-100, 0))
	return 1, 2
}

func (r rig) file(version int64, size int64, release, parsed, imported string, withGrab bool) {
	r.t.Helper()
	var g any
	if withGrab {
		g = r.grab(1, "imported", "", imported, size, "", "")
	}
	r.exec(`INSERT INTO files (version_id, path, size, release_name, parsed_release, grab_id, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		version, fmt.Sprint("/f/", guid.Load(), release), size, release, parsed, g, imported)
}

func parsed(group, source, modifier string) string {
	return fmt.Sprintf(`{"releaseGroup":%q,"quality":{"quality":{"source":%q,"modifier":%q}}}`, group, source, modifier)
}

func TestLibraryQualityAndStorageFromFiles(t *testing.T) {
	t.Parallel()
	r := newRig(t)
	movie, series := r.library()
	const gb = 1 << 30
	r.file(movie, 10*gb, "a", parsed("DON", "bluray", "none"), at(-200, 0), false)
	r.file(series, 20*gb, "b", parsed("NTb", "webdl", "none"), at(-10, 0), true)
	r.file(series, 20*gb, "c", parsed("NTb", "webdl", "none"), at(-9, 0), true)
	r.file(series, 10*gb, "d", parsed("FLUX", "webrip", "none"), at(-8, 0), true)
	r.file(3, 20*gb, "e", parsed("FLUX", "webdl", "remux"), at(-70, 0), true) // 4K Remux, outside 30 days

	res := r.compute("30d", stats.Disk{Path: "/m", Free: 1000 * gb, Total: 4000 * gb}, stats.Disk{Path: "/s", Free: 500 * gb, Total: 2000 * gb})
	if l := res.Library; l.Titles != 2 || l.Movies != 1 || l.Series != 1 || l.Bytes != 80*gb {
		t.Errorf("library = %+v", l)
	}
	if len(res.Quality) != 2 {
		t.Fatalf("quality = %+v", res.Quality)
	}
	if q := res.Quality[0]; q.Slot != "standard" || q.Files != 4 || q.RemuxBluray != 1 || q.WebDL != 2 || q.WebRipLow != 1 {
		t.Errorf("standard quality = %+v", q)
	}
	if q := res.Quality[1]; q.Slot != "4k" || q.Files != 1 || q.RemuxBluray != 1 {
		t.Errorf("4k quality = %+v", q)
	}
	if len(res.Groups) != 2 || res.Groups[0].Name != "NTb" || res.Groups[0].Files != 2 || res.Groups[1].Name != "FLUX" || res.Groups[1].Files != 1 {
		t.Errorf("groups = %+v, want the Grab-brought files of the range only, most first", res.Groups)
	}
	st := res.Storage
	if st.Free != 1500*gb || st.Total != 6000*gb {
		t.Errorf("free %d of %d", st.Free, st.Total)
	}
	// 50 GB came in the 30 days: 50/30*7 a week.
	came := float64(50 * gb)
	want := int64(came / (30.0 / 7))
	if st.GrowthBytesPerWeek == nil || *st.GrowthBytesPerWeek != want {
		t.Errorf("growth = %v", st.GrowthBytesPerWeek)
	}
	if st.SeriesShare == nil || *st.SeriesShare != 70.0/80 {
		t.Errorf("series share = %v, want 70 of 80 GB", st.SeriesShare)
	}
	if st.MonthsUntilFull == nil || *st.MonthsUntilFull < 29 || *st.MonthsUntilFull > 30 {
		t.Errorf("months until full = %v, want 1500 GB over ~11.7 GB a week (about 29.6 months)", deref(st.MonthsUntilFull))
	}
}

func TestGroupsListMoreThanFiveUpToTheCap(t *testing.T) {
	t.Parallel()
	r := newRig(t)
	movie, _ := r.library()
	for i := range stats.MaxGroups + 5 {
		// Groups bring 1 to 3 files each, so the cap cuts among ties by name.
		for range i%3 + 1 {
			r.file(movie, 1, "x", parsed(fmt.Sprintf("G%02d", i), "webdl", "none"), at(-1, 0), true)
		}
	}
	res := r.compute("30d")
	if len(res.Groups) != stats.MaxGroups {
		t.Fatalf("groups = %d, want %d", len(res.Groups), stats.MaxGroups)
	}
	if res.Groups[0].Files != 3 || res.Groups[0].Name != "G02" || res.Groups[1].Name != "G05" {
		t.Errorf("groups = %+v, want most files first, ties by name", res.Groups[:3])
	}
}

func TestStorageHasNoGrowthWhenNothingCameIn(t *testing.T) {
	t.Parallel()
	r := newRig(t)
	movie, _ := r.library()
	r.file(movie, 1<<30, "a", parsed("DON", "bluray", "none"), at(-200, 0), false)
	st := r.compute("30d", stats.Disk{Path: "/m", Free: 100, Total: 1000}).Storage
	if st.GrowthBytesPerWeek != nil || st.MonthsUntilFull != nil {
		t.Errorf("growth %v, months %v: nothing came in, so neither is measurable", st.GrowthBytesPerWeek, st.MonthsUntilFull)
	}
	if st.Free != 100 || st.Total != 1000 {
		t.Errorf("free %d total %d", st.Free, st.Total)
	}
}

func TestADiskSharedByRootFoldersCountsOnce(t *testing.T) {
	t.Parallel()
	disks := []stats.Disk{{Path: "/a", Free: 10, Total: 100}, {Path: "/b", Free: 10, Total: 100}, {Path: "/c", Free: 5, Total: 50}}
	st := stats.StorageOf(disks, 0, 30, 0, 0)
	if st.Free != 15 || st.Total != 150 || len(st.Disks) != 3 {
		t.Errorf("storage = %+v, want 15 free of 150 and all three folders listed", st)
	}
	if st.SeriesShare != nil || st.GrowthBytesPerWeek != nil {
		t.Errorf("share %v growth %v for an empty Library", st.SeriesShare, st.GrowthBytesPerWeek)
	}
}

func TestRequestsCountDoneAndSearchingPerRequester(t *testing.T) {
	t.Parallel()
	r := newRig(t)
	movie, _ := r.library()
	req := func(n int, who, name, created, outcome string, filled ...string) {
		r.exec(`INSERT INTO requests (id, source, source_request_id, requester_id, requester_name, title_id, outcome, created_at) VALUES (?, 'plex', ?, ?, ?, 1, ?, ?)`,
			n, fmt.Sprint("r", n), who, name, outcome, created)
		for i, f := range filled {
			slot := []string{"standard", "4k"}[i]
			var fa any
			if f != "" {
				fa = f
			}
			r.exec(`INSERT INTO request_slots (request_id, slot, version_id, filled_at) VALUES (?, ?, ?, ?)`, n, slot, movie, fa)
		}
	}
	req(1, "e", "Ellie", at(-5, 0), "accepted", at(-5, 2))   // done in 2 h
	req(2, "e", "Ellie", at(-4, 0), "accepted", at(-3, 0))   // done in 1 d
	req(3, "e", "Ellie", at(-3, 0), "accepted", "")          // searching
	req(4, "s", "Sam", at(-2, 0), "accepted", at(-2, 1), "") // two Slots, one still empty: not done
	req(5, "s", "Sam", at(-2, 0), "rejected")                // rejected: not counted
	req(6, "s", "Sam", at(-90, 0), "accepted", at(-90, 1))   // before the range

	rq := r.compute("30d").Requests
	if rq.Total != 4 || rq.Searching != 2 {
		t.Errorf("requests = %+v, want 4 with 2 still searching", rq)
	}
	if rq.MedianFulfil == nil || *rq.MedianFulfil != 13*time.Hour {
		t.Errorf("median to fulfil = %v, want 13h (the middle of 2h and 24h)", rq.MedianFulfil)
	}
	if len(rq.Requesters) != 2 || rq.Requesters[0] != (stats.Requester{Name: "Ellie", Source: "plex", Requests: 3, Done: 2}) ||
		rq.Requesters[1] != (stats.Requester{Name: "Sam", Source: "plex", Requests: 1, Done: 0}) {
		t.Errorf("requesters = %+v", rq.Requesters)
	}
}

func TestEmptyDatabaseGivesZerosAndNothingElse(t *testing.T) {
	t.Parallel()
	res := newRig(t).compute("90d")
	if len(res.Days) != 90 || res.Imported != 0 || res.Failed != 0 || len(res.Indexers) != 0 || res.Best != -1 {
		t.Errorf("result = %+v", res)
	}
	if res.Client.Completed != 0 || res.Client.AvgBytesPerSecond != nil || len(res.Groups) != 0 || len(res.Quality) != 0 || res.Requests.Total != 0 {
		t.Errorf("client %+v groups %v quality %v requests %+v", res.Client, res.Groups, res.Quality, res.Requests)
	}
	if res.Storage.MonthsUntilFull != nil || res.Storage.SeriesShare != nil {
		t.Errorf("storage = %+v", res.Storage)
	}
}

func TestMedianDuration(t *testing.T) {
	t.Parallel()
	s := time.Second
	for _, c := range []struct {
		in   []time.Duration
		want time.Duration
	}{{[]time.Duration{3 * s}, 3 * s}, {[]time.Duration{9 * s, 1 * s, 5 * s}, 5 * s}, {[]time.Duration{1 * s, 2 * s, 3 * s, 10 * s}, 2500 * time.Millisecond}} {
		if got := stats.MedianDuration(c.in); got == nil || *got != c.want {
			t.Errorf("median(%v) = %v, want %v", c.in, got, c.want)
		}
	}
	if stats.MedianDuration(nil) != nil {
		t.Error("median of none is not nil")
	}
}

func deref(f *float64) any {
	if f == nil {
		return nil
	}
	return *f
}

func TestResponseTimesAreEachIndexersMedianOverTheLastDay(t *testing.T) {
	r := newRig(t)
	search := func(id int64, ok int, took int, ago time.Duration) {
		r.exec(`INSERT INTO indexer_searches (indexer_id, indexer_name, at, ok, releases, fit, duration_ms) VALUES (?, 'x', ?, ?, 0, 0, ?)`,
			id, now.Add(-ago).UTC().Format(time.RFC3339), ok, took)
	}
	for _, ms := range []int{500, 700, 900, 600} { // the median of four is the mean of the middle two
		search(1, 1, ms, time.Hour)
	}
	search(1, 1, 9000, 25*time.Hour) // over a day old
	search(1, 0, 30000, time.Hour)   // a search that failed says nothing of how fast it answers
	search(2, 1, 800, 23*time.Hour)
	search(3, 0, 30000, time.Hour) // never answered

	got, err := stats.New(r.st).ResponseTimes(context.Background(), now)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[1] != 650*time.Millisecond || got[2] != 800*time.Millisecond {
		t.Errorf("response times = %v, want 650 ms for 1, 800 ms for 2 and none for 3", got)
	}
}

func TestBelowCutoffComesFromTheProfilesAndIsZeroWithoutThem(t *testing.T) {
	t.Parallel()
	r := newRig(t)
	rg, _ := stats.ParseRange("30d")
	res, err := stats.New(r.st).Compute(context.Background(), now, rg, nil)
	if err != nil || res.BelowCutoff != 0 {
		t.Fatalf("without a source: %d, %v", res.BelowCutoff, err)
	}
	res, err = stats.New(r.st).WithBelowCutoff(func(context.Context) (int, error) { return 12, nil }).Compute(context.Background(), now, rg, nil)
	if err != nil || res.BelowCutoff != 12 {
		t.Fatalf("with a source: %d, %v", res.BelowCutoff, err)
	}
}

func TestGrabColumnsAreDaysForSevenAndWeeksEndingOnTheLastDayForThirtyAndNinety(t *testing.T) {
	t.Parallel()
	r := newRig(t)
	r.grab(1, "imported", "", at(0, -1), 1, "", "")
	r.grab(2, "failed", "download_failed", at(0, -2), 1, "", "")
	r.grab(1, "imported", "", at(-8, 0), 1, "", "")
	for _, c := range []struct {
		rng        string
		columns    int
		firstStart string
		firstEnds  string
	}{{"7d", 7, "2026-10-25", "2026-10-25"}, {"30d", 5, "2026-10-02", "2026-10-03"}, {"90d", 13, "2026-08-03", "2026-08-08"}} {
		res := r.compute(c.rng)
		if len(res.Columns) != c.columns {
			t.Fatalf("%s: %d columns, want %d", c.rng, len(res.Columns), c.columns)
		}
		first, last := res.Columns[0], res.Columns[len(res.Columns)-1]
		if first.From.Format("2006-01-02") != c.firstStart || first.To.Format("2006-01-02") != c.firstEnds {
			t.Errorf("%s: first column %v to %v", c.rng, first.From, first.To)
		}
		if last.To != res.Window.To.AddDate(0, 0, -1) {
			t.Errorf("%s: last column ends %v, want the last day of the range", c.rng, last.To)
		}
		var imported, failed int
		for _, col := range res.Columns {
			imported += col.Imported
			failed += col.Failed
		}
		if imported != res.Imported || failed != res.Failed {
			t.Errorf("%s: columns add up to %d and %d, the range has %d and %d", c.rng, imported, failed, res.Imported, res.Failed)
		}
	}
	res := r.compute("30d")
	if n := len(res.Columns); res.Columns[n-1].Imported != 1 || res.Columns[n-1].Failed != 1 || res.Columns[n-2].Imported != 1 {
		t.Errorf("weeks = %+v", res.Columns[len(res.Columns)-2:])
	}
}
