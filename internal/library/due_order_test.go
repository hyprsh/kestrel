package library_test

import (
	"context"
	"github.com/hyprsh/kestrel/internal/slot"
	"slices"
	"testing"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/metadata"
)

func TestDueMissingGoesRequestAddedFirstThenMostRecentlyReleased(t *testing.T) {
	ctx := context.Background()
	lib, st := newLibrary(t)
	add := func(tmdb int, released string) library.Detail {
		d := paddington()
		d.TMDBID, d.IMDbID = tmdb, ""
		var y, m, dd int
		switch released {
		case "old":
			y, m, dd = 2015, 1, 16
		case "middle":
			y, m, dd = 2020, 5, 1
		case "recent":
			y, m, dd = 2026, 3, 1
		default:
			y, m, dd = 2010, 1, 1
		}
		d.ReleaseDates = metadata.ReleaseDates{{Country: "US", Type: metadata.Theatrical, Date: day(y, 1, 1).AddDate(0, m-1, dd-1)}}
		id, err := lib.AddMovie(ctx, library.AddMovie{
			Details: d, PrimaryLanguage: "en", RootFolder: "/data/media/movies",
			Versions: []library.VersionSpec{{Slot: slot.Standard, Profile: "hd-primary"}},
		})
		if err != nil {
			t.Fatal(err)
		}
		got, _ := lib.Get(ctx, id, library.View{Country: "US", Now: now})
		return got
	}
	old := add(1, "old")
	recent := add(2, "recent")
	middle := add(3, "middle")
	requested := add(4, "ancient")
	if _, err := st.Write().ExecContext(ctx, `INSERT INTO requests (id, source, source_request_id, requester_id, requester_name, title_id, outcome, created_at)
		VALUES (1, 'silo', 'r1', 'u1', 'Una', ?, 'accepted', '2026-10-17T12:00:00Z')`, requested.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Write().ExecContext(ctx, `INSERT INTO request_slots (request_id, slot, version_id) VALUES (1, 'standard', ?)`, requested.Versions[0].ID); err != nil {
		t.Fatal(err)
	}

	due, err := lib.DueMissing(ctx, now)
	if err != nil {
		t.Fatal(err)
	}
	var got []int64
	for _, d := range due {
		got = append(got, d.TitleID)
	}
	if want := []int64{requested.ID, recent.ID, middle.ID, old.ID}; !slices.Equal(got, want) {
		t.Errorf("order = %v, want %v", got, want)
	}
}
