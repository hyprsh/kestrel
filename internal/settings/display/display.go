// Package display holds the household-wide view defaults: the order of a
// Series' seasons, which seasons start open, where Manual search starts its
// sort and the Upcoming filters a new session starts with. Each is a default
// only: a browser or session that picks otherwise keeps its choice.
package display

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"slices"

	"github.com/hyprsh/kestrel/internal/settings"
)

const key = "display"

// The values each setting takes, spelled as in the API and the Config File.
const (
	OldestFirst = "oldest_first"
	NewestFirst = "newest_first"

	LatestAndWanted = "latest_and_wanted"
	AllOpen         = "all"
	NoneOpen        = "none"

	BestFirst = "best_first"

	KindAll    = "all"
	KindMovie  = "movie"
	KindSeries = "series"
)

// Columns are the Manual search columns a sort can name.
var Columns = []string{"score", "release", "quality", "languages", "formats", "size", "age", "indexer"}

// SortValues are the values of manual_search_sort: best first, or a column
// with `_asc` or `_desc` (score descending is best first, so it has no value of its own).
func SortValues() []string {
	out := []string{BestFirst}
	for _, c := range Columns {
		for _, d := range []string{"asc", "desc"} {
			if c == "score" && d == "desc" {
				continue
			}
			out = append(out, c+"_"+d)
		}
	}
	return out
}

// UpcomingFilters are the filters a new session of Upcoming starts with.
type UpcomingFilters struct {
	Kind         string `json:"kind"`
	WantedOnly   bool   `json:"wanted_only"`
	HideImported bool   `json:"hide_imported"`
}

// Display is the four settings (three the UI offers; see SeasonsOpen).
type Display struct {
	SeasonOrder string `json:"season_order"`
	// SeasonsOpen is kept for the Config File and API, which still accept it, but nothing reads it: the Title page has season tabs.
	SeasonsOpen      string          `json:"seasons_open"`
	ManualSearchSort string          `json:"manual_search_sort"`
	UpcomingFilters  UpcomingFilters `json:"upcoming_filters"`
}

// Defaults is what a household that never opens Display gets.
func Defaults() Display {
	return Display{
		SeasonOrder:      OldestFirst,
		SeasonsOpen:      LatestAndWanted,
		ManualSearchSort: BestFirst,
		UpcomingFilters:  UpcomingFilters{Kind: KindAll},
	}
}

// UpcomingPatch changes the named Upcoming filters; nil ones stay.
type UpcomingPatch struct {
	Kind         *string
	WantedOnly   *bool
	HideImported *bool
}

// Patch changes the named settings; nil ones stay.
type Patch struct {
	SeasonOrder      *string
	SeasonsOpen      *string
	ManualSearchSort *string
	Upcoming         *UpcomingPatch
}

// ValidationError is a rejected value. Field is an API field name such as
// display.season_order.
type ValidationError struct {
	Field, Message string
}

func (e *ValidationError) Error() string { return e.Field + ": " + e.Message }

func oneOf(field string, v *string, allowed ...string) error {
	if v == nil || slices.Contains(allowed, *v) {
		return nil
	}
	return &ValidationError{Field: field, Message: fmt.Sprintf("%q is not one of %v", *v, allowed)}
}

// Check applies Set's rules to p without saving it. A rejection is a *ValidationError.
func Check(p Patch) error {
	if err := oneOf("season_order", p.SeasonOrder, OldestFirst, NewestFirst); err != nil {
		return err
	}
	if err := oneOf("seasons_open", p.SeasonsOpen, LatestAndWanted, AllOpen, NoneOpen); err != nil {
		return err
	}
	if err := oneOf("manual_search_sort", p.ManualSearchSort, SortValues()...); err != nil {
		return err
	}
	if u := p.Upcoming; u != nil {
		if err := oneOf("upcoming_filters.kind", u.Kind, KindAll, KindMovie, KindSeries); err != nil {
			return err
		}
	}
	return nil
}

// Apply returns cur with p's named settings changed, after checking them.
func Apply(cur Display, p Patch) (Display, error) {
	if err := Check(p); err != nil {
		return Display{}, err
	}
	d := cur
	set := func(dst *string, v *string) {
		if v != nil {
			*dst = *v
		}
	}
	set(&d.SeasonOrder, p.SeasonOrder)
	set(&d.SeasonsOpen, p.SeasonsOpen)
	set(&d.ManualSearchSort, p.ManualSearchSort)
	if u := p.Upcoming; u != nil {
		set(&d.UpcomingFilters.Kind, u.Kind)
		if u.WantedOnly != nil {
			d.UpcomingFilters.WantedOnly = *u.WantedOnly
		}
		if u.HideImported != nil {
			d.UpcomingFilters.HideImported = *u.HideImported
		}
	}
	return d, nil
}

// Service reads and writes the Display settings.
type Service struct{ settings *settings.Settings }

// New returns a Service over s.
func New(s *settings.Settings) *Service { return &Service{settings: s} }

// InTx returns a Service that saves through tx; the caller commits or rolls back.
func (s *Service) InTx(tx *sql.Tx) *Service { return &Service{settings: s.settings.InTx(tx)} }

// Get returns the settings; one never saved reports its default.
func (s *Service) Get(ctx context.Context) (Display, error) {
	d := Defaults()
	raw, ok, err := s.settings.Get(ctx, key)
	if err != nil || !ok {
		return d, err
	}
	if err := json.Unmarshal(raw, &d); err != nil { // keys the document lacks keep their default
		return Display{}, fmt.Errorf("display: stored %s: %w", key, err)
	}
	return d, nil
}

// Set saves the named settings after checking them. A rejected patch changes nothing.
func (s *Service) Set(ctx context.Context, p Patch) (Display, error) {
	cur, err := s.Get(ctx)
	if err != nil {
		return Display{}, err
	}
	d, err := Apply(cur, p)
	if err != nil {
		return Display{}, err
	}
	raw, err := json.Marshal(d)
	if err != nil {
		return Display{}, err
	}
	if err := s.settings.Put(ctx, key, raw); err != nil {
		return Display{}, err
	}
	return d, nil
}
