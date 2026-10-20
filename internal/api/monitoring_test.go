package api_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/jobs"
	"github.com/hyprsh/kestrel/internal/metadata/metadatatest"
)

// searchesUsed is how many searches the one indexer has answered today, as the health strip counts them.
func (s search) searchesUsed(t *testing.T) int {
	t.Helper()
	st := decode[struct {
		Indexers []struct {
			SearchUsed int `json:"search_used"`
		} `json:"indexers"`
	}](t, s.valid("GET", "/system/status", ""))
	if len(st.Indexers) != 1 {
		t.Fatalf("indexers = %+v", st.Indexers)
	}
	return st.Indexers[0].SearchUsed
}

// misfitStandard gives the Standard Version an adopted file that fails its Profile, so it is Wanted.
func (s search) misfitStandard(t *testing.T) {
	t.Helper()
	res, err := s.in.st.Write().Exec(
		`INSERT INTO files (version_id, path, size, release_name, score, imported_at)
		 VALUES (?, '/data/media/movies/Paddington/p.mkv', 1, 'Paddington.2014.1080p.BluRay.x264-OLD', 0, '2026-10-01T00:00:00Z')`, s.hd)
	if err != nil {
		t.Fatal(err)
	}
	id, _ := res.LastInsertId()
	if _, err := s.in.st.Write().Exec(`INSERT INTO file_misfits (file_id) VALUES (?)`, id); err != nil {
		t.Fatal(err)
	}
}

func TestAnUnmonitoredMovieWithAMisfitFileIsNotWantedSearchedOrGrabbedFromRSS(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	s.misfitStandard(t)
	s.publish(t, goodRelease)
	s.publish(t, uhdRelease)

	r := s.valid("PATCH", fmt.Sprintf("/titles/%d", s.title), `{"monitored":false}`)

	if r.Status != 200 {
		t.Fatalf("PATCH = %d %s", r.Status, r.Body)
	}
	got := decode[titleJSON](t, r)
	if got.Monitored {
		t.Errorf("monitored = true after unmonitoring")
	}
	for _, v := range got.Versions {
		if v.State != "unmonitored" {
			t.Errorf("%s Version is %s, want unmonitored", v.Slot, v.State)
		}
		if v.Slot == "standard" && v.File == nil {
			t.Errorf("the misfit file is gone")
		}
	}
	if rows := decode[struct {
		Items []rowJSON `json:"items"`
	}](t, s.valid("GET", "/titles?wanted=true", "")).Items; len(rows) != 0 {
		t.Errorf("Wanted = %+v", rows)
	}
	before := s.searchesUsed(t)
	s.pass(t, jobs.Search)
	if used := s.searchesUsed(t); used != before {
		t.Errorf("the sweep searched an unmonitored Movie (%d -> %d searches)", before, used)
	}
	s.pass(t, jobs.RSS)
	if q := s.queue(t); len(q) != 0 {
		t.Errorf("queue = %+v, want no Grab", q)
	}
}

func TestMonitoringAMovieAgainLetsTheNextSweepGrab(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	s.publish(t, goodRelease)
	s.valid("PATCH", fmt.Sprintf("/titles/%d", s.title), `{"monitored":false}`)
	s.pass(t, jobs.Search)

	r := s.valid("PATCH", fmt.Sprintf("/titles/%d", s.title), `{"monitored":true}`)

	if r.Status != 200 || !decode[titleJSON](t, r).Monitored {
		t.Fatalf("PATCH = %d %s", r.Status, r.Body)
	}
	s.pass(t, jobs.Search)
	if q := s.queue(t); len(q) != 1 || q[0].ReleaseName != goodRelease {
		t.Errorf("queue = %+v, want the Standard Version grabbed", q)
	}
}

func TestAHandStartedGrabStillWorksForAnUnmonitoredMovie(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	s.publish(t, goodRelease)
	s.valid("PATCH", fmt.Sprintf("/titles/%d", s.title), `{"monitored":false}`)

	r := s.grab(s.hd, s.releases(t, s.hd).find(t, goodRelease).ReleaseID, false)

	if r.Status != 201 {
		t.Fatalf("grab = %d %s", r.Status, r.Body)
	}
}

