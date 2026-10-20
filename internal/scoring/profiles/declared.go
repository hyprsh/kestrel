package profiles

import (
	"context"
	"maps"
	"slices"

	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/scoring/profiles/db"
	"github.com/hyprsh/kestrel/internal/slot"
)

// State is one Profile's settings, as a Config File declares them.
type State struct {
	Enabled        bool
	OriginalChoice scoring.OriginalChoice
	DefaultMovies  bool
	DefaultSeries  bool
}

// CheckAll applies Patch's rules to the settings of every Profile at once,
// as a Config File declares them: every Profile is named, Original-Language
// Profiles always reject Original-only Releases, a default is enabled, a Slot has at
// most one default per kind and the Standard Slot exactly one. It writes
// nothing; a rejection is a *ValidationError whose Field is "<key>.<field>",
// "<key>", or empty for a rule about the Standard Slot.
func CheckAll(want map[string]State) error {
	builtin := Builtin()
	known := map[string]bool{}
	for _, p := range builtin {
		known[p.Key] = true
		if _, ok := want[p.Key]; !ok {
			return invalid(p.Key, "missing: the Config File declares every Profile or none")
		}
	}
	for _, key := range slices.Sorted(maps.Keys(want)) {
		if !known[key] {
			return invalid(key, "no such Profile")
		}
	}
	type slotKind struct {
		slot   slot.Slot
		series bool
	}
	defaults := map[slotKind]string{}
	for _, p := range builtin {
		w := want[p.Key]
		if err := checkOwn(p.Rule, w, p.Key+"."); err != nil {
			return err
		}
		for _, d := range []struct {
			on     bool
			series bool
			field  string
		}{{w.DefaultMovies, false, "default_movies"}, {w.DefaultSeries, true, "default_series"}} {
			if !d.on {
				continue
			}
			k := slotKind{p.Slot, d.series}
			if other, ok := defaults[k]; ok {
				return invalid(p.Key+"."+d.field, other+" is already the "+p.Slot.String()+" default: a Slot has one default per kind")
			}
			defaults[k] = p.Key
		}
	}
	for _, kind := range []struct {
		series bool
		name   string
	}{{false, "movies"}, {true, "series"}} {
		if _, ok := defaults[slotKind{slot.Standard, kind.series}]; !ok {
			return invalid("", "the Standard Slot always has a default for "+kind.name+": make one Standard Profile its default")
		}
	}
	return nil
}

// SetAll brings every Profile to want after checking it with CheckAll. It
// writes only the Profiles that differ, so the same state twice writes
// nothing.
func (s *Service) SetAll(ctx context.Context, want map[string]State) error {
	if err := CheckAll(want); err != nil {
		return err
	}
	return s.write(ctx, func(q *db.Queries) error {
		rows, err := q.ListProfiles(ctx)
		if err != nil {
			return err
		}
		var changed []Profile
		for _, r := range rows {
			cur, err := fromRow(r)
			if err != nil {
				return err
			}
			if w := want[cur.Key]; w != (State{cur.Enabled, cur.OriginalChoice, cur.DefaultMovies, cur.DefaultSeries}) {
				changed = append(changed, cur)
			}
		}
		// Drop the defaults that go before setting the new ones, so a Slot
		// never has two defaults of a kind on the way.
		for _, cur := range changed {
			w := want[cur.Key]
			if err := q.SetProfileEnabled(ctx, db.SetProfileEnabledParams{Enabled: b2i(w.Enabled), Key: cur.Key}); err != nil {
				return err
			}
			if err := q.SetProfileOriginalChoice(ctx, db.SetProfileOriginalChoiceParams{
				OriginalLanguage: string(w.OriginalChoice), OriginalFallback: b2i(w.OriginalChoice.DeprecatedFlag()), Key: cur.Key,
			}); err != nil {
				return err
			}
			if err := q.SetProfileDefaultMovies(ctx, db.SetProfileDefaultMoviesParams{DefaultMovies: b2i(w.DefaultMovies && cur.DefaultMovies), Key: cur.Key}); err != nil {
				return err
			}
			if err := q.SetProfileDefaultSeries(ctx, db.SetProfileDefaultSeriesParams{DefaultSeries: b2i(w.DefaultSeries && cur.DefaultSeries), Key: cur.Key}); err != nil {
				return err
			}
		}
		for _, cur := range changed {
			w := want[cur.Key]
			if w.DefaultMovies && !cur.DefaultMovies {
				if err := q.SetProfileDefaultMovies(ctx, db.SetProfileDefaultMoviesParams{DefaultMovies: 1, Key: cur.Key}); err != nil {
					return err
				}
			}
			if w.DefaultSeries && !cur.DefaultSeries {
				if err := q.SetProfileDefaultSeries(ctx, db.SetProfileDefaultSeriesParams{DefaultSeries: 1, Key: cur.Key}); err != nil {
					return err
				}
			}
		}
		return nil
	})
}
