package library_test

import (
	"context"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/resolution"
	"github.com/hyprsh/kestrel/internal/store"
)

func TestAFreshlyAddedMovieVersionIsDueForAMissingSearchUntilItIsMarkedSearched(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t)
	id := addPaddington(t, lib,
		library.VersionSpec{Slot: resolution.HD, Profile: "hd-primary"},
		library.VersionSpec{Slot: resolution.UHD, Profile: "uhd-primary"})
	d, _ := lib.Get(ctx, id, library.View{Country: "US", Now: now})

	due, err := lib.DueMissing(ctx, now)
	if err != nil {
		t.Fatal(err)
	}
	if len(due) != 2 || due[0].TitleID != id || due[0].VersionID != d.Versions[0].ID || due[1].VersionID != d.Versions[1].ID {
		t.Fatalf("due = %+v, want both Versions of title %d", due, id)
	}

	if err := lib.MarkMissingSearched(ctx, d.Versions[0].ID, now, false); err != nil {
		t.Fatal(err)
	}

	due, _ = lib.DueMissing(ctx, now)
	if len(due) != 1 || due[0].VersionID != d.Versions[1].ID {
		t.Errorf("due after marking the HD Version searched = %+v", due)
	}
	due, _ = lib.DueMissing(ctx, now.Add(24*time.Hour))
	if len(due) != 2 {
		t.Errorf("due a day later = %+v, want both again", due)
	}
}

func TestOnlyAVersionNeverSearchedIsFresh(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t)
	id := addPaddington(t, lib)
	d, _ := lib.Get(ctx, id, library.View{Country: "US", Now: now})

	due, _ := lib.DueMissing(ctx, now)
	if len(due) != 1 || !due[0].Fresh {
		t.Fatalf("due on add = %+v, want fresh", due)
	}

	if err := lib.MarkMissingSearched(ctx, d.Versions[0].ID, now, false); err != nil {
		t.Fatal(err)
	}
	due, _ = lib.DueMissing(ctx, now.Add(24*time.Hour))
	if len(due) != 1 || due[0].Fresh {
		t.Errorf("due a day later = %+v, want a sweep, not fresh", due)
	}
}

func TestAnAdoptedWantedVersionJoinsTheRollingSweepInsteadOfBeingFresh(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t)
	id, _, err := lib.AdoptMovie(ctx, library.AdoptMovie{
		Details: paddington(), PrimaryLanguage: "de", RootFolder: "/data/media/movies", Folder: "Paddington (2014)",
		Versions: []library.AdoptVersion{{
			Slot: resolution.HD, Profile: "hd-primary",
			File: library.NewFile{Path: "/data/media/movies/Paddington (2014)/p.mkv", Size: 1, ReleaseName: "p", Misfit: true},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}

	due, err := lib.DueMissing(ctx, now)
	if err != nil {
		t.Fatal(err)
	}
	if len(due) != 1 || due[0].TitleID != id || due[0].Fresh {
		t.Errorf("due = %+v, want the adopted Version in the rolling sweep, not fresh", due)
	}
}

func TestRequestSearchMakesAVersionDueNow(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t)
	id := addPaddington(t, lib)
	d, _ := lib.Get(ctx, id, library.View{Country: "US", Now: now})
	vid := d.Versions[0].ID
	if err := lib.MarkMissingSearched(ctx, vid, now, false); err != nil {
		t.Fatal(err)
	}

	if err := lib.RequestSearch(ctx, vid); err != nil {
		t.Fatal(err)
	}

	if due, _ := lib.DueMissing(ctx, now); len(due) != 1 {
		t.Errorf("due = %+v", due)
	}
}

func TestUnmonitoredTitlesAreNeverDue(t *testing.T) {
	ctx := context.Background()
	lib, st := newLibrary(t)
	id := addPaddington(t, lib)
	if _, err := st.Write().ExecContext(ctx, `UPDATE titles SET monitored = 0 WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}

	if due, err := lib.DueMissing(ctx, now); err != nil || len(due) != 0 {
		t.Errorf("due = %+v, %v, want none", due, err)
	}
	if due, err := lib.DueUpgrades(ctx, now.Add(365*24*time.Hour), 0); err != nil || len(due) != 0 {
		t.Errorf("upgrades due = %+v, %v, want none", due, err)
	}
}

func TestASeriesVersionIsDueOnceWhateverItsSeasonsAndOneMarkSchedulesAllOfThem(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t)
	id := addShow(t, lib, library.MonitorAll)
	d, _ := lib.Get(ctx, id, library.View{Country: "US", Now: now})

	due, err := lib.DueMissing(ctx, now)
	if err != nil || len(due) != 1 || due[0].VersionID != d.Versions[0].ID || due[0].TitleID != id {
		t.Fatalf("due = %+v, %v, want the Version once", due, err)
	}

	if err := lib.MarkMissingSearched(ctx, d.Versions[0].ID, now, false); err != nil {
		t.Fatal(err)
	}
	if due, _ := lib.DueMissing(ctx, now); len(due) != 0 {
		t.Errorf("due after the search = %+v", due)
	}

	if err := lib.RequestSeasonSearch(ctx, d.Versions[0].ID, []int{2}); err != nil {
		t.Fatal(err)
	}
	if due, _ := lib.DueMissing(ctx, now); len(due) != 1 {
		t.Errorf("due after a season request = %+v", due)
	}
}

func TestAnUnreleasedMovieIsNotDueAndAFailedSearchIsRetriedSoon(t *testing.T) {
	ctx := context.Background()
	st, err := store.Open(ctx, store.Options{Dir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	clock := now
	lib := library.New(st, func() time.Time { return clock }).WithCountry(func(context.Context) string { return "US" })

	upcoming := paddington()
	upcoming.ReleaseDates = metadata.ReleaseDates{{Country: "US", Type: metadata.Digital, Date: now.Add(48 * time.Hour)}}
	id, err := lib.AddMovie(ctx, library.AddMovie{
		Details: upcoming, PrimaryLanguage: "en", RootFolder: "/m", Versions: []library.VersionSpec{{Slot: resolution.HD, Profile: "hd-primary"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if due, _ := lib.DueMissing(ctx, now); len(due) != 0 {
		t.Fatalf("an unreleased Movie is due: %+v", due)
	}

	released := now.Add(72 * time.Hour)
	due, _ := lib.DueMissing(ctx, released)
	if len(due) != 1 || due[0].TitleID != id {
		t.Fatalf("once released it is due: %+v", due)
	}
	if err := lib.MarkMissingSearched(ctx, due[0].VersionID, released, true); err != nil {
		t.Fatal(err)
	}
	if due, _ := lib.DueMissing(ctx, released.Add(14*time.Minute)); len(due) != 0 {
		t.Errorf("due before the retry = %+v", due)
	}
	if due, _ := lib.DueMissing(ctx, released.Add(15*time.Minute)); len(due) != 1 {
		t.Errorf("due at the retry = %+v", due)
	}
}
