package library_test

import (
	"context"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/slot"
)

// addEpisodes adds a Series with these episodes, monitoring all, at the clock's
// time, and returns its id and its Standard Version's id.
func addEpisodes(t *testing.T, lib *library.Service, eps ...metadata.Episode) (int64, int64) {
	t.Helper()
	d, _ := show()
	id, err := lib.AddSeries(context.Background(), library.AddSeries{
		TMDB: d, TVDB: metadata.TVDBSeries{ID: 81189, Name: "Breaking Bad", Episodes: eps}, PrimaryLanguage: "en",
		Monitor: library.MonitorAll, RootFolder: "/tv", Versions: []library.VersionSpec{{Slot: slot.Standard, Profile: "hd-primary"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	return id, mustVersion(t, lib, id)
}

// episodeNamed is the episode with this name as the Library lists it at now.
func episodeNamed(t *testing.T, lib *library.Service, id int64, name string, now time.Time) library.Episode {
	t.Helper()
	eps, err := lib.Episodes(context.Background(), id, library.View{Country: "US", Now: now})
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range eps {
		if e.Name == name {
			return e
		}
	}
	t.Fatalf("no episode %q", name)
	return library.Episode{}
}

// fileFor imports a file for the named episode at the clock's time.
func fileFor(t *testing.T, lib *library.Service, id, version int64, name string, now time.Time, path string) {
	t.Helper()
	ep := episodeNamed(t, lib, id, name, now)
	if _, err := lib.ReplaceEpisodeFile(context.Background(), id, "F", newEpisodeFile(version, path, 10), []int64{ep.ID}); err != nil {
		t.Fatal(err)
	}
}

func versionState(t *testing.T, lib *library.Service, id int64, now time.Time) library.Version {
	t.Helper()
	d, err := lib.Get(context.Background(), id, library.View{Country: "US", Now: now})
	if err != nil {
		t.Fatal(err)
	}
	return d.Versions[0]
}

func TestAnUndatedEpisodeIsUnreleasedWhileNoLaterEpisodeIsOut(t *testing.T) {
	lib, _ := newLibrary(t)
	id, _ := addEpisodes(t, lib,
		metadata.Episode{ID: 1, Season: 1, Number: 1, Name: "Undated"},
		metadata.Episode{ID: 2, Season: 2, Number: 1, Name: "Future", Aired: aired(2099, 1, 1)},
	)
	ep := episodeNamed(t, lib, id, "Undated", now)
	if c := ep.Cells[slot.Standard]; c.State != library.Unreleased || ep.AirDate != nil {
		t.Fatalf("undated = %s, air date %v", c.State, ep.AirDate)
	}
	if v := versionState(t, lib, id, now); v.State != library.Unreleased {
		t.Fatalf("version = %s", v.State)
	}
}

func TestAnUndatedEpisodeIsWantedOnceALaterEpisodeHasAiredSinceTheLaterOfThatAndTheAdd(t *testing.T) {
	lib, clock, _ := clocked(t)
	*clock = time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	id, ver := addEpisodes(t, lib,
		metadata.Episode{ID: 1, Season: 1, Number: 1, Name: "Undated"},
		metadata.Episode{ID: 2, Season: 1, Number: 2, Name: "Next", Aired: aired(2026, 10, 1)},
	)
	*clock = time.Date(2026, 10, 2, 0, 0, 0, 0, time.UTC)
	fileFor(t, lib, id, ver, "Next", *clock, "/tv/next.mkv") // only the undated episode is left missing
	*clock = now

	ep := episodeNamed(t, lib, id, "Undated", now)
	if c := ep.Cells[slot.Standard]; c.State != library.Wanted || !sameDay(ep.Released, 2026, 10, 1) || ep.AirDate != nil {
		t.Fatalf("undated = %s, released %v, air date %v", c.State, ep.Released, ep.AirDate)
	}
	v := versionState(t, lib, id, now)
	if v.State != library.Wanted || !sameDay(v.WantedSince, 2026, 10, 1) || v.LongMissing {
		t.Fatalf("version = %s since %v, long missing %v", v.State, v.WantedSince, v.LongMissing)
	}
	// Long Missing counts from that release: over 90 days later, not before.
	if v := versionState(t, lib, id, time.Date(2026, 12, 25, 0, 0, 0, 0, time.UTC)); v.LongMissing {
		t.Fatal("long missing after 85 days")
	}
	if v := versionState(t, lib, id, time.Date(2027, 1, 15, 0, 0, 0, 0, time.UTC)); !v.LongMissing {
		t.Fatal("not long missing after 106 days")
	}
	rows, err := lib.List(context.Background(), library.View{Country: "US", Now: now}, library.Filter{Wanted: true})
	if err != nil || len(rows) != 1 || !sameDay(rows[0].WantedSince, 2026, 10, 1) {
		t.Fatalf("wanted rows = %+v, %v", rows, err)
	}
}

func TestAnUndatedEpisodeIsWantedOnceALaterUndatedEpisodeHoldsAFileSinceItsImport(t *testing.T) {
	lib, clock, _ := clocked(t)
	*clock = time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	id, ver := addEpisodes(t, lib,
		metadata.Episode{ID: 1, Season: 1, Number: 1, Name: "Undated"},
		metadata.Episode{ID: 2, Season: 1, Number: 2, Name: "Also undated"},
	)
	if c := episodeNamed(t, lib, id, "Undated", now).Cells[slot.Standard]; c.State != library.Unreleased {
		t.Fatalf("before the file = %s", c.State)
	}
	*clock = time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC)
	fileFor(t, lib, id, ver, "Also undated", *clock, "/tv/e2.mkv")
	*clock = now

	ep := episodeNamed(t, lib, id, "Undated", now)
	if c := ep.Cells[slot.Standard]; c.State != library.Wanted || !sameDay(ep.Released, 2026, 10, 5) {
		t.Fatalf("undated = %s, released %v", c.State, ep.Released)
	}
	if v := versionState(t, lib, id, now); v.State != library.Wanted || !sameDay(v.WantedSince, 2026, 10, 5) {
		t.Fatalf("version = %s since %v", v.State, v.WantedSince)
	}
}

func TestAFileInAnyVersionReleasesTheEarlierUndatedEpisodes(t *testing.T) {
	lib, _ := newLibrary(t)
	d, _ := show()
	id, err := lib.AddSeries(context.Background(), library.AddSeries{
		TMDB: d, TVDB: metadata.TVDBSeries{ID: 81189, Name: "Breaking Bad", Episodes: []metadata.Episode{
			{ID: 1, Season: 1, Number: 1, Name: "Undated"},
			{ID: 2, Season: 1, Number: 2, Name: "Also undated"},
		}}, PrimaryLanguage: "en", Monitor: library.MonitorAll, RootFolder: "/tv",
		Versions: []library.VersionSpec{{Slot: slot.Standard, Profile: "hd-primary"}, {Slot: slot.FourK, Profile: "4k-primary"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	dt, _ := lib.Get(context.Background(), id, library.View{Country: "US", Now: now})
	fileFor(t, lib, id, dt.Versions[1].ID, "Also undated", now, "/tv/4k.mkv")

	ep := episodeNamed(t, lib, id, "Undated", now)
	if ep.Cells[slot.Standard].State != library.Wanted || ep.Cells[slot.FourK].State != library.Wanted {
		t.Fatalf("undated = %s / %s", ep.Cells[slot.Standard].State, ep.Cells[slot.FourK].State)
	}
}

func TestAMisfitFileStillShowsTheLaterEpisodeIsOut(t *testing.T) {
	lib, _ := newLibrary(t)
	id, ver := addEpisodes(t, lib,
		metadata.Episode{ID: 1, Season: 1, Number: 1, Name: "Undated"},
		metadata.Episode{ID: 2, Season: 1, Number: 2, Name: "Also undated"},
	)
	later := episodeNamed(t, lib, id, "Also undated", now)
	f := newEpisodeFile(ver, "/tv/misfit.mkv", 10)
	f.Misfit = true
	if _, err := lib.ReplaceEpisodeFile(context.Background(), id, "F", f, []int64{later.ID}); err != nil {
		t.Fatal(err)
	}
	if c := episodeNamed(t, lib, id, "Undated", now).Cells[slot.Standard]; c.State != library.Wanted {
		t.Fatalf("undated = %s", c.State)
	}
}

func TestSpecialsNeitherReleaseNorAreReleasedByOtherEpisodes(t *testing.T) {
	lib, _ := newLibrary(t)
	id, ver := addEpisodes(t, lib,
		metadata.Episode{ID: 1, Season: 0, Number: 1, Name: "Undated special"},
		metadata.Episode{ID: 2, Season: 1, Number: 1, Name: "Undated"},
		metadata.Episode{ID: 3, Season: 0, Number: 2, Name: "Aired special", Aired: aired(2020, 1, 1)},
		metadata.Episode{ID: 4, Season: 0, Number: 3, Name: "Filed special"},
		metadata.Episode{ID: 5, Season: 2, Number: 1, Name: "Aired", Aired: aired(2020, 1, 1)},
	)
	fileFor(t, lib, id, ver, "Filed special", now, "/tv/s.mkv")
	special := episodeNamed(t, lib, id, "Undated special", now)
	if err := lib.SetEpisodesMonitored(context.Background(), id, []int64{special.ID}, true); err != nil {
		t.Fatal(err)
	}
	if c := episodeNamed(t, lib, id, "Undated special", now).Cells[slot.Standard]; c.State != library.Unreleased {
		t.Fatalf("undated special = %s", c.State)
	}
	if c := episodeNamed(t, lib, id, "Undated", now).Cells[slot.Standard]; c.State != library.Wanted {
		t.Fatalf("undated = %s", c.State) // released by S02E01, not by the Specials
	}
}

func TestTheWantedSweepSearchesTheSeasonOfAnUndatedEpisodeOnceALaterOneIsOut(t *testing.T) {
	ctx := context.Background()
	lib, clock, _ := clocked(t)
	id, ver := addEpisodes(t, lib,
		metadata.Episode{ID: 1, Season: 1, Number: 1, Name: "Undated"},
		metadata.Episode{ID: 2, Season: 2, Number: 1, Name: "Future", Aired: aired(2099, 1, 1)},
	)
	if err := lib.MarkMissingSearched(ctx, ver, now, false); err != nil { // the search on add
		t.Fatal(err)
	}
	if got := due(t, lib, now.Add(30*24*hours)); len(got) != 0 {
		t.Fatalf("due with nothing released: %+v", got)
	}
	*clock = now.Add(2 * 24 * hours)
	fileFor(t, lib, id, ver, "Future", *clock, "/tv/s02e01.mkv") // a file before the air date
	if got := due(t, lib, clock.Add(24*hours)); len(got) != 1 || got[0].VersionID != ver {
		t.Fatalf("due a day after the later file = %+v", got)
	}
}

func sameDay(t *time.Time, y int, m time.Month, d int) bool {
	return t != nil && t.Equal(time.Date(y, m, d, 0, 0, 0, 0, time.UTC))
}
