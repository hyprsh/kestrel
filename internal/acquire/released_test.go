package acquire_test

import (
	"context"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/metadata"
)

// undatedFinale is Night Show with a season 1 finale TheTVDB lists without an
// air date, followed by a season 2 premiere airing at next.
func (r *rig) undatedFinale(t *testing.T, next *time.Time) (titleID, versionID int64) {
	t.Helper()
	d, v := nightShow()
	v.Episodes = []metadata.Episode{
		{ID: 1, Season: 1, Number: 1, Name: "Dusk", Aired: day(2026, 1, 5)},
		{ID: 2, Season: 1, Number: 2, Name: "Midnight"},
		{ID: 3, Season: 2, Number: 1, Name: "Dawn", Aired: next},
	}
	id := r.addSeries(t, d, v, library.MonitorAll)
	det, err := r.lib.Get(context.Background(), id, library.View{Country: "US", Now: r.clock.now})
	if err != nil {
		t.Fatal(err)
	}
	return id, det.Versions[0].ID
}

func TestASearchGrabsAPackForASeasonWithAnUndatedFinaleOnceTheNextSeasonHasAired(t *testing.T) {
	for _, tc := range []struct {
		name string
		next *time.Time
		want string
	}{
		{"next season aired: the pack", day(2026, 2, 1), nightPack},
		{"next season still to air: the single", day(2099, 1, 1), nightEp1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			r := newRig(t)
			id, ver := r.undatedFinale(t, tc.next)
			r.publishShow(t, nightEp1, "1", "1")
			r.publishShow(t, nightPack, "1", "")

			// SearchNew runs the sweep's search without its real-time pacing.
			out, err := r.svc.SearchNew(ctx, id, []int64{ver})
			if err != nil {
				t.Fatal(err)
			}
			if len(out.Grabbed) != 1 || out.Grabbed[0].ReleaseName != tc.want {
				t.Fatalf("grabbed = %+v", out.Grabbed)
			}
		})
	}
}

func TestRSSGrabsAPackForASeasonWithAnUndatedFinaleOnceTheNextSeasonHasAired(t *testing.T) {
	for _, tc := range []struct {
		name string
		next *time.Time
		want string
	}{
		{"next season aired: the pack", day(2026, 2, 1), nightPack},
		{"next season still to air: the single", day(2099, 1, 1), nightEp1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := newRig(t)
			r.undatedFinale(t, tc.next)
			r.publishTV(t, nightEp1)
			r.publishTV(t, nightPack)

			out, err := r.svc.SyncRSS(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			if len(out.Grabbed) != 1 || out.Grabbed[0].ReleaseName != tc.want {
				t.Fatalf("grabbed = %+v", out.Grabbed)
			}
		})
	}
}