func TestASeriesIsNotMonitoredThroughMonitored(t *testing.T) {
	t.Parallel()
	l := newLibraryInstance(t, metadatatest.Key)
	r := l.valid("POST", "/titles", addBreakingBad+`}`)
	if r.Status != 201 {
		t.Fatalf("add = %d %s", r.Status, r.Body)
	}
	id := decode[titleJSON](t, r).ID

	r = l.valid("PATCH", fmt.Sprintf("/titles/%d", id), `{"monitored":false}`)

	if r.Status != 422 {
		t.Errorf("PATCH monitored on a Series = %d %s, want 422", r.Status, r.Body)
	}
}

func (s search) pauseGrabs(t *testing.T, on bool) {
	t.Helper()
	r := s.valid("PATCH", "/settings", fmt.Sprintf(`{"pause_grabs":%v}`, on))
	if r.Status != 200 {
		t.Fatalf("PATCH /settings = %d %s", r.Status, r.Body)
	}
	if got := decode[struct {
		PauseGrabs bool `json:"pause_grabs"`
	}](t, r).PauseGrabs; got != on {
		t.Fatalf("pause_grabs = %v after saving %v", got, on)
	}
}

func TestPauseGrabsIsSavedWithTheSettingsAndShownInTheHealthStrip(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	type status struct {
		GrabsPaused bool `json:"grabs_paused"`
	}
	if decode[status](t, s.valid("GET", "/system/status", "")).GrabsPaused {
		t.Fatal("Grabs are paused on a new instance")
	}

	s.pauseGrabs(t, true)

	if !decode[struct {
		PauseGrabs bool `json:"pause_grabs"`
	}](t, s.valid("GET", "/settings", "")).PauseGrabs {
		t.Error("GET /settings does not report Pause Grabs")
	}
	if !decode[status](t, s.valid("GET", "/system/status", "")).GrabsPaused {
		t.Error("the health strip does not say Grabs are paused")
	}
}

func TestWithGrabsPausedTheSweepAndRSSSearchButGrabNothingWhileAHandStartedGrabGoesThrough(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	s.publish(t, goodRelease)
	s.publish(t, uhdRelease)
	s.pauseGrabs(t, true)

	before := s.searchesUsed(t)
	s.pass(t, jobs.Search)
	afterSweep := s.searchesUsed(t)
	s.pass(t, jobs.RSS)

	if afterSweep <= before {
		t.Errorf("the sweep stopped searching (%d -> %d searches)", before, afterSweep)
	}
	if used := s.searchesUsed(t); used <= afterSweep {
		t.Errorf("RSS stopped reading the feed (%d -> %d searches)", afterSweep, used)
	}
	if q := s.queue(t); len(q) != 0 {
		t.Fatalf("queue = %+v, want no automatic Grab", q)
	}
	if rows := decode[struct {
		Items []rowJSON `json:"items"`
	}](t, s.valid("GET", "/titles?wanted=true", "")).Items; len(rows) != 1 {
		t.Errorf("Wanted = %+v, want Paddington still Wanted", rows)
	}
	r := s.grab(s.hd, s.releases(t, s.hd).find(t, goodRelease).ReleaseID, false)
	if r.Status != 201 {
		t.Errorf("hand-started grab = %d %s", r.Status, r.Body)
	}

	// The feed RSS read while paused matched and scored the 4K Release: the
	// same feed grabs it once Grabs are back on.
	s.pauseGrabs(t, false)
	s.pass(t, jobs.RSS)
	var uhd bool
	for _, it := range s.queue(t) {
		uhd = uhd || (it.VersionID != nil && *it.VersionID == s.uhd && it.ReleaseName == uhdRelease)
	}
	if !uhd {
		t.Errorf("queue = %+v, want RSS to grab the 4K Release once unpaused", s.queue(t))
	}
}

func TestTurningPauseGrabsOffLetsTheNextSweepGrab(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	s.publish(t, goodRelease)
	s.pauseGrabs(t, true)
	s.pass(t, jobs.Search)

	s.pauseGrabs(t, false)
	s.pass(t, jobs.Search)

	if q := s.queue(t); len(q) != 1 || q[0].ReleaseName != goodRelease {
		t.Errorf("queue = %+v, want the Standard Version grabbed", q)
	}
}

