package library_test

import (
	"context"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/slot"
)

// The library clock, and so "added", stands at `now`: 2026-10-17 12:00 UTC.

const webdl1080 = `{"quality":{"quality":{"name":"WEBDL-1080p"}}}`

func usDates(dates ...metadata.ReleaseDate) metadata.ReleaseDates {
	for i := range dates {
		dates[i].Country = "US"
	}
	return dates
}

func addMovieWith(t *testing.T, lib *library.Service, tmdb int, name string, dates metadata.ReleaseDates, versions ...library.VersionSpec) int64 {
	t.Helper()
	d := paddington()
	d.TMDBID, d.Title, d.OriginalTitle, d.ReleaseDates, d.Translations = tmdb, name, name, dates, nil
	if len(versions) == 0 {
		versions = []library.VersionSpec{{Slot: slot.Standard, Profile: "hd-primary"}}
	}
	id, err := lib.AddMovie(context.Background(), library.AddMovie{Details: d, PrimaryLanguage: "en", Versions: versions, RootFolder: "/data/media/movies"})
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func fill(t *testing.T, lib *library.Service, titleID int64, version int, parsed string) {
	t.Helper()
	d, err := lib.Get(context.Background(), titleID, library.View{Country: "US", Now: now})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := lib.ReplaceFile(context.Background(), titleID, "Folder", library.NewFile{
		VersionID: d.Versions[version].ID, Path: "/m/x.mkv", Size: 1, ReleaseName: "rel", ParsedRelease: parsed, Score: 1, GrabID: 1,
	}); err != nil {
		t.Fatal(err)
	}
}

func agenda(t *testing.T, lib *library.Service, at time.Time, from, to time.Time) library.Agenda {
	t.Helper()
	a, err := lib.Upcoming(context.Background(), library.View{Country: "US", Now: at}, from, to)
	if err != nil {
		t.Fatal(err)
	}
	return a
}

func TestAMovieEntryShowsWhereEachVersionStandsWithQualityAndLongMissing(t *testing.T) {
	lib, _ := newLibrary(t)
	id := addMovieWith(t, lib, 1, "Heat", usDates(metadata.ReleaseDate{Type: metadata.Digital, Date: day(2026, 10, 10)}),
		library.VersionSpec{Slot: slot.Standard, Profile: "hd-primary"}, library.VersionSpec{Slot: slot.FourK, Profile: "4k-primary"})
	fill(t, lib, id, 0, webdl1080)

	got := agenda(t, lib, now, day(2026, 10, 3), day(2026, 10, 31)).Entries
	if len(got) != 1 {
		t.Fatalf("entries = %+v, want the one digital date", got)
	}
	e := got[0]
	if len(e.Slots) != 2 {
		t.Fatalf("slots = %+v, want a state per Version", e.Slots)
	}
	if s := e.Slots[0]; s.Slot != slot.Standard || s.State != library.EntryImported || s.ParsedRelease != webdl1080 {
		t.Errorf("Standard = %+v, want imported with its Release", s)
	}
	if s := e.Slots[1]; s.Slot != slot.FourK || s.State != library.EntryWanted || s.WantedSince == nil || !s.WantedSince.Equal(now) || s.LongMissing {
		t.Errorf("4K = %+v, want Wanted since it was added, not long missing", s)
	}
	if !e.Released || !e.HasPoster || e.Title != "Heat" {
		t.Errorf("entry = %+v", e)
	}

	// 91 days on, the unfilled Version is Long Missing; the entry (a past one) stays.
	later := now.Add(91 * 24 * time.Hour)
	e = agenda(t, lib, later, day(2026, 10, 3), day(2026, 10, 31)).Entries[0]
	if !e.Slots[1].LongMissing || e.Slots[0].LongMissing {
		t.Errorf("long missing = %v / %v, want only the 4K one", e.Slots[0].LongMissing, e.Slots[1].LongMissing)
	}
}

func TestAMovieNotOutYetIsNotOutAndNamesItsOtherDatesAndWhichMakesItSearchable(t *testing.T) {
	lib, _ := newLibrary(t)
	addMovieWith(t, lib, 1, "Heat", usDates(
		metadata.ReleaseDate{Type: metadata.Theatrical, Date: day(2026, 10, 3)},
		metadata.ReleaseDate{Type: metadata.Digital, Date: day(2026, 10, 25)},
		metadata.ReleaseDate{Type: metadata.Physical, Date: day(2026, 12, 12)},
	))

	got := agenda(t, lib, now, day(2026, 10, 17), day(2026, 11, 16)).Entries
	if len(got) != 1 || got[0].ReleaseType != library.DigitalRelease {
		t.Fatalf("entries = %+v, want only the digital date in the window", got)
	}
	e := got[0]
	if e.Slots[0].State != library.EntryNotOut || e.Released || !e.SearchableFrom.Equal(day(2026, 10, 25)) || !e.Searchable {
		t.Errorf("entry = %+v, want Not out, searchable from 10-25 by this very release", e)
	}
	if len(e.Dates) != 3 || e.Dates[0].Type != library.TheatricalRelease || e.Dates[2].Type != library.PhysicalRelease {
		t.Errorf("dates = %+v, want all three, earliest first", e.Dates)
	}

	// The physical date is no more the one that makes it searchable.
	if p := agenda(t, lib, now, day(2026, 12, 1), day(2026, 12, 31)).Entries; len(p) != 1 || p[0].Searchable {
		t.Errorf("physical = %+v, want it listed but not marked searchable", p)
	}
}

func TestAFilledMoviesPastDatesStayAndItsFutureDatesGo(t *testing.T) {
	lib, _ := newLibrary(t)
	id := addMovieWith(t, lib, 1, "Heat", usDates(
		metadata.ReleaseDate{Type: metadata.Theatrical, Date: day(2026, 10, 1)},
		metadata.ReleaseDate{Type: metadata.Digital, Date: day(2026, 10, 10)},
		metadata.ReleaseDate{Type: metadata.Physical, Date: day(2026, 10, 25)},
	))
	fill(t, lib, id, 0, webdl1080)

	got := agenda(t, lib, now, day(2026, 9, 17), day(2026, 11, 16)).Entries
	if len(got) != 2 || got[0].ReleaseType != library.TheatricalRelease || got[1].ReleaseType != library.DigitalRelease {
		t.Fatalf("entries = %+v, want the two past dates and not the physical one still to come", got)
	}
	if got[1].Slots[0].State != library.EntryImported {
		t.Errorf("state = %s, want imported", got[1].Slots[0].State)
	}
}

func TestAnUnmonitoredMovieIsLeftOut(t *testing.T) {
	lib, _ := newLibrary(t)
	id := addMovieWith(t, lib, 1, "Heat", usDates(metadata.ReleaseDate{Type: metadata.Digital, Date: day(2026, 10, 25)}))
	if err := lib.SetMovieMonitored(context.Background(), id, false); err != nil {
		t.Fatal(err)
	}
	if a := agenda(t, lib, now, day(2026, 10, 1), day(2026, 11, 30)); len(a.Entries) != 0 || len(a.Undated) != 0 {
		t.Errorf("agenda = %+v, want nothing for an unmonitored Movie", a)
	}
}

func nightShowWith(t *testing.T, lib *library.Service, tv metadata.TVDBSeries) int64 {
	t.Helper()
	id, err := lib.AddSeries(context.Background(), nightShow(tv, "HBO"))
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestEpisodeEntriesCarryStateAirTimeMarkersAndOverview(t *testing.T) {
	lib, _ := newLibrary(t)
	id := nightShowWith(t, lib, metadata.TVDBSeries{ID: 5001, AirsTime: "21:00", AirsTimezone: "America/New_York", Episodes: []metadata.Episode{
		{ID: 1, Season: 1, Number: 1, Name: "Dusk", Overview: "The first night.", Aired: aired(2026, 10, 10)},
		{ID: 2, Season: 1, Number: 2, Name: "Midnight", Aired: aired(2026, 10, 16)},
		{ID: 3, Season: 1, Number: 3, Name: "Dawn", Aired: aired(2026, 10, 17)}, // 21:00 in New York: 01:00 UTC on the 18th, after now
		{ID: 4, Season: 1, Number: 4, Name: "Noon", Aired: aired(2026, 10, 24)},
		{ID: 5, Season: 0, Number: 1, Name: "Behind", Aired: aired(2026, 10, 12)},
	}})
	d, _ := lib.Get(context.Background(), id, library.View{Country: "US", Now: now})
	if _, err := lib.ReplaceEpisodeFile(context.Background(), id, "F", newEpisodeFile(d.Versions[0].ID, "/tv/1.mkv", 10), []int64{episodeIDOf(t, lib, id, 1, 1)}); err != nil {
		t.Fatal(err)
	}

	if err := lib.SetEpisodesMonitored(context.Background(), id, []int64{episodeIDOf(t, lib, id, 0, 1)}, true); err != nil { // Specials start unmonitored
		t.Fatal(err)
	}

	got := agenda(t, lib, now, day(2026, 10, 3), day(2026, 10, 31)).Entries
	if len(got) != 5 {
		t.Fatalf("entries = %+v, want the five episodes", got)
	}
	by := map[string]library.UpcomingEntry{}
	for _, e := range got {
		by[e.EpisodeName] = e
	}
	state := func(name string) library.EntryState { return by[name].Slots[0].State }
	if state("Dusk") != library.EntryImported || state("Midnight") != library.EntryWanted || state("Dawn") != library.EntryNotOut || state("Noon") != library.EntryNotOut {
		t.Errorf("states = %s %s %s %s, want imported, Wanted, Not out, Not out", state("Dusk"), state("Midnight"), state("Dawn"), state("Noon"))
	}
	if s := by["Midnight"].Slots[0]; s.WantedSince == nil || !s.WantedSince.Equal(now) {
		t.Errorf("Midnight wanted since %v, want when the Version was added, later than its air time", s.WantedSince)
	}
	if at := by["Dawn"].AirAt; at == nil || !at.Equal(time.Date(2026, 10, 18, 1, 0, 0, 0, time.UTC)) {
		t.Errorf("Dawn airs at %v, want 21:00 New York time", at)
	}
	if e := by["Dusk"]; e.Overview != "The first night." || e.Network != "HBO" || e.Season != 1 || e.Episode != 1 {
		t.Errorf("Dusk = %+v", e)
	}
	markers := func(name string) []library.Marker { return by[name].Markers }
	if m := markers("Dusk"); len(m) != 1 || m[0] != library.SeriesPremiere {
		t.Errorf("Dusk markers = %v", m)
	}
	if m := markers("Noon"); len(m) != 1 || m[0] != library.SeasonFinale {
		t.Errorf("Noon markers = %v", m)
	}
	if m := markers("Behind"); len(m) != 1 || m[0] != library.Special {
		t.Errorf("Behind markers = %v", m)
	}
	if m := markers("Midnight"); len(m) != 0 {
		t.Errorf("Midnight markers = %v", m)
	}
}

func episodeIDOf(t *testing.T, lib *library.Service, titleID int64, season, number int) int64 {
	t.Helper()
	e, ok := episodeAt(t, lib, titleID, season, number, now)
	if !ok {
		t.Fatalf("no S%02dE%02d", season, number)
	}
	return e.ID
}

func TestASeasonPremiereIsMarkedAndAnUnmonitoredEpisodeIsLeftOut(t *testing.T) {
	lib, _ := newLibrary(t)
	id := nightShowWith(t, lib, metadata.TVDBSeries{ID: 5001, Episodes: []metadata.Episode{
		{ID: 1, Season: 1, Number: 1, Name: "One", Aired: aired(2026, 1, 1)},
		{ID: 2, Season: 2, Number: 1, Name: "Two one", Aired: aired(2026, 10, 20)},
		{ID: 3, Season: 2, Number: 2, Name: "Two two", Aired: aired(2026, 10, 20)},
	}})
	if err := lib.SetEpisodesMonitored(context.Background(), id, []int64{episodeIDOf(t, lib, id, 2, 2)}, false); err != nil {
		t.Fatal(err)
	}
	got := agenda(t, lib, now, day(2026, 10, 17), day(2026, 11, 16)).Entries
	if len(got) != 1 || got[0].EpisodeName != "Two one" {
		t.Fatalf("entries = %+v, want only the monitored episode", got)
	}
	if m := got[0].Markers; len(m) != 1 || m[0] != library.SeasonPremiere {
		t.Errorf("markers = %v, want a season premiere", m)
	}
	if got[0].AirAt != nil {
		t.Errorf("air at = %v, want none without an air time", got[0].AirAt)
	}
}

func TestTitlesWithSomethingExpectedButNoDateAreListedUndated(t *testing.T) {
	lib, _ := newLibrary(t)
	nightShowWith(t, lib, metadata.TVDBSeries{ID: 5001, Episodes: []metadata.Episode{
		{ID: 1, Season: 1, Number: 1, Name: "One", Aired: aired(2026, 1, 1)},
		{ID: 2, Season: 2, Number: 1, Name: "Two one"},
		{ID: 3, Season: 2, Number: 2, Name: "Two two"},
	}})
	if _, err := lib.AddSeries(context.Background(), library.AddSeries{
		TMDB: metadata.SeriesDetails{TMDBID: 2, TVDBID: 2, Title: "Announced", OriginalTitle: "Announced", OriginalLanguage: "en"},
		TVDB: metadata.TVDBSeries{ID: 2, Status: "upcoming"}, PrimaryLanguage: "en", Monitor: library.MonitorAll, RootFolder: "/tv",
		Versions: []library.VersionSpec{{Slot: slot.Standard, Profile: "hd-primary"}},
	}); err != nil {
		t.Fatal(err)
	}
	addMovieWith(t, lib, 9, "Mystery", nil)
	addMovieWith(t, lib, 10, "Dated", usDates(metadata.ReleaseDate{Type: metadata.Digital, Date: day(2026, 10, 25)}))

	got := agenda(t, lib, now, day(2030, 1, 1), day(2030, 1, 2)).Undated // the window does not matter
	reasons := map[string]library.UndatedEntry{}
	for _, u := range got {
		reasons[u.Title] = u
	}
	if len(got) != 3 {
		t.Fatalf("undated = %+v, want the Series with undated episodes, the announced one and the Movie", got)
	}
	if u := reasons["Night Show"]; u.Reason != library.NoAirDate || u.Episodes != 2 || u.Network != "HBO" || u.Slots[0].State != library.EntryNotOut {
		t.Errorf("Night Show = %+v", u)
	}
	if u := reasons["Announced"]; u.Reason != library.Announced || u.Kind != library.Series {
		t.Errorf("Announced = %+v", u)
	}
	if u := reasons["Mystery"]; u.Reason != library.NoReleaseDate || u.Kind != library.Movie {
		t.Errorf("Mystery = %+v", u)
	}
}
