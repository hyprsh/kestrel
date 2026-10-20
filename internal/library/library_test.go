package library_test

import (
	"context"
	"errors"
	"github.com/hyprsh/kestrel/internal/slot"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/store"
	"github.com/hyprsh/kestrel/internal/store/storetest"
)

var now = time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)

func day(y int, m time.Month, d int) time.Time { return time.Date(y, m, d, 0, 0, 0, 0, time.UTC) }

func newLibrary(t *testing.T) (*library.Service, *store.Store) {
	t.Helper()
	st, err := store.Open(context.Background(), store.Options{Dir: storetest.Dir(t)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return library.New(st, func() time.Time { return now }), st
}

// paddington is a Movie released in January 2015 with German and French names.
func paddington() metadata.MovieDetails {
	return metadata.MovieDetails{
		TMDBID: 116149, IMDbID: "tt1109624", Title: "Paddington", OriginalTitle: "Paddington", OriginalLanguage: "en",
		Year: 2014, Runtime: 95, Overview: "A bear in London.", PosterPath: "/p.jpg",
		ReleaseDates: metadata.ReleaseDates{
			{Country: "US", Type: metadata.Theatrical, Date: day(2015, 1, 16), Certification: "PG"},
			{Country: "DE", Type: metadata.Theatrical, Date: day(2015, 1, 22), Certification: "0"},
		},
		Aliases:      []metadata.Alias{{Country: "FR", Title: "Paddington, l'ours"}},
		Translations: []metadata.Translation{{Language: "de", Country: "DE", Title: "Ein Bär namens Paddington"}},
	}
}

func addPaddington(t *testing.T, lib *library.Service, versions ...library.VersionSpec) int64 {
	t.Helper()
	if len(versions) == 0 {
		versions = []library.VersionSpec{{Slot: slot.Standard, Profile: "hd-primary"}}
	}
	id, err := lib.AddMovie(context.Background(), library.AddMovie{
		Details: paddington(), PrimaryLanguage: "de", Versions: versions, RootFolder: "/data/media/movies",
	})
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestAMovieIsAddedWithItsVersionsAndReadBack(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t)
	id := addPaddington(t, lib,
		library.VersionSpec{Slot: slot.Standard, Profile: "any-primary"},
		library.VersionSpec{Slot: slot.FourK, Profile: "4k-primary"})

	d, err := lib.Get(ctx, id, library.View{Country: "DE", Now: now})
	if err != nil {
		t.Fatal(err)
	}
	if d.Kind != library.Movie || d.TMDBID != 116149 || d.IMDbID != "tt1109624" || d.Title != "Paddington" ||
		d.PrimaryTitle != "Ein Bär namens Paddington" || d.OriginalLanguage != "en" || d.Year != 2014 || d.Runtime != 95 ||
		d.RootFolder != "/data/media/movies" || !d.Monitored || d.AddedAt != now {
		t.Errorf("detail = %+v", d)
	}
	if len(d.Versions) != 2 {
		t.Fatalf("versions = %+v", d.Versions)
	}
	hd, uhd := d.Versions[0], d.Versions[1]
	if hd.Slot != slot.Standard || hd.Profile != "any-primary" || hd.State != library.Wanted || hd.File != nil ||
		uhd.Slot != slot.FourK || uhd.Profile != "4k-primary" {
		t.Errorf("versions = %+v", d.Versions)
	}
	if len(d.Aliases) != 2 {
		t.Errorf("aliases = %+v, want the alternative title and the translation", d.Aliases)
	}
	if got, ok := d.ReleaseDates.Date(metadata.Theatrical, "DE"); !ok || !got.Equal(day(2015, 1, 22)) {
		t.Errorf("stored release dates lost: %v %v", got, ok)
	}
}

func TestThePrimaryTitleIsTheEnglishOneWhenThereIsNoTranslation(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t)
	id, err := lib.AddMovie(ctx, library.AddMovie{
		Details: paddington(), PrimaryLanguage: "fr", RootFolder: "/m",
		Versions: []library.VersionSpec{{Slot: slot.Standard, Profile: "hd-primary"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	d, _ := lib.Get(ctx, id, library.View{Country: "FR", Now: now})
	if d.PrimaryTitle != "Paddington" {
		t.Errorf("primary title = %q", d.PrimaryTitle)
	}
}

func TestAddingTheSameMovieTwiceNamesTheExistingTitle(t *testing.T) {
	lib, _ := newLibrary(t)
	id := addPaddington(t, lib)
	_, err := lib.AddMovie(context.Background(), library.AddMovie{
		Details: paddington(), PrimaryLanguage: "de", RootFolder: "/m",
		Versions: []library.VersionSpec{{Slot: slot.Standard, Profile: "hd-primary"}},
	})
	var exists *library.ExistsError
	if !errors.As(err, &exists) || exists.ID != id {
		t.Errorf("err = %v, want ExistsError for %d", err, id)
	}
}

func TestAMovieNeedsAtLeastOneVersionAndOneVersionPerSlot(t *testing.T) {
	lib, _ := newLibrary(t)
	add := func(v ...library.VersionSpec) error {
		_, err := lib.AddMovie(context.Background(), library.AddMovie{Details: paddington(), PrimaryLanguage: "de", RootFolder: "/m", Versions: v})
		return err
	}
	if err := add(); !errors.Is(err, library.ErrNoVersions) {
		t.Errorf("no versions: %v", err)
	}
	if err := add(library.VersionSpec{Slot: slot.Standard, Profile: "hd-primary"}, library.VersionSpec{Slot: slot.Standard, Profile: "any-primary"}); !errors.Is(err, library.ErrDuplicateSlot) {
		t.Errorf("two HD versions: %v", err)
	}
	if err := add(library.VersionSpec{Slot: slot.Standard, Profile: "no-such-profile"}); err == nil {
		t.Error("an unknown Profile was accepted")
	}
	// A failed add leaves nothing behind.
	rows, _ := lib.List(context.Background(), library.View{Country: "DE", Now: now}, library.Filter{})
	if len(rows) != 0 {
		t.Errorf("failed adds left %d titles", len(rows))
	}
}

func TestTheListShowsOneDotPerSlotWithItsState(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t)
	id := addPaddington(t, lib, library.VersionSpec{Slot: slot.Standard, Profile: "hd-primary"}, library.VersionSpec{Slot: slot.FourK, Profile: "4k-primary"})

	rows, err := lib.List(ctx, library.View{Country: "DE", Now: now}, library.Filter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("rows = %+v", rows)
	}
	r := rows[0]
	if r.ID != id || r.Kind != library.Movie || r.Title != "Paddington" || r.PrimaryTitle != "Ein Bär namens Paddington" || r.Year != 2014 {
		t.Errorf("row = %+v", r)
	}
	if r.Slots[slot.Standard] == nil || r.Slots[slot.Standard].State != library.Wanted || r.Slots[slot.Standard].Profile != "hd-primary" ||
		r.Slots[slot.FourK] == nil || r.Slots[slot.FourK].State != library.Wanted || r.Slots[slot.FourK].Profile != "4k-primary" {
		t.Errorf("slots = %+v %+v", r.Slots[slot.Standard], r.Slots[slot.FourK])
	}
}

func TestAMovieWithOnlyATheatricalDateIsUnreleasedUntil90DaysAfterItInTheCountry(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t)
	addPaddington(t, lib)
	state := func(at time.Time, country string) library.State {
		t.Helper()
		rows, err := lib.List(ctx, library.View{Country: country, Now: at}, library.Filter{})
		if err != nil {
			t.Fatal(err)
		}
		return rows[0].Slots[slot.Standard].State
	}
	if got := state(day(2015, 4, 17), "US"); got != library.Wanted {
		t.Errorf("US the day after release = %v", got)
	}
	if got := state(day(2015, 4, 17), "DE"); got != library.Unreleased {
		t.Errorf("DE before its own release = %v", got)
	}
	if got := state(day(2015, 4, 22), "DE"); got != library.Wanted {
		t.Errorf("DE on release day = %v", got)
	}
}

func TestLongMissingStartsNinetyDaysAfterWantedSince(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t) // added "now", long after the 2015 release
	addPaddington(t, lib)
	flag := func(at time.Time) bool {
		rows, _ := lib.List(ctx, library.View{Country: "US", Now: at}, library.Filter{})
		return rows[0].Slots[slot.Standard].LongMissing
	}
	// Wanted since is the later of release and being added: the add moment.
	if flag(now.Add(89 * 24 * time.Hour)) {
		t.Error("long missing after 89 days")
	}
	if !flag(now.Add(91 * 24 * time.Hour)) {
		t.Error("not long missing after 91 days")
	}
	rows, _ := lib.List(ctx, library.View{Country: "US", Now: now}, library.Filter{})
	if rows[0].WantedSince == nil || !rows[0].WantedSince.Equal(now) {
		t.Errorf("wanted since = %v, want the add moment", rows[0].WantedSince)
	}
}

func TestTheListFiltersByKindAndText(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t)
	addPaddington(t, lib)
	view := library.View{Country: "US", Now: now}
	for _, c := range []struct {
		f    library.Filter
		want int
	}{
		{library.Filter{Text: "paddi"}, 1},
		{library.Filter{Text: "BÄR"}, 1}, // the Primary-Language title
		{library.Filter{Text: "l'ours"}, 1},
		{library.Filter{Text: "casablanca"}, 0},
		{library.Filter{Kind: library.Movie}, 1},
		{library.Filter{Kind: library.Series}, 0},
	} {
		rows, err := lib.List(ctx, view, c.f)
		if err != nil || len(rows) != c.want {
			t.Errorf("%+v = %d rows, %v; want %d", c.f, len(rows), err, c.want)
		}
	}
}

func TestInLibraryMapsTMDBIDsToTitles(t *testing.T) {
	lib, _ := newLibrary(t)
	id := addPaddington(t, lib)
	got, err := lib.InLibrary(context.Background(), library.Movie, []int{116149, 1})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[116149] != id {
		t.Errorf("InLibrary = %v", got)
	}
	if other, _ := lib.InLibrary(context.Background(), library.Series, []int{116149}); len(other) != 0 {
		t.Errorf("a Series with the same TMDB id is another Title: %v", other)
	}
}

func TestAVersionNamesItsTitle(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t)
	id := addPaddington(t, lib)
	d, err := lib.Get(ctx, id, library.View{Now: now})
	if err != nil {
		t.Fatal(err)
	}

	got, err := lib.TitleOfVersion(ctx, d.Versions[0].ID)
	if err != nil || got != id {
		t.Errorf("TitleOfVersion = %d, %v; want %d", got, err, id)
	}
	if _, err := lib.TitleOfVersion(ctx, 999); !errors.Is(err, library.ErrNotFound) {
		t.Errorf("unknown Version: err = %v, want ErrNotFound", err)
	}
}

func TestGettingAnUnknownTitleIsNotFound(t *testing.T) {
	lib, _ := newLibrary(t)
	if _, err := lib.Get(context.Background(), 99, library.View{Now: now}); !errors.Is(err, library.ErrNotFound) {
		t.Errorf("err = %v", err)
	}
}
