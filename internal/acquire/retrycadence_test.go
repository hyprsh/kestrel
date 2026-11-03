package acquire_test

import (
	"context"
	"slices"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/metadata"
	indexer "github.com/hyprsh/kestrel/internal/plugin/indexer/v1"
	"github.com/hyprsh/kestrel/internal/slot"
)

// indexerRelease is a season pack of the two-season show as an indexer tags it.
func indexerRelease(name, season string, now time.Time) indexer.Release {
	return indexer.Release{Title: name, TVDBID: 5003, Season: season, Size: 2 << 30, PublishDate: now.Add(-time.Hour), Categories: []int{5040}}
}

// rejectImport completes the Grab's job and has its Import rejected, as the import loop would.
func (r *rig) rejectImport(t *testing.T, g acquire.Grab) {
	t.Helper()
	ctx := context.Background()
	_ = r.sab.Complete(g.ClientID, "/data/usenet/movies/Paddington")
	_, _ = r.svc.Poll(ctx)
	if _, err := r.svc.DueImports(ctx); err != nil {
		t.Fatal(err)
	}
	if err := r.svc.RecordImport(ctx, g.ID, true, acquire.ImportOutcome{Status: acquire.ImportRejected, Reason: "language"}); err != nil {
		t.Fatal(err)
	}
}

func (r *rig) dueIn(t *testing.T, d time.Duration) bool {
	t.Helper()
	due, err := r.lib.DueMissing(context.Background(), r.clock.now.Add(d))
	if err != nil {
		t.Fatal(err)
	}
	return len(due) == 1
}

func TestASecondRejectionInsideTheCooldownLeavesItsRetryToTheSweepAndAnImportResetsTheCooldown(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	first := r.twoCandidates(t)

	r.rejectImport(t, first) // the first rejection retries at once
	a := r.active(t)
	if len(a) != 1 || a[0].ReleaseName == first.ReleaseName {
		t.Fatalf("active after the first rejection = %+v, want the next best Release", a)
	}
	second := acquire.Grab{ID: a[0].ID, ClientID: a[0].ClientID}

	// The next one comes ten minutes later, inside the 15-minute cooldown: no retry runs now.
	r.clock.now = r.clock.now.Add(10 * time.Minute)
	r.rejectImport(t, second)
	if a := r.active(t); len(a) != 0 {
		t.Fatalf("active inside the cooldown = %+v, want none: the retry waits", a)
	}
	// It is the sweep's to make, when the cooldown ends.
	if r.dueIn(t, 4*time.Minute) || !r.dueIn(t, 5*time.Minute) {
		t.Errorf("the Version is not due exactly when the 15-minute cooldown ends")
	}

	// An Import resets the cooldown, so the next rejection retries at once again.
	if err := r.lib.ClearRejections(ctx, r.versions[slot.Standard]); err != nil {
		t.Fatal(err)
	}
	rt, err := r.lib.NoteRejection(ctx, r.versions[slot.Standard], r.clock.now)
	if err != nil || !rt.Now {
		t.Fatalf("a rejection after an Import = %+v, %v, want an immediate retry", rt, err)
	}
}

func TestAnImportClearsTheRetryCooldownOfItsVersion(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	g := r.grabOne(t)
	ver := r.versions[slot.Standard]
	if rt, _ := r.lib.NoteRejection(ctx, ver, r.clock.now); !rt.Now {
		t.Fatal("the first rejection did not retry")
	}
	if rt, _ := r.lib.NoteRejection(ctx, ver, r.clock.now.Add(time.Minute)); rt.Now {
		t.Fatal("a second rejection a minute on retried inside the cooldown")
	}
	_ = r.sab.Complete(g.ClientID, "/data/usenet/movies/Paddington")
	_, _ = r.svc.Poll(ctx)
	if _, err := r.svc.DueImports(ctx); err != nil {
		t.Fatal(err)
	}
	if err := r.svc.RecordImport(ctx, g.ID, true, acquire.ImportOutcome{Status: acquire.ImportDone, Path: "/m/a.mkv"}); err != nil {
		t.Fatal(err)
	}
	if rt, _ := r.lib.NoteRejection(ctx, ver, r.clock.now.Add(2*time.Minute)); !rt.Now {
		t.Fatal("a rejection after an Import still waits for the old cooldown")
	}
}