func TestTurningPauseGrabsOffLetsTheNextSweepGrabAnUpgradeFoundWhilePaused(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	if _, err := s.in.st.Write().Exec(
		`INSERT INTO files (version_id, path, size, release_name, score, imported_at)
		 VALUES (?, '/data/media/movies/Paddington/p.mkv', 1, 'Paddington.2014.720p.HDTV.x264-OLD', -50, '2026-10-01T00:00:00Z')`, s.hd); err != nil {
		t.Fatal(err)
	}
	s.publish(t, goodRelease)
	s.pauseGrabs(t, true)
	s.pass(t, jobs.Search)

	s.pauseGrabs(t, false)
	s.pass(t, jobs.Search)

	if q := s.queue(t); len(q) != 1 || q[0].ReleaseName != goodRelease || !q[0].IsUpgrade {
		t.Errorf("queue = %+v, want the Upgrade of the Standard Version grabbed", q)
	}
}

type bulkJSON struct {
	Items []struct {
		TitleID int64   `json:"title_id"`
		Outcome string  `json:"outcome"`
		Reason  *string `json:"reason"`
		Message *string `json:"message"`
	} `json:"items"`
}

// outcomes counts a bulk reply's Titles by outcome and reason.
func (b bulkJSON) outcomes() map[string]int {
	out := map[string]int{}
	for _, it := range b.Items {
		k := it.Outcome
		if it.Reason != nil {
			k += "/" + *it.Reason
		}
		out[k]++
	}
	return out
}

func TestOneBulkCallUnmonitorsAThousandMoviesAndASecondChangesNothing(t *testing.T) {
	t.Parallel()
	l := newLibraryInstance(t, metadatatest.Key)
	if _, err := l.in.st.Write().Exec(`
		WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1000)
		INSERT INTO titles (kind, tmdb_id, title, original_title, primary_title, root_folder, added_at, refreshed_at)
		SELECT 'movie', i, 'Movie ' || i, 'Movie ' || i, 'Movie ' || i, '/m', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z' FROM n`); err != nil {
		t.Fatal(err)
	}
	ids := make([]string, 1000)
	for i := range ids {
		ids[i] = fmt.Sprint(i + 1)
	}
	body := `{"action":"monitor","monitored":false,"title_ids":[` + strings.Join(ids, ",") + `]}`

	first := l.valid("POST", "/titles/bulk", body)

	if first.Status != 200 {
		t.Fatalf("bulk = %d %s", first.Status, first.Body)
	}
	if got := decode[bulkJSON](t, first).outcomes(); got["changed"] != 1000 || len(got) != 1 {
		t.Errorf("first call = %v, want 1000 changed", got)
	}
	if d := decode[titleJSON](t, l.valid("GET", "/titles/500", "")); d.Monitored {
		t.Errorf("title 500 is still monitored")
	}
	second := l.valid("POST", "/titles/bulk", body)
	if got := decode[bulkJSON](t, second).outcomes(); got["skipped/unchanged"] != 1000 || len(got) != 1 {
		t.Errorf("second call = %v, want 1000 skipped as unchanged", got)
	}
}

func TestBulkUnmonitoringASeriesSetsNoneAndUnmonitorsEveryEpisode(t *testing.T) {
	t.Parallel()
	l := newLibraryInstance(t, metadatatest.Key)
	series := decode[seriesTitleJSON](t, l.valid("POST", "/titles", addBreakingBad+`}`)).ID
	movie := decode[titleJSON](t, l.valid("POST", "/titles", `{"kind":"movie","tmdb_id":116149,"versions":[{"slot":"standard","profile":"hd-primary"}]}`)).ID

	r := l.valid("POST", "/titles/bulk", fmt.Sprintf(`{"action":"monitor","monitored":false,"title_ids":[%d,%d,%d,999]}`, series, movie, series))

	if r.Status != 200 {
		t.Fatalf("bulk = %d %s", r.Status, r.Body)
	}
	got := decode[bulkJSON](t, r)
	if len(got.Items) != 3 || got.Items[0].TitleID != series || got.Items[0].Outcome != "changed" || got.Items[1].Outcome != "changed" ||
		got.Items[2].TitleID != 999 || got.Items[2].Outcome != "skipped" || got.Items[2].Reason == nil || *got.Items[2].Reason != "not_found" {
		t.Fatalf("items = %+v", got.Items)
	}
	d := decode[seriesTitleJSON](t, l.valid("GET", fmt.Sprintf("/titles/%d", series), ""))
	if d.SeriesMonitor == nil || *d.SeriesMonitor != "none" {
		t.Errorf("series_monitor = %v, want none", d.SeriesMonitor)
	}
	for _, e := range episodesOf(t, l, series) {
		if e.Monitored {
			t.Errorf("S%02dE%02d is still monitored", e.Season, e.Number)
		}
	}
	for _, v := range d.Versions {
		if v.State != "unmonitored" {
			t.Errorf("the %s Version is %s, want unmonitored like an unmonitored Movie", v.Slot, v.State)
		}
	}

	r = l.valid("POST", "/titles/bulk", fmt.Sprintf(`{"action":"monitor","monitored":true,"series_monitor":"future","title_ids":[%d,%d]}`, series, movie))

	if got := decode[bulkJSON](t, r).outcomes(); got["changed"] != 2 {
		t.Errorf("monitoring again = %v", got)
	}
	d = decode[seriesTitleJSON](t, l.valid("GET", fmt.Sprintf("/titles/%d", series), ""))
	if d.SeriesMonitor == nil || *d.SeriesMonitor != "future" {
		t.Errorf("series_monitor = %v, want future", d.SeriesMonitor)
	}
	if !decode[titleJSON](t, l.valid("GET", fmt.Sprintf("/titles/%d", movie), "")).Monitored {
		t.Errorf("the Movie is still unmonitored")
	}
}

