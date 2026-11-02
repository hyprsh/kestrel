package profiles

import (
	"context"
	"maps"
	"slices"

	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/scoring/profiles/db"
)

// State is one Profile's settings, as a Config File declares them. The defaults for new Titles
// belong to the Slots, so they are not here.
type State struct {
	Enabled        bool
	OriginalChoice scoring.OriginalChoice
}

// CheckAll applies Patch's rules to the settings of every Profile at once,
// as a Config File declares them: every Profile is named and Original-Language
// Profiles always reject Original-only Releases. It writes nothing; a
// rejection is a *ValidationError whose Field is "<key>.<field>" or "<key>".
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
	for _, p := range builtin {
		if err := checkOwn(p.Rule, want[p.Key], p.Key+"."); err != nil {
			return err
		}
	}
	return nil
}

// SetAll brings every Profile to want after checking it with CheckAll. It
// writes only the Profiles that differ, so the same state twice writes
// nothing. A Profile a Slot names as its default stays enabled: the file declares the Slots
// first (see the Config File's order), so the Slot's default is already the one it wants.
func (s *Service) SetAll(ctx context.Context, want map[string]State) error {
	if err := CheckAll(want); err != nil {
		return err
	}
	return s.write(ctx, func(q *db.Queries) error {
		rows, err := q.ListProfiles(ctx)
		if err != nil {
			return err
		}
		for _, r := range rows {
			cur, err := fromRow(r)
			if err != nil {
				return err
			}
			if cur.Custom {
				continue // a Config File declares the builtin Profiles only
			}
			w := want[cur.Key]
			if w == (State{cur.Enabled, cur.OriginalChoice}) {
				continue
			}
			if !w.Enabled {
				if err := notADefault(ctx, q, cur.Key); err != nil {
					return err
				}
			}
			if err := q.SetProfileEnabled(ctx, db.SetProfileEnabledParams{Enabled: b2i(w.Enabled), Key: cur.Key}); err != nil {
				return err
			}
			if err := q.SetProfileOriginalChoice(ctx, db.SetProfileOriginalChoiceParams{
				OriginalLanguage: string(w.OriginalChoice), OriginalFallback: b2i(w.OriginalChoice.DeprecatedFlag()), Key: cur.Key,
			}); err != nil {
				return err
			}
		}
		return nil
	})
}
