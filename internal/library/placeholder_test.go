package library_test

import (
	"context"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/slot"
)

// fourEpisodes is a Series whose season 2 TheTVDB lists up to S02E04, all aired.
func fourEpisodes(t *testing.T, lib *library.Service) (int64, int64) {
	t.Helper()
	return addEpisodes(t, lib,
		metadata.Episode{ID: 11, Season: 1, Number: 1, Name: "One", Aired: aired(2026, 1, 1)},
		metadata.Episode{ID: 21, Season: 2, Number: 1, Name: "Two one", Aired: aired(2026, 9, 1)},
		metadata.Episode{ID: 22, Season: 2, Number: 2, Name: "Two two", Aired: aired(2026, 9, 8)},
		metadata.Episode{ID: 23, Season: 2, Number: 3, Name: "Two three", Aired: aired(2026, 9, 15)},
		metadata.Episode{ID: 24, Season: 2, Number: 4, Name: "Two four", Aired: aired(2026, 9, 22)},
	)
}

// episodeAt is the episode at season and number, if the Series has one.
func episodeAt(t *testing.T, lib *library.Service, id int64, season, number int, at time.Time) (library.Episode, bool) {
	t.Helper()
	eps, err := lib.Episodes(context.Background(), id, library.View{Country: "US", Now: at})
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range eps {
		if e.Season == season && e.Number == number {
			return e, true
		}
	}
	return library.Episode{}, false
}

func addPlaceholder(t *testing.T, lib *library.Service, id int64, season, number int) library.Episode {
	t.Helper()
	if err := lib.AddPlaceholders(context.Background(), id, []library.EpisodeRef{{Season: season, Number: number}}); err != nil {
		t.Fatal(err)
	}
	ep, ok := episodeAt(t, lib, id, season, number, now.Add(24*hours))
	if !ok {
		t.Fatalf("no S%02dE%02d", season, number)
	}
	return ep
}

func TestAPlaceholderEpisodeIsMonitoredAndWantedFromItsCreation(t *testing.T) {
	lib, clock, _ := clocked(t)
	id, ver := fourEpisodes(t, lib)
	for _, name := range []string{"One", "Two one", "Two two", "Two three", "Two four"} {
		fileFor(t, lib, id, ver, name, now, "/tv/"+name+".mkv")
	}
	if v := versionState(t, lib, id, now); v.State != library.Filled {
		t.Fatalf("before = %s", v.State)
	}

	*clock = now.Add(2 * hours)
	ep := addPlaceholder(t, lib, id, 2, 5)
	if !ep.Placeholder || !ep.Monitored || ep.Name != "" || ep.AirDate != nil {
		t.Fatalf("placeholder = %+v", ep)
	}
	if ep.Released == nil || !ep.Released.Equal(*clock) {
		t.Fatalf("released = %v, want its creation %v", ep.Released, *clock)
	}
	if c := ep.Cells[slot.Standard]; c.State != library.Wanted {
		t.Fatalf("cell = %s", c.State)
	}
	v := versionState(t, lib, id, *clock)
	if v.State != library.Wanted || v.WantedSince == nil || !v.WantedSince.Equal(*clock) {
		t.Fatalf("version = %s since %v", v.State, v.WantedSince)
	}

	// Adding it again keeps the one there is.
	if err := lib.AddPlaceholders(context.Background(), id, []library.EpisodeRef{{Season: 2, Number: 5}}); err != nil {
		t.Fatal(err)
	}
	if again, _ := episodeAt(t, lib, id, 2, 5, now); again.ID != ep.ID {
		t.Fatalf("id %d, then %d", ep.ID, again.ID)
	}
	if listed, _ := episodeAt(t, lib, id, 2, 4, now); listed.Placeholder {
		t.Fatal("a listed episode is no placeholder")
	}
}

