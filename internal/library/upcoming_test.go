package library_test

import (
	"context"
	"github.com/hyprsh/kestrel/internal/slot"
	"testing"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/metadata"
)

func TestRecentImportsListsGrabbedFilesWithTheScoreTheyBeat(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t)
	id := addPaddington(t, lib,
		library.VersionSpec{Slot: slot.Standard, Profile: "hd-primary"},
		library.VersionSpec{Slot: slot.FourK, Profile: "4k-primary"})
	d, _ := lib.Get(ctx, id, library.View{Country: "US", Now: now})
	hd, uhd := d.Versions[0].ID, d.Versions[1].ID
	for _, f := range []library.NewFile{
		{VersionID: hd, Path: "/m/a.mkv", ReleaseName: "Paddington.WEB", Score: 100, GrabID: 1},
		{VersionID: uhd, Path: "/m/u.mkv", ReleaseName: "Paddington.UHD", Score: 400, GrabID: 2},
		{VersionID: hd, Path: "/m/b.mkv", ReleaseName: "Paddington.BluRay", Score: 250, GrabID: 3},
	} {
		if _, err := lib.ReplaceFile(ctx, id, "Paddington (2014)", f); err != nil {
			t.Fatal(err)
		}
	}

	got, err := lib.RecentImports(ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("recent = %+v, want two Imports", got)
	}
	for _, r := range got {
		switch r.Release {
		case "Paddington.BluRay":
			if r.ScoreDelta == nil || *r.ScoreDelta != 150 {
				t.Errorf("upgrade delta = %v, want +150", r.ScoreDelta)
			}
		case "Paddington.UHD":
			if r.ScoreDelta != nil {
				t.Errorf("first Import delta = %d, want none", *r.ScoreDelta)
			}
		default:
			t.Errorf("unexpected row %+v", r)
		}
	}
}

func TestRecentImportsLeavesOutAdoptedFiles(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t)
	if _, _, err := lib.AdoptMovie(ctx, library.AdoptMovie{
		Details: paddington(), PrimaryLanguage: "de", RootFolder: "/data/media/movies", Folder: "Paddington (2014)",
		Versions: []library.AdoptVersion{{
			Slot: slot.Standard, Profile: "hd-primary",
			File: library.NewFile{Path: "/data/media/movies/Paddington (2014)/p.mkv", Size: 1, ReleaseName: "p"},
		}},
	}); err != nil {
		t.Fatal(err)
	}
	got, err := lib.RecentImports(ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Errorf("recent = %+v, want no row for an adopted file", got)
	}
}

func TestUpcomingReadsEveryTypedDateInTheOneReleaseDateCountry(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t)
	d := paddington()
	d.ReleaseDates = metadata.ReleaseDates{
		{Country: "DE", Type: metadata.Theatrical, Date: day(2026, 10, 20)},
		{Country: "US", Type: metadata.Theatrical, Date: day(2026, 10, 19)},
		{Country: "US", Type: metadata.Digital, Date: day(2026, 11, 5)},
	}
	if _, err := lib.AddMovie(ctx, library.AddMovie{
		Details: d, PrimaryLanguage: "de", RootFolder: "/data/media/movies",
		Versions: []library.VersionSpec{{Slot: slot.Standard, Profile: "hd-primary"}},
	}); err != nil {
		t.Fatal(err)
	}

	agenda, err := lib.Upcoming(ctx, library.View{Country: "DE", Now: now}, day(2026, 10, 17), day(2026, 11, 16))
	if err != nil {
		t.Fatal(err)
	}
	got := agenda.Entries
	if len(got) != 1 || got[0].ReleaseType != library.TheatricalRelease || !got[0].Date.Equal(day(2026, 10, 20)) {
		t.Errorf("agenda for DE = %+v, want only the German theatrical date, not the US digital one", got)
	}
}
