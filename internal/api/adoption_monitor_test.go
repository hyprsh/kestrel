package api_test

import (
	"fmt"
	"testing"
)

// monitorRow patches one row's own monitoring choice.
func (a adopting) monitorRow(t *testing.T, id int64, monitor string) {
	t.Helper()
	if r := a.valid("PATCH", fmt.Sprintf("/adoption/rows/%d", id), fmt.Sprintf(`{"monitor":%q}`, monitor)); r.Status != 200 {
		t.Fatalf("PATCH row = %d %s", r.Status, r.Body)
	}
}

func (a adopting) title(t *testing.T, id int64) titleJSON {
	t.Helper()
	return decode[titleJSON](t, a.valid("GET", fmt.Sprintf("/titles/%d", id), ""))
}

func (a adopting) plan(t *testing.T) adoptionJSON {
	t.Helper()
	return decode[adoptionJSON](t, a.valid("GET", "/adoption", ""))
}

func TestAdoptedTitlesAreMonitoredUnlessTheCommitSaysOtherwise(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	a.put(t, "Paddington (2014) {tmdb-116149}/Paddington (2014) {tmdb-116149} - [Standard][Bluray-1080p][English][h264]-GRP.mkv", "x")
	plan := a.scan(t)
	if got := decode[adoptionJSON](t, a.valid("GET", "/adoption", "")); got.Monitor != "all" {
		t.Fatalf("plan monitor = %q, want all", got.Monitor)
	}

	a.commit(t, plan.Revision)

	if got := a.title(t, a.titleIDOf(t, 116149)); !got.Monitored {
		t.Errorf("an adopted Movie is unmonitored by default: %+v", got)
	}
}

func TestACommitThatNamesNoneAdoptsMoviesUnmonitoredAndNeverWantedOrUpgraded(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	a.put(t, "Paddington (2014) {tmdb-116149}/Paddington (2014) {tmdb-116149} - [Standard][Bluray-1080p][English][h264]-GRP.mkv", "x")
	plan := a.scan(t)

	if r := a.valid("POST", "/adoption/commit", fmt.Sprintf(`{"revision":%d,"monitor":"none"}`, plan.Revision)); r.Status != 202 {
		t.Fatalf("commit = %d %s", r.Status, r.Body)
	}
	a.settled(t, "committing")

	id := a.titleIDOf(t, 116149)
	if got := a.title(t, id); got.Monitored {
		t.Fatalf("the Movie is monitored after adopting unmonitored")
	}
	// The 4K Version has no file: an unmonitored Title is not Wanted for it.
	a.valid("POST", fmt.Sprintf("/titles/%d/versions", id), `{"slot":"4k","profile":"4k-primary"}`)
	if got := a.stateOf(t, id, "4k"); got != "unmonitored" {
		t.Errorf("empty Version state = %q, want unmonitored", got)
	}
}

func TestAPlanWideChoiceIsStoredMovesTheRevisionAndEndsWithTheNextScan(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	a.put(t, "Paddington (2014) {tmdb-116149}/Paddington (2014) {tmdb-116149} - [Standard][Bluray-1080p][English][h264]-GRP.mkv", "x")
	plan := a.scan(t)

	r := a.valid("PATCH", "/adoption", `{"monitor":"none"}`)
	if r.Status != 200 {
		t.Fatalf("PATCH /adoption = %d %s", r.Status, r.Body)
	}
	got := decode[adoptionJSON](t, r)
	if got.Monitor != "none" || got.Revision == plan.Revision {
		t.Fatalf("after PATCH: monitor %q revision %d (was %d)", got.Monitor, got.Revision, plan.Revision)
	}
	if again := decode[adoptionJSON](t, a.valid("GET", "/adoption", "")); again.Monitor != "none" {
		t.Errorf("stored monitor = %q", again.Monitor)
	}

	a.commit(t, got.Revision)

	if a.title(t, a.titleIDOf(t, 116149)).Monitored {
		t.Error("the plan-wide choice was not used by the commit")
	}
	if fresh := a.scan(t); fresh.Monitor != "all" {
		t.Errorf("a new plan starts with monitor %q, want all", fresh.Monitor)
	}
}

func TestARowOrASelectionCanOverrideThePlanWideChoice(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	a.put(t, "The Lost Film (2020) [tmdbid-77]/lost.film.mkv", "lost")
	a.put(t, "Paddington.2014.1080p.BluRay.x264-GRP/Paddington.2014.1080p.BluRay.x264-GRP.mkv", "pad")
	a.scan(t)
	lost, pad := a.rowOf(t, "The Lost Film (2020) [tmdbid-77]"), a.rowOf(t, "Paddington.2014.1080p.BluRay.x264-GRP")

	a.monitorRow(t, lost.ID, "none")
	if got := a.rowOf(t, "The Lost Film (2020) [tmdbid-77]"); got.Monitor == nil || *got.Monitor != "none" {
		t.Fatalf("row monitor = %v", got.Monitor)
	}
	got := a.bulk(t, fmt.Sprintf(`{"action":"set_monitor","monitor":"none","row_ids":%s}`, rowIDs(lost, pad)))
	if want := map[int64]string{lost.ID: "left:already", pad.ID: "changed"}; fmt.Sprint(got.outcomes()) != fmt.Sprint(want) {
		t.Errorf("outcomes = %v, want %v", got.outcomes(), want)
	}
	a.bulk(t, fmt.Sprintf(`{"action":"set_monitor","monitor":"all","row_ids":%s}`, rowIDs(pad)))

	a.commit(t, a.plan(t).Revision)

	if a.title(t, a.titleIDOf(t, 77)).Monitored {
		t.Error("the row set to none was adopted monitored")
	}
	if !a.title(t, a.titleIDOf(t, 116149)).Monitored {
		t.Error("the row set back to all was adopted unmonitored")
	}
}