func TestTheWantedSweepSearchesAPlaceholderEpisodeWithNoFile(t *testing.T) {
	ctx := context.Background()
	lib, clock, _ := clocked(t)
	id, ver := fourEpisodes(t, lib)
	for _, name := range []string{"One", "Two one", "Two two", "Two three", "Two four"} {
		fileFor(t, lib, id, ver, name, now, "/tv/"+name+".mkv")
	}
	if err := lib.MarkMissingSearched(ctx, ver, now, false); err != nil {
		t.Fatal(err)
	}
	if got := due(t, lib, now.Add(30*24*hours)); len(got) != 0 {
		t.Fatalf("due with everything filled: %+v", got)
	}
	*clock = now.Add(hours)
	addPlaceholder(t, lib, id, 2, 5) // its Grab failed: no file
	got := due(t, lib, clock.Add(24*hours))
	if len(got) != 1 || got[0].VersionID != ver {
		t.Fatalf("due a day after the placeholder = %+v", got)
	}
}

func TestAPlaceholderEpisodeReleasesTheUndatedEpisodesBeforeIt(t *testing.T) {
	lib, clock, _ := clocked(t)
	id, _ := addEpisodes(t, lib,
		metadata.Episode{ID: 1, Season: 1, Number: 1, Name: "Aired", Aired: aired(2026, 1, 1)},
		metadata.Episode{ID: 2, Season: 1, Number: 2, Name: "Undated"},
	)
	if c := episodeNamed(t, lib, id, "Undated", now).Cells[slot.Standard]; c.State != library.Unreleased {
		t.Fatalf("before = %s", c.State)
	}
	*clock = now.Add(hours)
	addPlaceholder(t, lib, id, 1, 3)
	ep := episodeNamed(t, lib, id, "Undated", *clock)
	if ep.Cells[slot.Standard].State != library.Wanted || ep.Released == nil || !ep.Released.Equal(*clock) {
		t.Fatalf("undated = %s, released %v", ep.Cells[slot.Standard].State, ep.Released)
	}
}

func TestAPlaceholderEpisodeNeedsASeasonTheSeriesHas(t *testing.T) {
	lib, _ := newLibrary(t)
	id, _ := fourEpisodes(t, lib)
	err := lib.AddPlaceholders(context.Background(), id, []library.EpisodeRef{{Season: 3, Number: 1}})
	if _, ok := err.(*library.UnknownSeasonError); !ok {
		t.Fatalf("err = %v", err)
	}
	if _, ok := episodeAt(t, lib, id, 3, 1, now); ok {
		t.Fatal("added to an unknown season")
	}
}

// listedFour are fourEpisodes' episodes as TheTVDB lists them, plus more.
func listedFour(more ...metadata.Episode) []metadata.Episode {
	return append([]metadata.Episode{
		{ID: 11, Season: 1, Number: 1, Name: "One", Aired: aired(2026, 1, 1)},
		{ID: 21, Season: 2, Number: 1, Name: "Two one", Aired: aired(2026, 9, 1)},
		{ID: 22, Season: 2, Number: 2, Name: "Two two", Aired: aired(2026, 9, 8)},
		{ID: 23, Season: 2, Number: 3, Name: "Two three", Aired: aired(2026, 9, 15)},
		{ID: 24, Season: 2, Number: 4, Name: "Two four", Aired: aired(2026, 9, 22)},
	}, more...)
}

func refreshWith(t *testing.T, lib *library.Service, id int64, eps []metadata.Episode) library.Refreshed {
	t.Helper()
	d, _ := show()
	res, err := lib.RefreshSeries(context.Background(), id, library.SeriesRefresh{
		TMDB: d, TVDB: metadata.TVDBSeries{ID: 81189, Name: "Breaking Bad", Episodes: eps}, PrimaryLanguage: "en",
	})
	if err != nil {
		t.Fatal(err)
	}
	return res
}

// pathsOf are the paths of the files a Version holds.
func pathsOf(t *testing.T, lib *library.Service, version int64) []string {
	t.Helper()
	fs, err := lib.FilesOfVersion(context.Background(), version)
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, f := range fs {
		out = append(out, f.Path)
	}
	return out
}

