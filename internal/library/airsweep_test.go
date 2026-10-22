package library_test

import (
	"context"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/metadata"
)

// An episode airs at its air time in the network's zone; without one it airs
// at the start of its air date (midnight UTC).
func TestAnEpisodeIsReleasedAtItsAirTimeInTheNetworksZone(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t)
	// 2026-10-20 21:00 in New York (EDT, UTC-4) is 2026-10-21 01:00 UTC.
	id, err := lib.AddSeries(ctx, nightShow(metadata.TVDBSeries{ID: 5001, AirsTime: "21:00", AirsTimezone: "America/New_York", Episodes: []metadata.Episode{
		{ID: 1, Season: 1, Number: 1, Name: "Dusk", Aired: aired(2026, 10, 20)},
	}}, "HBO"))
	if err != nil {
		t.Fatal(err)
	}
	ep, _ := episodeAt(t, lib, id, 1, 1, now)
	want := time.Date(2026, 10, 21, 1, 0, 0, 0, time.UTC)
	if ep.Released == nil || !ep.Released.Equal(want) {
		t.Errorf("released = %v, want %v", ep.Released, want)
	}
	if ep.AirDate == nil || !ep.AirDate.Equal(day(2026, 10, 20)) {
		t.Errorf("air date = %v, want the date as TheTVDB gives it", ep.AirDate)
	}
}

func TestAnEpisodeWithoutAnAirTimeIsReleasedAtTheStartOfItsDay(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t)
	id, err := lib.AddSeries(ctx, nightShow(metadata.TVDBSeries{ID: 5001, Episodes: []metadata.Episode{
		{ID: 1, Season: 1, Number: 1, Name: "Dusk", Aired: aired(2026, 10, 20)},
	}}, "HBO"))
	if err != nil {
		t.Fatal(err)
	}
	ep, _ := episodeAt(t, lib, id, 1, 1, now)
	if ep.Released == nil || !ep.Released.Equal(day(2026, 10, 20)) {
		t.Errorf("released = %v, want midnight UTC of the air date", ep.Released)
	}
}

// The search sweep finds an episode Wanted, and so searches it, from its air
// time, not from the start of its day.
func TestTheSearchSweepStartsAtTheAirTimeAndFallsBackToTheStartOfTheDay(t *testing.T) {
	ctx := context.Background()
	for _, c := range []struct {
		name   string
		tv     metadata.TVDBSeries
		before time.Time // the episode airs after this
		after  time.Time // and by this it has aired
	}{
		{"with an air time", metadata.TVDBSeries{ID: 5001, AirsTime: "21:00", AirsTimezone: "America/New_York"},
			time.Date(2026, 10, 21, 0, 59, 0, 0, time.UTC), time.Date(2026, 10, 21, 1, 1, 0, 0, time.UTC)},
		{"without one", metadata.TVDBSeries{ID: 5001},
			time.Date(2026, 10, 19, 23, 59, 0, 0, time.UTC), time.Date(2026, 10, 20, 0, 1, 0, 0, time.UTC)},
	} {
		t.Run(c.name, func(t *testing.T) {
			lib, _, _ := clocked(t)
			c.tv.Episodes = []metadata.Episode{{ID: 1, Season: 1, Number: 1, Name: "Dusk", Aired: aired(2026, 10, 20)}}
			id, err := lib.AddSeries(ctx, nightShow(c.tv, "HBO"))
			if err != nil {
				t.Fatal(err)
			}
			if got := due(t, lib, c.before); len(got) != 0 {
				t.Errorf("due before the air time = %+v, want nothing", got)
			}
			got := due(t, lib, c.after)
			if len(got) != 1 || got[0].TitleID != id || got[0].Episodes != 1 {
				t.Errorf("due after the air time = %+v, want the Series Version with its one Wanted episode", got)
			}
		})
	}
}
