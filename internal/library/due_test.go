package library_test

import (
	"context"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/resolution"
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

	if err := lib.MarkMissingSearched(ctx, d.Versions[0].ID, now, now.Add(6*time.Hour)); err != nil {
		t.Fatal(err)
	}

	due, _ = lib.DueMissing(ctx, now)
	if len(due) != 1 || due[0].VersionID != d.Versions[1].ID {
		t.Errorf("due after marking the HD Version searched = %+v", due)
	}
	due, _ = lib.DueMissing(ctx, now.Add(6*time.Hour))
	if len(due) != 2 {
		t.Errorf("due six hours later = %+v, want both again", due)
	}
}

func TestRequestSearchMakesAVersionDueNow(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t)
	id := addPaddington(t, lib)
	d, _ := lib.Get(ctx, id, library.View{Country: "US", Now: now})
	vid := d.Versions[0].ID
	if err := lib.MarkMissingSearched(ctx, vid, now, now.Add(24*time.Hour)); err != nil {
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

	if err := lib.MarkMissingSearched(ctx, d.Versions[0].ID, now, now.Add(6*time.Hour)); err != nil {
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