func TestARefreshAdoptsAPlaceholderEpisodeTheTVDBNowLists(t *testing.T) {
	lib, _ := newLibrary(t)
	id, ver := fourEpisodes(t, lib)
	p := addPlaceholder(t, lib, id, 2, 5)
	if _, err := lib.ReplaceEpisodeFile(context.Background(), id, "F", newEpisodeFile(ver, "/tv/S02E05.mkv", 10), []int64{p.ID}); err != nil {
		t.Fatal(err)
	}

	res := refreshWith(t, lib, id, listedFour(metadata.Episode{ID: 25, Season: 2, Number: 5, Name: "Two five", Aired: aired(2026, 9, 29)}))
	if res.Renamed {
		t.Error("an adoption must not rename")
	}
	ep, _ := episodeAt(t, lib, id, 2, 5, now)
	if ep.ID != p.ID || ep.Placeholder || ep.Name != "Two five" || !sameDay(ep.AirDate, 2026, 9, 29) {
		t.Fatalf("adopted = %+v", ep)
	}
	c := ep.Cells[slot.Standard]
	if c.State != library.Filled || c.File == nil || c.File.Path != "/tv/S02E05.mkv" {
		t.Fatalf("cell = %+v", c)
	}
	// The next refresh, where TheTVDB knows its id, matches it by that.
	refreshWith(t, lib, id, listedFour(metadata.Episode{ID: 25, Season: 2, Number: 5, Name: "Two five", Aired: aired(2026, 9, 29)}))
	if again, _ := episodeAt(t, lib, id, 2, 5, now); again.ID != p.ID {
		t.Fatalf("id %d, then %d", p.ID, again.ID)
	}
}

