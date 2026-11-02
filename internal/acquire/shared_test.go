package acquire_test

import (
	"context"
	"slices"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/slot"
)

// overlapping is a rig whose two Versions both accept a 1080p Release: a
// Standard HD one and a 4K-Slot Any one (Any reaches up to 1080p).
func overlapping(t *testing.T) *rig {
	t.Helper()
	return newRigWith(t,
		library.VersionSpec{Slot: slot.Standard, Profile: "hd-primary"},
		library.VersionSpec{Slot: slot.FourK, Profile: "any-primary"},
	)
}

func TestOneReleaseThatIsThePickForTwoVersionsIsGrabbedOnce(t *testing.T) {
	ctx := context.Background()
	r := overlapping(t)
	r.publish(t, hd1080, time.Hour)

	out, err := r.svc.SearchWanted(ctx, r.titleID, r.wanted(t, slot.Standard, slot.FourK))
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Grabbed) != 1 {
		t.Fatalf("grabbed %d times, want one download: %+v", len(out.Grabbed), out.Grabbed)
	}
	g := out.Grabbed[0]
	want := r.wanted(t, slot.Standard, slot.FourK)
	if got := slices.Clone(g.VersionIDs); !slices.Equal(got, want) {
		t.Errorf("grab binds Versions %v, want %v", got, want)
	}
	items, _ := r.sab.List(ctx, r.sab.Conn(0), "films")
	if len(items) != 1 {
		t.Errorf("the client holds %d jobs, want 1", len(items))
	}
	active, err := r.svc.Active(ctx)
	if err != nil || len(active) != 1 || !slices.Equal(active[0].VersionIDs, want) {
		t.Errorf("Activity = %+v, %v, want one download filling both Versions", active, err)
	}
	again, err := r.svc.GetGrab(ctx, g.ID)
	if err != nil || !slices.Equal(again.VersionIDs, want) {
		t.Errorf("GetGrab = %+v, %v", again, err)
	}
}

func TestAVersionBoundToAnActiveGrabIsNotSearchedAgain(t *testing.T) {
	ctx := context.Background()
	r := overlapping(t)
	r.publish(t, hd1080, time.Hour)
	if _, err := r.svc.SearchWanted(ctx, r.titleID, r.wanted(t, slot.Standard, slot.FourK)); err != nil {
		t.Fatal(err)
	}

	out, err := r.svc.SearchWanted(ctx, r.titleID, r.wanted(t, slot.Standard, slot.FourK))
	if err != nil || len(out.Searched) != 0 || len(out.Grabbed) != 0 {
		t.Errorf("second search = %+v, %v, want both Versions left alone while the download runs", out, err)
	}
}

func TestVersionsThatDoNotOverlapGetOneDownloadEach(t *testing.T) {
	ctx := context.Background()
	r := newRig(t, slot.Standard, slot.FourK)
	r.publish(t, hd1080, time.Hour)
	r.publish(t, uhd, time.Hour)

	out, err := r.svc.SearchWanted(ctx, r.titleID, r.wanted(t, slot.Standard, slot.FourK))
	if err != nil || len(out.Grabbed) != 2 {
		t.Fatalf("outcome = %+v, %v, want one download per Version", out, err)
	}
	for _, g := range out.Grabbed {
		if len(g.VersionIDs) != 1 || g.VersionIDs[0] != g.VersionID {
			t.Errorf("grab %q binds %v, want only Version %d", g.ReleaseName, g.VersionIDs, g.VersionID)
		}
	}
}

func TestCancelingASharedGrabFreesEveryVersionItWasFor(t *testing.T) {
	ctx := context.Background()
	r := overlapping(t)
	r.publish(t, hd1080, time.Hour)
	out, _ := r.svc.SearchWanted(ctx, r.titleID, r.wanted(t, slot.Standard, slot.FourK))
	if len(out.Grabbed) != 1 {
		t.Fatalf("outcome = %+v", out)
	}
	// Canceling by either Version cancels the one download.
	if err := r.svc.CancelVersions(ctx, r.versions[slot.FourK]); err != nil {
		t.Fatal(err)
	}
	if active, _ := r.svc.Active(ctx); len(active) != 0 {
		t.Errorf("active = %+v, want none", active)
	}
}

func TestAFinishedSharedGrabIsDueForImportWithEveryVersion(t *testing.T) {
	ctx := context.Background()
	r := overlapping(t)
	r.publish(t, hd1080, time.Hour)
	out, _ := r.svc.SearchWanted(ctx, r.titleID, r.wanted(t, slot.Standard, slot.FourK))
	if len(out.Grabbed) != 1 {
		t.Fatalf("outcome = %+v", out)
	}
	_ = r.sab.Complete(out.Grabbed[0].ClientID, "/data/usenet/movies/Paddington")
	_, _ = r.svc.Poll(ctx)

	due, err := r.svc.DueImports(ctx)
	if err != nil || len(due) != 1 || !slices.Equal(due[0].VersionIDs, r.wanted(t, slot.Standard, slot.FourK)) {
		t.Fatalf("due = %+v, %v, want one Import for both Versions", due, err)
	}
}

func TestACanceledAndBlocklistedSharedGrabLooksForTheNextReleaseForEveryVersion(t *testing.T) {
	ctx := context.Background()
	r := overlapping(t)
	r.publish(t, hd1080, time.Hour)
	r.publish(t, hd1080web, 2*time.Hour)
	out, _ := r.svc.SearchWanted(ctx, r.titleID, r.wanted(t, slot.Standard, slot.FourK))
	if len(out.Grabbed) != 1 {
		t.Fatalf("outcome = %+v", out)
	}

	if _, err := r.svc.Cancel(ctx, out.Grabbed[0].ID, true); err != nil {
		t.Fatal(err)
	}

	active, _ := r.svc.Active(ctx)
	if len(active) != 1 || active[0].ReleaseName == out.Grabbed[0].ReleaseName || len(active[0].VersionIDs) != 2 {
		t.Errorf("active = %+v, want the next best Release, for both Versions", active)
	}
}
