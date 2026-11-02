package acquire_test

import (
	"context"
	"slices"
	"testing"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/slot"
)

// nightWith is Night Show with a second Version in the 4K Slot on the given Profile.
func (r *rig) nightWith(t *testing.T, profile string) (titleID int64, versions []int64) {
	t.Helper()
	id, std := r.nightShow(t, library.MonitorAll)
	other, err := r.lib.AddVersion(context.Background(), id, library.VersionSpec{Slot: slot.FourK, Profile: profile})
	if err != nil {
		t.Fatal(err)
	}
	return id, []int64{std, other}
}

func TestASeasonPackThatIsThePickForTwoSeriesVersionsIsGrabbedOnce(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	id, vs := r.nightWith(t, "any-primary")
	r.publishShow(t, nightEp1, "1", "1")
	r.publishShow(t, nightEp2, "1", "2")
	r.publishShow(t, nightPack, "1", "")

	out, err := r.svc.SearchWanted(ctx, id, vs)
	if err != nil {
		t.Fatal(err)
	}

	if len(out.Grabbed) != 1 || out.Grabbed[0].ReleaseName != nightPack || !slices.Equal(out.Grabbed[0].VersionIDs, vs) {
		t.Fatalf("grabbed = %+v, want the pack once, bound to both Versions", out.Grabbed)
	}
	if got, _ := r.svc.GrabEpisodes(ctx, out.Grabbed[0].ID); len(got) != 2 {
		t.Errorf("pack covers %d episodes, want 2", len(got))
	}
	if items, _ := r.sab.List(ctx, r.sab.Conn(0), "tv"); len(items) != 1 {
		t.Errorf("client holds %d jobs, want 1", len(items))
	}
	again, err := r.svc.SearchWanted(ctx, id, vs)
	if err != nil || len(again.Grabbed) != 0 {
		t.Errorf("a second search grabbed %+v, %v, want both Versions' episodes counted as fetched", again.Grabbed, err)
	}
}

func TestASingleEpisodeThatIsThePickForTwoSeriesVersionsIsGrabbedOnce(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	id, vs := r.nightWith(t, "any-primary")
	r.publishShow(t, nightEp1, "1", "1")

	out, err := r.svc.SearchWanted(ctx, id, vs)
	if err != nil || len(out.Grabbed) != 1 || !slices.Equal(out.Grabbed[0].VersionIDs, vs) {
		t.Fatalf("outcome = %+v, %v, want one download bound to both Versions", out, err)
	}
}

func TestAnRSSEpisodeThatFitsTwoSeriesVersionsIsGrabbedOnce(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	_, vs := r.nightWith(t, "any-primary")
	r.publishTV(t, nightEp1)

	out, err := r.svc.SyncRSS(ctx)
	if err != nil || len(out.Grabbed) != 1 || !slices.Equal(out.Grabbed[0].VersionIDs, vs) {
		t.Fatalf("outcome = %+v, %v, want one download bound to both Versions", out, err)
	}
	if again, _ := r.svc.SyncRSS(ctx); len(again.Grabbed) != 0 {
		t.Errorf("rerun grabbed %+v", again.Grabbed)
	}
}

func TestSeriesVersionsThatDoNotOverlapGetOneDownloadEach(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	id, vs := r.nightWith(t, "4k-primary")
	r.publishShow(t, nightPack, "1", "")
	const uhdPack = "Night.Show.S01.2160p.WEB-DL.H265-GRP"
	r.publishShow(t, uhdPack, "1", "")

	out, err := r.svc.SearchWanted(ctx, id, vs)
	if err != nil || len(out.Grabbed) != 2 {
		t.Fatalf("outcome = %+v, %v, want one download per Version", out, err)
	}
	for _, g := range out.Grabbed {
		if len(g.VersionIDs) != 1 {
			t.Errorf("grab %q binds %v, want one Version", g.ReleaseName, g.VersionIDs)
		}
	}
}
