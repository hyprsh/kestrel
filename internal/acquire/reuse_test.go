package acquire_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/plugin"
	"github.com/hyprsh/kestrel/internal/slot"
)

func lastReason(t *testing.T, h *history.Service) string {
	t.Helper()
	ev := eventsOf(t, h, history.Searched)
	if len(ev) == 0 {
		t.Fatal("no Searched entry")
	}
	return ev[len(ev)-1].Reason
}

func (r *rig) searchNow(ctx context.Context) (acquire.Outcome, error) {
	return acquire.SearchNow(r.svc, ctx, r.versions[slot.Standard], library.Scope{})
}

func TestASweepReusesTheAnswerOfASearchForThirtyMinutesAndSearchesAgainAfterwards(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	hist := r.logged(t)
	ids := r.wanted(t, slot.Standard)

	if out, err := r.svc.SearchWanted(ctx, r.titleID, ids); err != nil || len(out.Grabbed) != 0 {
		t.Fatalf("first search = %+v, %v, want nothing to grab", out, err)
	}
	r.publish(t, hd1080, time.Hour) // an indexer request would find it

	r.clock.now = r.clock.now.Add(10 * time.Minute)
	out, err := r.svc.SearchWanted(ctx, r.titleID, ids)
	if err != nil || len(out.Grabbed) != 0 || len(out.Failures) != 0 || len(out.Searched) != 1 {
		t.Fatalf("sweep at 10 min = %+v, %v, want a search answered without the indexers", out, err)
	}
	if got := lastReason(t, hist); !strings.Contains(got, "answered from a search 10 min ago") {
		t.Errorf("reason = %q, want it to say it reused the answer", got)
	}

	r.clock.now = r.clock.now.Add(21 * time.Minute) // 31 min after the search
	if out, err = r.svc.SearchWanted(ctx, r.titleID, ids); err != nil || len(out.Grabbed) != 1 {
		t.Fatalf("sweep at 31 min = %+v, %v, want the indexers asked and the Release grabbed", out, err)
	}
	if got := lastReason(t, hist); strings.Contains(got, "answered from") {
		t.Errorf("reason = %q, want no mention of reuse", got)
	}
}

func TestSearchNowAlwaysAsksTheIndexers(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	if _, err := r.svc.SearchWanted(ctx, r.titleID, r.wanted(t, slot.Standard)); err != nil {
		t.Fatal(err)
	}
	r.publish(t, hd1080, time.Hour)
	r.clock.now = r.clock.now.Add(time.Minute)

	out, err := r.searchNow(ctx)
	if err != nil || len(out.Grabbed) != 1 {
		t.Fatalf("Search now = %+v, %v, want it to find the new Release", out, err)
	}
}

func TestASeasonAnswerNeverAnswersAWholeSeriesSearchButAWholeAnswerAnswersASeason(t *testing.T) {
	ctx := byPerson()
	r := newRig(t)
	_, ver := r.nightShow(t, library.MonitorAll)
	r.publishShow(t, nightEp1, "1", "1")
	season := 1

	if res, err := r.svc.Releases(ctx, ver, library.Scope{Season: &season}, false); err != nil || res.Cached || len(res.Items) != 1 {
		t.Fatalf("season search = %+v, %v", res, err)
	}
	r.publishShow(t, nightEp2, "1", "2")
	r.clock.now = r.clock.now.Add(5 * time.Minute)

	res, err := r.svc.Releases(ctx, ver, library.Scope{}, false)
	if err != nil || res.Cached || len(res.Items) != 2 {
		t.Fatalf("whole-Series search after a season answer = cached %v, %d items, %v; want the indexers asked", res.Cached, len(res.Items), err)
	}
	r.publishShow(t, nightS2, "2", "1")
	r.clock.now = r.clock.now.Add(5 * time.Minute)

	res, err = r.svc.Releases(ctx, ver, library.Scope{Season: &season}, false)
	if err != nil || !res.Cached || len(res.Items) != 2 {
		t.Fatalf("season search after a whole answer = cached %v, %d items, %v; want the two season 1 Releases from the answer", res.Cached, len(res.Items), err)
	}
	if want := r.clock.now.Add(-5 * time.Minute); !res.SearchedAt.Equal(want) {
		t.Errorf("searched_at = %v, want when the indexers answered, %v", res.SearchedAt, want)
	}
}

func TestAnEpisodeAnswerServesOnlyTheSameOrFewerEpisodes(t *testing.T) {
	ctx := byPerson()
	r := newRig(t)
	id, ver := r.nightShow(t, library.MonitorAll)
	r.publishShow(t, nightEp1, "1", "1")
	r.publishShow(t, nightEp2, "1", "2")
	eps, _ := r.lib.Episodes(ctx, id, library.View{Country: "US", Now: r.clock.now})
	season := 1

	if _, err := r.svc.Releases(ctx, ver, library.Scope{Season: &season, EpisodeIDs: []int64{eps[0].ID}}, false); err != nil {
		t.Fatal(err)
	}
	res, err := r.svc.Releases(ctx, ver, library.Scope{Season: &season, EpisodeIDs: []int64{eps[0].ID}}, false)
	if err != nil || !res.Cached || len(res.Items) != 1 {
		t.Fatalf("same episode again = %+v, %v", res, err)
	}
	res, err = r.svc.Releases(ctx, ver, library.Scope{Season: &season, EpisodeIDs: []int64{eps[0].ID, eps[1].ID}}, false)
	if err != nil || res.Cached || len(res.Items) != 2 {
		t.Fatalf("two episodes after an answer for one = cached %v, %d items, %v", res.Cached, len(res.Items), err)
	}
}