func TestAListedEpisodeMovedOntoAPlaceholderEpisodeTakesItsFilesWhereItHasNone(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t)
	d, _ := show()
	id, err := lib.AddSeries(ctx, library.AddSeries{
		TMDB: d, TVDB: metadata.TVDBSeries{ID: 81189, Name: "Breaking Bad", Episodes: listedFour()}, PrimaryLanguage: "en",
		Monitor: library.MonitorAll, RootFolder: "/tv",
		Versions: []library.VersionSpec{{Slot: slot.Standard, Profile: "hd-primary"}, {Slot: slot.FourK, Profile: "4k-primary"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	dt, _ := lib.Get(ctx, id, library.View{Country: "US", Now: now})
	std, uhd := dt.Versions[0].ID, dt.Versions[1].ID
	p := addPlaceholder(t, lib, id, 2, 5)
	four, _ := episodeAt(t, lib, id, 2, 4, now)
	// Standard: only the placeholder holds a file. 4K: both do.
	for _, f := range []struct {
		version int64
		path    string
		ep      int64
	}{{std, "/tv/std-p.mkv", p.ID}, {uhd, "/tv/4k-p.mkv", p.ID}, {uhd, "/tv/4k-four.mkv", four.ID}} {
		if _, err := lib.ReplaceEpisodeFile(ctx, id, "F", newEpisodeFile(f.version, f.path, 10), []int64{f.ep}); err != nil {
			t.Fatal(err)
		}
	}

	// TheTVDB moves S02E04 (id 24) to S02E05 and lists a new S02E04.
	moved := listedFour()[:4]
	moved = append(moved,
		metadata.Episode{ID: 26, Season: 2, Number: 4, Name: "New four", Aired: aired(2026, 9, 22)},
		metadata.Episode{ID: 24, Season: 2, Number: 5, Name: "Two four, now five", Aired: aired(2026, 9, 29)},
	)
	refreshWith(t, lib, id, moved)

	eps, _ := lib.Episodes(ctx, id, library.View{Country: "US", Now: now})
	if len(eps) != 6 {
		t.Fatalf("episodes = %+v", eps)
	}
	for _, e := range eps {
		if e.Placeholder {
			t.Fatalf("the placeholder stayed: %+v", e)
		}
	}
	five, _ := episodeAt(t, lib, id, 2, 5, now)
	if five.ID != four.ID {
		t.Fatalf("S02E05 = %+v, want the listed episode %d", five, four.ID)
	}
	if c := five.Cells[slot.Standard]; c.File == nil || c.File.Path != "/tv/std-p.mkv" {
		t.Errorf("standard = %+v, want the placeholder's file", c.File)
	}
	if c := five.Cells[slot.FourK]; c.File == nil || c.File.Path != "/tv/4k-four.mkv" {
		t.Errorf("4K = %+v, want its own file", c.File)
	}
	if got := pathsOf(t, lib, uhd); len(got) != 1 || got[0] != "/tv/4k-four.mkv" {
		t.Errorf("4K holds %v; the placeholder's file is left Unmanaged", got)
	}
}

func TestARefreshRemovesPlaceholderEpisodesWithNoFileThatNoGrabIsFetching(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t)
	id, ver := fourEpisodes(t, lib)
	withFile := addPlaceholder(t, lib, id, 2, 5)
	fetching := addPlaceholder(t, lib, id, 2, 6)
	stray := addPlaceholder(t, lib, id, 1, 3)
	if _, err := lib.ReplaceEpisodeFile(ctx, id, "F", newEpisodeFile(ver, "/tv/S02E05.mkv", 10), []int64{withFile.ID}); err != nil {
		t.Fatal(err)
	}

	d, _ := show()
	if _, err := lib.RefreshSeries(ctx, id, library.SeriesRefresh{
		TMDB: d, TVDB: metadata.TVDBSeries{ID: 81189, Name: "Breaking Bad", Episodes: listedFour()}, PrimaryLanguage: "en",
		Fetching: map[int64]bool{fetching.ID: true},
	}); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		name string
		ep   library.Episode
		kept bool
	}{{"with a file", withFile, true}, {"being fetched", fetching, true}, {"with nothing", stray, false}} {
		_, ok := episodeAt(t, lib, id, c.ep.Season, c.ep.Number, now)
		if ok != c.kept {
			t.Errorf("%s: kept = %v", c.name, ok)
		}
	}
}

func TestWhichUnlistedEpisodesQualifyForAPlaceholderEpisode(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t)
	id, _ := fourEpisodes(t, lib)
	addPlaceholder(t, lib, id, 2, 5)
	d, _ := lib.Get(ctx, id, library.View{Country: "US", Now: now})
	eps, _ := lib.Episodes(ctx, id, library.View{Country: "US", Now: now})

	for _, c := range []struct {
		name    string
		season  int
		numbers []int
		refs    []library.EpisodeRef
		want    library.Unlisted
	}{
		{"listed and placeholder episodes are not unlisted", 2, []int{4, 5}, nil, library.Qualifies},
		{"two past the last listed episode", 2, []int{6}, []library.EpisodeRef{{Season: 2, Number: 6}}, library.Qualifies},
		{"the limit counts from listed episodes only", 2, []int{7}, []library.EpisodeRef{{Season: 2, Number: 7}}, library.EpisodeNotListed},
		{"every unlisted one must qualify", 2, []int{4, 6, 7}, []library.EpisodeRef{{Season: 2, Number: 6}, {Season: 2, Number: 7}}, library.EpisodeNotListed},
		{"a gap before the last listed episode", 1, []int{0}, []library.EpisodeRef{{Season: 1, Number: 0}}, library.EpisodeNotListed},
		{"a season TheTVDB does not list", 3, []int{1}, []library.EpisodeRef{{Season: 3, Number: 1}}, library.SeasonNotListed},
	} {
		refs, why := library.UnlistedOf(d, eps, c.season, c.numbers, now)
		if why != c.want || len(refs) != len(c.refs) {
			t.Errorf("%s: %v, %v; want %v, %v", c.name, refs, why, c.refs, c.want)
			continue
		}
		for i := range refs {
			if refs[i] != c.refs[i] {
				t.Errorf("%s: refs %v, want %v", c.name, refs, c.refs)
			}
		}
	}

	// An unmonitored season, or a mode that monitors nothing new, does not qualify.
	if err := lib.SetSeasonMonitored(ctx, id, 1, false); err != nil {
		t.Fatal(err)
	}
	d, _ = lib.Get(ctx, id, library.View{Country: "US", Now: now})
	if _, why := library.UnlistedOf(d, eps, 1, []int{2}, now); why != library.EpisodeNotListed {
		t.Errorf("unmonitored season: %v", why)
	}
	d.SeriesMonitor = library.MonitorNone
	if _, why := library.UnlistedOf(d, eps, 2, []int{6}, now); why != library.EpisodeNotListed {
		t.Errorf("mode none: %v", why)
	}
}
