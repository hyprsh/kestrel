package acquire_test

import (
	"sync/atomic"
	"testing"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/library"
)

const (
	nightPack2 = "Night.Show.S02.1080p.WEB-DL.H264-GRP"
)

// requests counts the indexer requests a search asks for, as the Releases it reports back.
type requests struct{ n atomic.Int64 }

func (r *requests) Searching(acquire.Target) {}
func (r *requests) Releases(int)             { r.n.Add(1) }

// twoSeasons is Night Show with two aired seasons of two episodes each.
func (r *rig) twoSeasons(t *testing.T) (titleID, versionID int64) {
	t.Helper()
	d, v := nightShow()
	v.Episodes[2].Aired = day(2026, 2, 5)
	next := v.Episodes[2]
	next.ID, next.Number, next.Name, next.Aired = 4, 2, "Daybreak", day(2026, 2, 12)
	v.Episodes = append(v.Episodes, next)
	id := r.addSeries(t, d, v, library.MonitorAll)
	det, err := r.lib.Get(byPerson(), id, library.View{Country: "US", Now: r.clock.now})
	if err != nil {
		t.Fatal(err)
	}
	return id, det.Versions[0].ID
}

func TestASeriesSearchWithAWholeSeriesHitForEveryWantedSeasonSendsNoPerSeasonQueries(t *testing.T) {
	ctx := byPerson()
	r := newRig(t)
	id, ver := r.twoSeasons(t)
	r.publishShow(t, nightPack, "1", "")
	r.publishShow(t, nightPack2, "2", "")
	obs := &requests{}

	out, err := r.svc.SearchWanted(acquire.WithObserver(ctx, obs), id, []int64{ver})
	if err != nil {
		t.Fatal(err)
	}
	if got := obs.n.Load(); got != 1 {
		t.Errorf("%d queries, want the one for the whole Series", got)
	}
	if len(out.Grabbed) != 2 {
		t.Errorf("grabbed %+v, want both season packs", out.Grabbed)
	}
}

func TestEpisodeReleasesOfASeasonCountAsItsCandidate(t *testing.T) {
	ctx := byPerson()
	r := newRig(t)
	id, ver := r.twoSeasons(t)
	r.publishShow(t, nightEp1, "1", "1")
	r.publishShow(t, nightEp2, "1", "2")
	r.publishShow(t, nightS2, "2", "1")
	obs := &requests{}

	if _, err := r.svc.SearchWanted(acquire.WithObserver(ctx, obs), id, []int64{ver}); err != nil {
		t.Fatal(err)
	}
	if got := obs.n.Load(); got != 1 {
		t.Errorf("%d queries, want 1", got)
	}
}

func TestASeasonWithNoCandidateInTheWholeSeriesAnswerIsAskedForOnItsOwn(t *testing.T) {
	ctx := byPerson()
	r := newRig(t)
	id, ver := r.twoSeasons(t)
	r.publishShow(t, nightPack, "1", "")
	obs := &requests{}

	out, err := r.svc.SearchWanted(acquire.WithObserver(ctx, obs), id, []int64{ver})
	if err != nil {
		t.Fatal(err)
	}
	if got := obs.n.Load(); got != 2 {
		t.Errorf("%d queries, want the whole Series and season 2", got)
	}
	if len(out.Grabbed) != 1 || out.Grabbed[0].ReleaseName != nightPack {
		t.Errorf("grabbed %+v", out.Grabbed)
	}
}