func TestInteractiveSearchListsTheCachedAnswerWithItsAgeAndSearchAgainAsksTheIndexers(t *testing.T) {
	ctx := byPerson()
	r := newRig(t)
	ver := r.versions[slot.Standard]
	first := r.clock.now
	r.publish(t, hd1080, time.Hour)

	res, err := r.svc.Releases(ctx, ver, library.Scope{}, false)
	if err != nil || res.Cached || len(res.Items) != 1 {
		t.Fatalf("first = %+v, %v, want a search", res, err)
	}
	r.publish(t, uhd, time.Hour)
	r.clock.now = first.Add(4 * time.Minute)

	res, err = r.svc.Releases(ctx, ver, library.Scope{}, false)
	if err != nil || !res.Cached || len(res.Items) != 1 || !res.SearchedAt.Equal(first) {
		t.Fatalf("second = %+v, %v, want the cached list from %v", res, err, first)
	}
	res, err = r.svc.Releases(ctx, ver, library.Scope{}, true)
	if err != nil || res.Cached || len(res.Items) != 2 || !res.SearchedAt.Equal(r.clock.now) {
		t.Fatalf("Search again = %+v, %v, want the indexers asked", res, err)
	}
	r.clock.now = r.clock.now.Add(31 * time.Minute)
	if res, err = r.svc.Releases(ctx, ver, library.Scope{}, false); err != nil || res.Cached {
		t.Fatalf("after the window = %+v, %v, want a search", res, err)
	}
}

func TestAGroupThatFailedIsAskedAgainWhileTheAnsweringGroupIsReused(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	hist := r.logged(t)
	r.withBetaAt(t, 2)
	ids := r.wanted(t, slot.Standard)
	r.publishMovie(t, r.idx, uhd, time.Hour) // another Slot's: Alpha leaves the Version Wanted
	r.idx2.Exhaust(plugin.LimitSearch, 5*time.Minute)

	out, err := r.svc.SearchWanted(ctx, r.titleID, ids)
	if err != nil || len(out.Failures) != 1 || len(out.Grabbed) != 0 || out.Releases != 1 {
		t.Fatalf("first = %+v, %v, want Alpha's answer and Beta failing", out, err)
	}
	r.idx2.Replenish()
	r.publishMovie(t, r.idx2, hd1080, time.Hour)
	r.publishMovie(t, r.idx, "Paddington.2014.2160p.BluRay.x265-ABC", time.Hour) // a request to Alpha would return it
	asked := r.asked2.Load()
	r.clock.now = r.clock.now.Add(10 * time.Minute)

	out, err = r.svc.SearchWanted(ctx, r.titleID, ids)
	if err != nil || len(out.Grabbed) != 1 || out.Grabbed[0].IndexerName != "Beta" || len(out.Failures) != 0 {
		t.Fatalf("second = %+v, %v, want Beta asked again and its Release grabbed", out, err)
	}
	if r.asked2.Load() == asked {
		t.Error("Beta was not asked again")
	}
	if out.Releases != 2 {
		t.Errorf("releases = %d, want Alpha's cached one and Beta's: Alpha was not asked again", out.Releases)
	}
	if got := lastReason(t, hist); !strings.Contains(got, "part answered from a search 10 min ago") {
		t.Errorf("reason = %q", got)
	}
}

func TestAnRSSReleaseNotGrabbedIsPickedByARetryFromTheCacheAndTheGrabSaysItCameFromRSS(t *testing.T) {
	ctx := history.WithTrigger(context.Background(), history.Job(history.TriggerRSS, ""))
	r := newRig(t)
	hist := r.logged(t)
	r.publishPlain(t, hd1080)
	r.publishPlain(t, hd1080web)

	out, err := r.svc.SyncRSS(ctx)
	if err != nil || len(out.Grabbed) != 1 || out.Grabbed[0].ReleaseName != hd1080 {
		t.Fatalf("SyncRSS = %+v, %v", out, err)
	}
	r.publish(t, "Paddington.2014.1080p.BluRay.x264-NEW", time.Hour) // a search of the indexers would pick this one
	r.clock.now = r.clock.now.Add(12 * time.Minute)

	imp := history.WithTrigger(context.Background(), history.Job(history.TriggerImport, ""))
	_ = r.sab.Complete(out.Grabbed[0].ClientID, "/data/usenet/movies/Paddington")
	_, _ = r.svc.Poll(imp)
	if _, err := r.svc.DueImports(imp); err != nil {
		t.Fatal(err)
	}
	if err := r.svc.RecordImport(imp, out.Grabbed[0].ID, true, acquire.ImportOutcome{Status: acquire.ImportRejected, Reason: "language"}); err != nil {
		t.Fatal(err)
	}

	a := r.active(t)
	if len(a) != 1 || a[0].ReleaseName != hd1080web {
		t.Fatalf("active = %+v, want the Release RSS saw", a)
	}
	grabs := eventsOf(t, hist, history.GrabSent)
	if got := grabs[len(grabs)-1].Reason; !strings.Contains(got, "found in RSS 12 min ago") {
		t.Errorf("grab reason = %q, want it to say RSS", got)
	}
}
