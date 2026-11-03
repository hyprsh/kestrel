package library_test

import (
	"context"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/slot"
	"github.com/hyprsh/kestrel/internal/store"
	"github.com/hyprsh/kestrel/internal/store/storetest"
)

// bigLibrary adds 4,000 Titles, a Series to three Movies, each Series with 3 Seasons of 10 episodes. It returns the Library
// and the id of one Series.
func bigLibrary(b *testing.B) (*library.Service, int64) {
	b.Helper()
	ctx := context.Background()
	st, err := store.Open(ctx, store.Options{Dir: storetest.Dir(b)})
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { st.Close() })
	lib := library.New(st, func() time.Time { return now }).WithCountry(func(context.Context) string { return "US" })
	versions := []library.VersionSpec{{Slot: slot.Standard, Profile: "hd-primary"}}
	var one int64
	for i := 0; i < 4000; i++ {
		if i%4 != 0 {
			d := paddington()
			d.TMDBID = 100000 + i
			d.ReleaseDates = metadata.ReleaseDates{{Country: "US", Type: metadata.Digital, Date: now.Add(-time.Duration(i%90) * 24 * time.Hour)}}
			if _, err := lib.AddMovie(ctx, library.AddMovie{Details: d, PrimaryLanguage: "en", RootFolder: "/m", Versions: versions}); err != nil {
				b.Fatal(err)
			}
			continue
		}
		d, v := show()
		d.TMDBID, d.TVDBID, v.ID = 200000+i, 300000+i, 300000+i
		v.Episodes = nil
		for s := 1; s <= 3; s++ {
			for n := 1; n <= 10; n++ {
				v.Episodes = append(v.Episodes, metadata.Episode{ID: 1_000_000 + i*100 + s*10 + n, Season: s, Number: n, Name: "Episode", Aired: aired(2026, time.Month(s), n)})
			}
		}
		id, err := lib.AddSeries(ctx, library.AddSeries{TMDB: d, TVDB: v, PrimaryLanguage: "en", Monitor: library.MonitorAll, RootFolder: "/tv", Versions: versions})
		if err != nil {
			b.Fatal(err)
		}
		one = id
	}
	return lib, one
}

// BenchmarkNextSearches reads the next search of one Title of 4,000 (what a Title page does), against the sweep's read of
// the whole Library (what the same call cost before it was scoped to the Title).
func BenchmarkNextSearches(b *testing.B) {
	ctx := context.Background()
	lib, id := bigLibrary(b)
	b.Run("one Title", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			if _, err := lib.NextSearches(ctx, id); err != nil {
				b.Fatal(err)
			}
		}
	})
	b.Run("whole Library (the sweep)", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			if _, err := lib.DueMissing(ctx, now); err != nil {
				b.Fatal(err)
			}
		}
	})
}
