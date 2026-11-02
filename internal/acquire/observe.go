package acquire

import (
	"context"
	"fmt"
	"slices"
	"strings"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/slot"
)

// Target is what a search is looking for now, for the search status.
type Target struct {
	TitleID int64
	Title   string
	// HasPoster says the Title has a poster to show.
	HasPoster bool
	// Slot is the Slots searched, "Standard" or "Standard, 4K".
	Slot string
	// Season is set when the search covers one season of a Series.
	Season *int
	// Episodes are the Wanted episodes searched, as "S05E01" codes, at most maxTargetEpisodes.
	Episodes []string
}

// maxTargetEpisodes keeps the status small when a whole Series is searched.
const maxTargetEpisodes = 50

// Observer hears how a search goes, for the search status. The Search loop
// hands one in with WithObserver; a search made by hand has none.
type Observer interface {
	// Searching says which Title, Slots and episodes the search is for.
	Searching(t Target)
	// Releases says how many Releases the indexers returned and were evaluated.
	Releases(n int)
}

type observerKey struct{}

// WithObserver returns ctx with an Observer that the searches made under it report to.
func WithObserver(ctx context.Context, o Observer) context.Context {
	return context.WithValue(ctx, observerKey{}, o)
}

// ObserverOf is the Observer under ctx, or one that hears nothing.
func ObserverOf(ctx context.Context) Observer {
	if o, ok := ctx.Value(observerKey{}).(Observer); ok {
		return o
	}
	return nopObserver{}
}

type nopObserver struct{}

func (nopObserver) Searching(Target) {}
func (nopObserver) Releases(int)     {}

// targetOf names what a search of in is for.
func targetOf(d library.Detail, in Input, stored []slot.Record) Target {
	t := Target{TitleID: d.ID, Title: d.Title, HasPoster: d.PosterPath != ""}
	var slots []string
	seasons := map[int]bool{}
	for _, v := range in.Versions {
		slots = append(slots, slot.Label(stored, v.Slot))
		for _, u := range v.Units {
			if u.Ref == (EpisodeRef{}) {
				continue
			}
			seasons[u.Ref.Season] = true
			code := fmt.Sprintf("S%02dE%02d", u.Ref.Season, u.Ref.Episode)
			if !slices.Contains(t.Episodes, code) && len(t.Episodes) < maxTargetEpisodes {
				t.Episodes = append(t.Episodes, code)
			}
		}
	}
	t.Slot = strings.Join(slots, ", ")
	if len(seasons) == 1 {
		for n := range seasons {
			t.Season = &n
		}
	}
	return t
}

// storedSlots are the Slots the Log and the Activity name by label; none when
// they cannot be read, which leaves the ids to name them.
func (s *Service) storedSlots(ctx context.Context) []slot.Record {
	if s.slots == nil {
		return nil
	}
	all, err := s.slots.List(ctx)
	if err != nil {
		return nil
	}
	return all
}
