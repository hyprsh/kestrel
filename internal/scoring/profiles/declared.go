package profiles

import (
	"context"
	"maps"
	"slices"

	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/scoring/profiles/db"
)

// State is one Profile's settings, as a Config File declares them. The defaults for new Titles
// belong to the Slots, so they are not here.
type State struct {
	Enabled        bool
	OriginalChoice scoring.OriginalChoice
	// Family is the Release Family (ADR 0026), and Language the language rule: primary, original, or the
	// named language's code (en, de or fr). Empty leaves the Profile's own.
	Family   scoring.ReleaseFamily
	Language string
}

// recipeOf is the Profile with the recipe the declared State names; empty fields leave the Profile's own.
// A field the State names wrongly is a *ValidationError on field.
func recipeOf(p Profile, s State, prefix string) (Profile, error) {
	if s.Family != "" {
		if !s.Family.Valid() {
			return p, invalid(prefix+"release_family", "Choose bluray-web, remux-web, web or sqp")
		}
		p.Family = s.Family
	}
	if s.Language != "" {
		rule, named, ok := ParseRule(s.Language)
		if !ok {
			return p, invalid(prefix+"language_rule", "Choose primary, original, en, de or fr")
		}
		p.Rule, p.Named = rule, named
	}
	return p, nil
}

// CheckAll applies Patch's rules to the settings of every Profile at once,
// as a Config File declares them: every Profile is named, Original-Language
// Profiles always reject Original-only Releases and an enabled Profile's recipe
// has a backing TRaSH profile under the Primary Language. It writes nothing; a
// rejection is a *ValidationError whose Field is "<key>.<field>" or "<key>".
func CheckAll(want map[string]State, primary Language) error {
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
		next, err := recipeOf(p, want[p.Key], p.Key+".")
		if err != nil {
			return err
		}
		if err := checkRecipe(next, want[p.Key].Enabled, primary, p.Key+"."); err != nil {
			return err
		}
		if err := checkOwn(next.Rule, want[p.Key], p.Key+"."); err != nil {
			return err
		}
	}
	return nil
}

// AppliesTo reports whether the builtin Profile key, as declared, applies to a kind under the Primary Language: whether
// a TRaSH profile backs its recipe for the kind. A Slot's default for a kind must be a Profile that does.
func AppliesTo(key string, st State, primary Language, kind release.Kind) bool {
	for _, p := range Builtin() {
		if p.Key == key {
			next, err := recipeOf(p, st, "")
			return err == nil && next.LacksBacking(primary, kind) == nil
		}
	}
	return false
}

// checkRecipe applies the rules of a recipe: Any is only Bluray + WEB, and an enabled Profile has a backing TRaSH
// profile for both kinds under the Primary Language.
func checkRecipe(p Profile, enabled bool, primary Language, prefix string) error {
	if p.Any && p.Family != scoring.FamilyBlurayWeb {
		return invalid(prefix+"release_family", "Any is only Bluray + WEB")
	}
	if !enabled {
		return nil
	}
	// An enabled Profile applies to at least one kind: SQP and French Remux have Movies only.
	if _, _, err := p.Backing(primary); err != nil {
		return invalid(prefix+"release_family", err.Error()+" under the Primary Language "+primary.Release().Name)
	}
	return nil
}

// SetAll brings every Profile to want after checking it with CheckAll. It
// writes only the Profiles that differ, so the same state twice writes
// nothing. A Profile a Slot names as its default stays enabled: the file declares the Slots
// first (see the Config File's order), so the Slot's default is already the one it wants.
// declared is the Primary Language the Config File declares, which the recipes are backed under; empty takes the saved one, so a
// file that changes the language and the Profiles at once is checked against the language it brings.
func (s *Service) SetAll(ctx context.Context, want map[string]State, declared Language) error {
	region, _, err := s.Region(ctx)
	if err != nil {
		return err
	}
	primary := region.Primary
	if declared != "" {
		primary = declared
	}
	if err := CheckAll(want, primary); err != nil {
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
			next, err := recipeOf(cur, w, cur.Key+".")
			if err != nil {
				return err
			}
			setSettings := func() error {
				if w.Enabled == cur.Enabled && w.OriginalChoice == cur.OriginalChoice {
					return nil
				}
				if !w.Enabled {
					if err := notADefault(ctx, q, cur.Key); err != nil {
						return err
					}
				}
				if err := q.SetProfileEnabled(ctx, db.SetProfileEnabledParams{Enabled: b2i(w.Enabled), Key: cur.Key}); err != nil {
					return err
				}
				return q.SetProfileOriginalChoice(ctx, db.SetProfileOriginalChoiceParams{
					OriginalLanguage: string(w.OriginalChoice), OriginalFallback: b2i(w.OriginalChoice.DeprecatedFlag()), Key: cur.Key,
				})
			}
			setRecipe := func() error {
				if next.Family == cur.Family && next.RuleKey() == cur.RuleKey() {
					return nil
				}
				if err := q.SetProfileRecipe(ctx, db.SetProfileRecipeParams{
					ReleaseFamily: string(next.Family), LanguageRule: next.RuleKey(), Key: cur.Key,
				}); err != nil {
					return err
				}
				movies, series, _ := next.Backing(primary) // empty when it applies to no kind (a disabled Profile)
				return q.SetProfileTrash(ctx, db.SetProfileTrashParams{TrashProfileMovies: movies, TrashProfileSeries: series, Key: cur.Key})
			}
			// An Original-Language Profile can only reject, so the order follows the direction of the change:
			// into the Original rule the choice goes first, out of it the recipe does.
			steps := []func() error{setRecipe, setSettings}
			if next.Rule == scoring.OriginalLanguage {
				steps = []func() error{setSettings, setRecipe}
			}
			for _, step := range steps {
				if err := step(); err != nil {
					return err
				}
			}
		}
		return nil
	})
}