// twoSeasons is a Series with two aired seasons of two episodes each.
func twoSeasons() (metadata.SeriesDetails, metadata.TVDBSeries) {
	d := metadata.SeriesDetails{TMDBID: 7003, TVDBID: 5003, Title: "Night Show", OriginalTitle: "Night Show", OriginalLanguage: "en", Year: 2024}
	v := metadata.TVDBSeries{ID: 5003, Name: "Night Show", Episodes: []metadata.Episode{
		{ID: 21, Season: 1, Number: 1, Name: "Dusk", Aired: day(2026, 1, 5)},
		{ID: 22, Season: 1, Number: 2, Name: "Midnight", Aired: day(2026, 1, 12)},
		{ID: 23, Season: 2, Number: 1, Name: "Dawn", Aired: day(2026, 2, 5)},
		{ID: 24, Season: 2, Number: 2, Name: "Noon", Aired: day(2026, 2, 12)},
	}}
	return d, v
}

func TestARejectedSeasonPackIsRetriedForThatSeasonOnly(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	d, v := twoSeasons()
	id := r.addSeries(t, d, v, library.MonitorAll)
	det, err := r.lib.Get(ctx, id, library.View{Country: "US", Now: r.clock.now})
	if err != nil {
		t.Fatal(err)
	}
	ver := det.Versions[0].ID
	pub := func(name, season string) {
		err := r.idx.Publish(indexerRelease(name, season, r.clock.now), []byte("<nzb>"+name+"</nzb>"))
		if err != nil {
			t.Fatal(err)
		}
	}
	pub("Night.Show.S01.1080p.WEB-DL.H264-GRP", "1")
	pub("Night.Show.S01.1080p.WEB-DL.H264-OTHER", "1")
	// Season 2 has no Release: its episodes stay Wanted, searched but not covered by any Grab.

	// Not a sweep's search, so that the indexers do not pace its two seasons in real time.
	out, _, err := acquire.SearchGuarded(r.svc, ctx, id, []int64{ver}, library.Scope{}, false, false, false)
	if err != nil || len(out.Grabbed) != 1 {
		t.Fatalf("SearchWanted = %+v, %v, want the season 1 pack", out.Grabbed, err)
	}
	eps, _ := r.lib.Episodes(ctx, id, library.View{Country: "US", Now: r.clock.now})
	seasonOf := map[int64]int{}
	for _, e := range eps {
		seasonOf[e.ID] = e.Season
	}
	one := out.Grabbed[0]
	searchedAt := r.clock.now
	r.clock.now = searchedAt.Add(time.Hour)

	r.rejectImport(t, one)

	last, err := r.svc.LastEpisodeSearches(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range eps {
		ls, ok := last[[2]int64{ver, e.ID}]
		if !ok {
			t.Fatalf("episode %d has no search record", e.ID)
		}
		retried := ls.At.Equal(r.clock.now)
		if want := e.Season == 1; retried != want {
			t.Errorf("S%dE%d last searched at %v (the retry ran at %v): retried = %v, want %v", e.Season, e.Number, ls.At, r.clock.now, retried, want)
		}
	}
	// And the retry grabbed season 1's next best pack.
	var seasons []int
	for _, a := range r.active(t) {
		ids, _ := r.svc.GrabEpisodes(ctx, a.ID)
		seasons = append(seasons, seasonOf[ids[0]])
	}
	slices.Sort(seasons)
	if !slices.Equal(seasons, []int{1}) {
		t.Errorf("active Grabs cover seasons %v, want season 1's next pack", seasons)
	}
}

func TestASearchByHandCountsAsTheVersionsSearchForTheCadence(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	ver := r.versions[slot.Standard]
	// A new Version is due at once.
	if !r.dueIn(t, 0) {
		t.Fatal("a new Version is not due")
	}

	if _, _, err := acquire.SearchGuarded(r.svc, ctx, r.titleID, []int64{ver}, library.Scope{}, false, false, false); err != nil {
		t.Fatal(err)
	}

	if r.dueIn(t, 0) {
		t.Error("a Version searched by hand is still due")
	}
	next, err := r.lib.NextSearches(ctx, r.titleID)
	if err != nil || next[ver].Missing == nil || !next[ver].Missing.After(r.clock.now) {
		t.Errorf("next search = %+v, %v, want one after the search", next[ver], err)
	}
}