func TestAChoiceSurvivesSettlingANeedsChoiceRowByHand(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	a.put(t, "Paddington/pad.mkv", "ambiguous")
	a.scan(t)
	row := a.rowOf(t, "Paddington")
	a.monitorRow(t, row.ID, "none")

	if r := a.valid("PATCH", fmt.Sprintf("/adoption/rows/%d", row.ID), `{"tmdb_id":116149}`); r.Status != 200 {
		t.Fatalf("settle = %d %s", r.Status, r.Body)
	}
	a.commit(t, a.plan(t).Revision)

	if a.title(t, a.titleIDOf(t, 116149)).Monitored {
		t.Error("settling the row dropped its monitoring choice")
	}
}

func TestASeriesIsAdoptedWithTheSeriesChoiceAndEveryEpisodeFollowsIt(t *testing.T) {
	t.Parallel()
	for mode, want := range map[string]bool{"all": true, "none": false} {
		t.Run(mode, func(t *testing.T) {
			t.Parallel()
			a := newAdopting(t)
			a.putTV(t, bbFolder+"/Season 01/Breaking Bad - S01E01 - [Standard][WEBDL-1080p][English][h264]-GRP.mkv", "standard")
			plan := a.scan(t)
			if r := a.valid("POST", "/adoption/commit", fmt.Sprintf(`{"revision":%d,"monitor":%q}`, plan.Revision, mode)); r.Status != 202 {
				t.Fatalf("commit = %d %s", r.Status, r.Body)
			}
			a.settled(t, "committing")

			id := a.titleIDOf(t, 1396)
			d := decode[seriesTitleJSON](t, a.valid("GET", fmt.Sprintf("/titles/%d", id), ""))
			if d.SeriesMonitor == nil || *d.SeriesMonitor != mode {
				t.Errorf("series_monitor = %v, want %s", d.SeriesMonitor, mode)
			}
			for _, e := range episodesOf(t, a.library, id) {
				if e.Season > 0 && e.Monitored != want {
					t.Fatalf("S%02dE%02d monitored = %v, want %v", e.Season, e.Number, e.Monitored, want)
				}
			}
		})
	}
}

func TestANewSeriesFollowsOnlyWhatAirsNextWhenThePlanSaysFuture(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	a.putTV(t, bbFolder+"/Season 01/Breaking Bad - S01E01 - [Standard][WEBDL-1080p][English][h264]-GRP.mkv", "standard")
	plan := a.scan(t)
	if r := a.valid("POST", "/adoption/commit", fmt.Sprintf(`{"revision":%d,"monitor":"future"}`, plan.Revision)); r.Status != 202 {
		t.Fatalf("commit = %d %s", r.Status, r.Body)
	}
	a.settled(t, "committing")

	d := decode[seriesTitleJSON](t, a.valid("GET", fmt.Sprintf("/titles/%d", a.titleIDOf(t, 1396)), ""))
	if d.SeriesMonitor == nil || *d.SeriesMonitor != "future" {
		t.Errorf("series_monitor = %v, want future", d.SeriesMonitor)
	}
}

func TestATitleKestrelAlreadyTracksKeepsItsOwnMonitoring(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	added := decode[titleJSON](t, a.valid("POST", "/titles", `{"kind":"movie","tmdb_id":116149,"versions":[{"slot":"standard","profile":"hd-primary"}]}`))
	a.put(t, "Paddington (2014)/Paddington.2014.1080p.BluRay.x264-GRP.mkv", "standard")
	a.scan(t)
	row := a.rowOf(t, "Paddington (2014)")

	got := a.bulk(t, fmt.Sprintf(`{"action":"set_monitor","monitor":"none","row_ids":%s}`, rowIDs(row)))
	if o := got.outcomes()[row.ID]; o != "left:tracked" {
		t.Errorf("set_monitor on a tracked Title = %q, want left:tracked", o)
	}
	if r := a.valid("POST", "/adoption/commit", fmt.Sprintf(`{"revision":%d,"monitor":"none"}`, got.Revision)); r.Status != 202 {
		t.Fatalf("commit = %d %s", r.Status, r.Body)
	}
	a.settled(t, "committing")

	if !a.title(t, added.ID).Monitored {
		t.Error("adopting into a tracked Title changed its monitoring")
	}
}

func TestAMonitoringChoiceThatIsNotAModeIsRefused(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	a.put(t, "Paddington (2014) {tmdb-116149}/Paddington (2014) {tmdb-116149} - [Standard][Bluray-1080p][English][h264]-GRP.mkv", "x")
	plan := a.scan(t)
	row := a.rowOf(t, "Paddington (2014) {tmdb-116149}")
	for name, c := range map[string][3]string{
		"plan":   {"PATCH", "/adoption", `{"monitor":"some"}`},
		"row":    {"PATCH", fmt.Sprintf("/adoption/rows/%d", row.ID), `{"monitor":"some"}`},
		"commit": {"POST", "/adoption/commit", fmt.Sprintf(`{"revision":%d,"monitor":"some"}`, plan.Revision)},
		"bulk":   {"POST", "/adoption/rows/bulk", `{"action":"set_monitor","row_ids":[1]}`},
	} {
		if r := a.do(c[0], c[1], c[2]); r.Status != 422 {
			t.Errorf("%s: %d %s, want 422", name, r.Status, r.Body)
		}
	}
}
