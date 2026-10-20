package acquire_test

import (
	"context"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/slot"
)

// newDatelessRig is the rig with Paddington as TMDB lists it before it has
// any release date: Unreleased until a Release for it is seen.
func newDatelessRig(t *testing.T) *rig {
	t.Helper()
	d := paddington()
	d.ReleaseDates = nil
	return newRigOf(t, d, library.VersionSpec{Slot: slot.Standard, Profile: defaultProfiles[slot.Standard]})
}

func (r *rig) standard(t *testing.T) library.Version {
	t.Helper()
	d, err := r.lib.Get(context.Background(), r.titleID, library.View{Country: "US", Now: r.clock.now})
	if err != nil {
		t.Fatal(err)
	}
	return d.Versions[0]
}

func TestTheSweepSearchesAMovieWithNoReleaseDateAndGrabsWhatItFinds(t *testing.T) {
	ctx := context.Background()
	r := newDatelessRig(t)
	if st := r.standard(t).State; st != library.Unreleased {
		t.Fatalf("before = %v", st)
	}
	r.publish(t, hd1080, time.Hour)

	out, err := r.svc.SearchWanted(ctx, r.titleID, []int64{r.versions[slot.Standard]})
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Searched) != 1 || len(out.Grabbed) != 1 || out.Grabbed[0].ReleaseName != hd1080 {
		t.Fatalf("outcome = %+v", out)
	}
	if v := r.standard(t); v.WantedSince == nil || !v.WantedSince.Equal(r.clock.now) {
		t.Errorf("the search did not count as the Movie's release: %+v", v)
	}
}

func TestARejectedReleaseInASearchStillCountsAsTheMovieOut(t *testing.T) {
	ctx := context.Background()
	r := newDatelessRig(t)
	r.publish(t, german, time.Hour) // rejected for its language

	out, err := r.svc.SearchNew(ctx, r.titleID, []int64{r.versions[slot.Standard]})
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Searched) != 1 || len(out.Grabbed) != 0 {
		t.Fatalf("outcome = %+v", out)
	}
	if st := r.standard(t).State; st != library.Wanted {
		t.Errorf("after a search found a rejected Release = %v", st)
	}
}

func TestAnRSSItemForAMovieWithNoReleaseDateMarksItReleased(t *testing.T) {
	ctx := context.Background()
	r := newDatelessRig(t)
	r.publishPlain(t, hd1080)

	out, err := r.svc.SyncRSS(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Grabbed) != 1 {
		t.Fatalf("grabbed = %+v", out.Grabbed)
	}
	if v := r.standard(t); v.WantedSince == nil || !v.WantedSince.Equal(r.clock.now) {
		t.Errorf("an RSS item did not count as the Movie's release: %+v", v)
	}
}

func TestAManualSearchThatFindsNothingLeavesAMovieWithNoReleaseDateUnreleased(t *testing.T) {
	ctx := context.Background()
	r := newDatelessRig(t)
	if _, err := r.svc.Search(ctx, r.versions[slot.Standard]); err != nil {
		t.Fatal(err)
	}
	if st := r.standard(t).State; st != library.Unreleased {
		t.Errorf("after an empty search = %v", st)
	}
	r.publish(t, german, time.Hour)
	if _, err := r.svc.Search(ctx, r.versions[slot.Standard]); err != nil {
		t.Fatal(err)
	}
	if st := r.standard(t).State; st != library.Wanted {
		t.Errorf("after a manual search found a Release = %v", st)
	}
}
