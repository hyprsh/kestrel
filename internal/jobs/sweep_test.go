package jobs_test

import (
	"context"
	"github.com/hyprsh/kestrel/internal/slot"
	"sync"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/jobs"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/store"
	"github.com/hyprsh/kestrel/internal/store/storetest"
)

// A Library on a clock the test moves, a Movie in it, and an acquirer that
// records what it is asked to search for. The sweep itself is the real one.
type sweepRig struct {
	t       *testing.T
	ctx     context.Context
	clock   time.Time
	lib     *library.Service
	runner  *jobs.Runner
	acq     *recorder
	titleID int64
	version int64
}

type recorder struct {
	fakeAcquire
	mu2     sync.Mutex
	wanted  []time.Time
	added   []time.Time
	upgrade []time.Time
	now     func() time.Time
}

func (r *recorder) SearchWanted(_ context.Context, _ int64, v []int64) (acquire.Outcome, error) {
	r.mu2.Lock()
	defer r.mu2.Unlock()
	r.wanted = append(r.wanted, r.now())
	return acquire.Outcome{Searched: v}, nil
}

func (r *recorder) SearchNew(_ context.Context, _ int64, v []int64) (acquire.Outcome, error) {
	r.mu2.Lock()
	defer r.mu2.Unlock()
	r.added = append(r.added, r.now())
	r.wanted = append(r.wanted, r.now())
	return acquire.Outcome{Searched: v}, nil
}

func (r *recorder) SearchUpgrades(_ context.Context, _ int64, v []int64) (acquire.Outcome, error) {
	r.mu2.Lock()
	defer r.mu2.Unlock()
	r.upgrade = append(r.upgrade, r.now())
	return acquire.Outcome{Searched: v}, nil
}

func newSweepRig(t *testing.T) *sweepRig {
	t.Helper()
	ctx := context.Background()
	st, err := store.Open(ctx, store.Options{Dir: storetest.Dir(t)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	rig := &sweepRig{t: t, ctx: ctx, clock: now}
	clock := func() time.Time { return rig.clock }
	rig.lib = library.New(st, clock).WithCountry(func(context.Context) string { return "US" })
	rig.acq = &recorder{now: clock}
	rig.runner = jobs.Standard(jobs.Deps{Acquire: rig.acq, Library: rig.lib, Clock: clock})

	id, err := rig.lib.AddMovie(ctx, library.AddMovie{
		Details: metadata.MovieDetails{
			TMDBID: 1, Title: "Paddington", OriginalTitle: "Paddington", OriginalLanguage: "en", Year: 2014,
			ReleaseDates: metadata.ReleaseDates{{Country: "US", Type: metadata.Digital, Date: time.Date(2015, 4, 1, 0, 0, 0, 0, time.UTC)}},
		},
		PrimaryLanguage: "en", RootFolder: "/m", Versions: []library.VersionSpec{{Slot: slot.Standard, Profile: "hd-primary"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	d, err := rig.lib.Get(ctx, id, library.View{Country: "US", Now: now})
	if err != nil {
		t.Fatal(err)
	}
	rig.titleID, rig.version = id, d.Versions[0].ID
	return rig
}

// passAt runs the sweep at now+offset and reports how many Wanted and Upgrade searches it made.
func (r *sweepRig) passAt(offset time.Duration) (wanted, upgrades int) {
	r.t.Helper()
	r.clock = now.Add(offset)
	w0, u0 := len(r.acq.wanted), len(r.acq.upgrade)
	if err := r.runner.Pass(r.ctx, jobs.Search); err != nil {
		r.t.Fatal(err)
	}
	return len(r.acq.wanted) - w0, len(r.acq.upgrade) - u0
}

const hour = time.Hour

func TestTheFirstSearchOfAVersionIsSearchOnAddAndOnlyTheLaterOnesAreSweeps(t *testing.T) {
	rig := newSweepRig(t)

	rig.passAt(0)
	rig.passAt(24 * hour)

	if len(rig.acq.added) != 1 || len(rig.acq.wanted) != 2 {
		t.Fatalf("searched on add %d times, in all %d; want 1 and 2", len(rig.acq.added), len(rig.acq.wanted))
	}
}

func TestAWantedMovieIsSearchedOnAddThenAtOneThreeAndSevenDaysAndAFilledOneGetsAnUpgradeSearchAfterThirtyDays(t *testing.T) {
	rig := newSweepRig(t)

	if w, _ := rig.passAt(0); w != 1 {
		t.Fatalf("search on add: %d searches, want 1", w)
	}
	// Sweeps in between find nothing due.
	for _, off := range []time.Duration{5 * time.Minute, 23 * hour} {
		if w, u := rig.passAt(off); w+u != 0 {
			t.Fatalf("at +%v: %d+%d searches, want none", off, w, u)
		}
	}
	for _, c := range []struct {
		name string
		at   time.Duration
		gap  time.Duration // a sweep this long before is quiet
	}{
		{"+1d", 24 * hour, 5 * time.Minute},
		{"+3d", 72 * hour, 5 * time.Minute},
		{"+7d", 7 * 24 * hour, 5 * time.Minute},
	} {
		if w, _ := rig.passAt(c.at - c.gap); w != 0 {
			t.Fatalf("%s: searched %v early", c.name, c.gap)
		}
		if w, _ := rig.passAt(c.at); w != 1 {
			t.Fatalf("%s: %d searches, want 1", c.name, w)
		}
	}

	// The Movie is filled (a Grab was imported at +8d). The missing search at +7d
	// counted as an Upgrade search, so the next one is 30 days after it.
	if _, err := rig.lib.ReplaceFile(rig.ctx, rig.titleID, "Paddington (2014)", library.NewFile{
		VersionID: rig.version, Path: "/m/Paddington.mkv", Size: 1, ReleaseName: "Paddington.2014.1080p", Score: 100,
	}); err != nil {
		t.Fatal(err)
	}
	if w, u := rig.passAt(8 * 24 * hour); w+u != 0 {
		t.Fatalf("a filled Version is searched at once: %d+%d", w, u)
	}
	if _, u := rig.passAt(37*24*hour - time.Minute); u != 0 {
		t.Fatal("Upgrade search before 30 days")
	}
	w, u := rig.passAt(37 * 24 * hour)
	if u != 1 || w != 0 {
		t.Fatalf("after 30 days: %d Wanted and %d Upgrade searches, want one Upgrade search", w, u)
	}
	if _, u := rig.passAt(37*24*hour + 5*time.Minute); u != 0 {
		t.Fatal("the Upgrade search repeats on the next pass")
	}
	if _, u := rig.passAt(67 * 24 * hour); u != 1 {
		t.Fatal("no second Upgrade search 30 days later: Upgrades are searched forever")
	}
}

func TestSearchAllWantedMakesTheNextPassSearchEveryWantedVersion(t *testing.T) {
	rig := newSweepRig(t)
	rig.passAt(0)
	if w, _ := rig.passAt(time.Hour); w != 0 {
		t.Fatal("searched again within the day")
	}

	if n, err := rig.lib.SearchAllWanted(rig.ctx); err != nil || n != 1 {
		t.Fatalf("SearchAllWanted = %d, %v", n, err)
	}
	if w, _ := rig.passAt(time.Hour); w != 1 {
		t.Fatalf("the pass after Search all Wanted made %d searches, want 1", w)
	}
}