func TestABulkCallIsRefusedForAnUnknownActionOrAModeThatContradictsIt(t *testing.T) {
	t.Parallel()
	l := newLibraryInstance(t, metadatatest.Key)
	for _, body := range []string{
		`{"action":"monitor","monitored":false,"series_monitor":"all","title_ids":[1]}`,
		`{"action":"monitor","monitored":true,"series_monitor":"none","title_ids":[1]}`,
		`{"action":"monitor","monitored":true,"series_monitor":"sometimes","title_ids":[1]}`,
		`{"action":"explode","title_ids":[1]}`,
		`{"action":"monitor","monitored":true,"title_ids":[]}`,
	} {
		if r := l.do("POST", "/titles/bulk", body); r.Status != 422 {
			t.Errorf("%s = %d %s, want 422", body, r.Status, r.Body)
		}
	}
}

func TestBulkMonitoringWithoutAModeKeepsAMonitoredSeriesModeAndMonitorsAnUnmonitoredOneAll(t *testing.T) {
	t.Parallel()
	l := newLibraryInstance(t, metadatatest.Key)
	future := decode[seriesTitleJSON](t, l.valid("POST", "/titles", addBreakingBad+`}`)).ID
	if r := l.valid("PATCH", fmt.Sprintf("/titles/%d", future), `{"series_monitor":"future"}`); r.Status != 200 {
		t.Fatalf("PATCH = %d %s", r.Status, r.Body)
	}
	before := episodesOf(t, l, future)
	none := decode[seriesTitleJSON](t, l.valid("POST", "/titles", `{"kind":"series","tmdb_id":7001,"versions":[{"slot":"standard","profile":"hd-primary"}]}`)).ID
	if r := l.valid("PATCH", fmt.Sprintf("/titles/%d", none), `{"series_monitor":"none"}`); r.Status != 200 {
		t.Fatalf("PATCH = %d %s", r.Status, r.Body)
	}

	got := decode[bulkJSON](t, l.valid("POST", "/titles/bulk", fmt.Sprintf(`{"action":"monitor","monitored":true,"title_ids":[%d,%d]}`, future, none)))

	if len(got.Items) != 2 || got.Items[0].Outcome != "skipped" || got.Items[0].Reason == nil || *got.Items[0].Reason != "unchanged" || got.Items[1].Outcome != "changed" {
		t.Fatalf("items = %+v", got.Items)
	}
	if d := decode[seriesTitleJSON](t, l.valid("GET", fmt.Sprintf("/titles/%d", future), "")); d.SeriesMonitor == nil || *d.SeriesMonitor != "future" {
		t.Errorf("series_monitor = %v, want future kept", d.SeriesMonitor)
	}
	for i, e := range episodesOf(t, l, future) {
		if e.Monitored != before[i].Monitored {
			t.Errorf("S%02dE%02d monitored = %v, was %v", e.Season, e.Number, e.Monitored, before[i].Monitored)
		}
	}
	if d := decode[seriesTitleJSON](t, l.valid("GET", fmt.Sprintf("/titles/%d", none), "")); d.SeriesMonitor == nil || *d.SeriesMonitor != "all" {
		t.Errorf("series_monitor = %v, want all", d.SeriesMonitor)
	}
}
