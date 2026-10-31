package display_test

import (
	"context"
	"errors"
	"testing"

	"github.com/hyprsh/kestrel/internal/settings"
	"github.com/hyprsh/kestrel/internal/settings/display"
	"github.com/hyprsh/kestrel/internal/store"
	"github.com/hyprsh/kestrel/internal/store/storetest"
)

func newService(t *testing.T) *display.Service {
	t.Helper()
	st, err := store.Open(context.Background(), store.Options{Dir: storetest.Dir(t)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return display.New(settings.New(st))
}

func ptr[T any](v T) *T { return &v }

func TestUnsavedSettingsReportTodaysBehavior(t *testing.T) {
	got, err := newService(t).Get(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	want := display.Display{
		SeasonOrder: "oldest_first", SeasonsOpen: "latest_and_wanted", ManualSearchSort: "best_first",
		UpcomingFilters: display.UpcomingFilters{Kind: "all"},
	}
	if got != want {
		t.Errorf("got %+v, want %+v", got, want)
	}
}

func TestSetChangesOnlyWhatIsNamed(t *testing.T) {
	ctx := context.Background()
	s := newService(t)
	if _, err := s.Set(ctx, display.Patch{SeasonOrder: ptr("newest_first"), Upcoming: &display.UpcomingPatch{WantedOnly: ptr(true)}}); err != nil {
		t.Fatal(err)
	}
	got, err := s.Set(ctx, display.Patch{ManualSearchSort: ptr("size_desc"), Upcoming: &display.UpcomingPatch{Kind: ptr("series")}})
	if err != nil {
		t.Fatal(err)
	}
	want := display.Display{
		SeasonOrder: "newest_first", SeasonsOpen: "latest_and_wanted", ManualSearchSort: "size_desc",
		UpcomingFilters: display.UpcomingFilters{Kind: "series", WantedOnly: true},
	}
	if got != want {
		t.Errorf("got %+v, want %+v", got, want)
	}
	if again, _ := s.Get(ctx); again != want {
		t.Errorf("reloaded %+v, want %+v", again, want)
	}
}

func TestARejectedValueSavesNothing(t *testing.T) {
	ctx := context.Background()
	s := newService(t)
	for _, p := range []display.Patch{
		{SeasonOrder: ptr("sideways")},
		{SeasonsOpen: ptr("some")},
		{ManualSearchSort: ptr("score_desc")}, // that is best first
		{ManualSearchSort: ptr("size")},
		{Upcoming: &display.UpcomingPatch{Kind: ptr("anime")}},
	} {
		p2 := p
		p2.SeasonOrder = ptr("newest_first") // a valid value beside it must not be saved either
		if p.SeasonOrder != nil {
			p2.SeasonOrder = p.SeasonOrder
		}
		_, err := s.Set(ctx, p2)
		var ve *display.ValidationError
		if !errors.As(err, &ve) {
			t.Errorf("%+v: err = %v, want a ValidationError", p, err)
		}
	}
	if got, _ := s.Get(ctx); got.SeasonOrder != "oldest_first" {
		t.Errorf("season_order = %s after rejected patches, want oldest_first", got.SeasonOrder)
	}
}
