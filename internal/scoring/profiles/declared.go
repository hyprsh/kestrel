package profiles

import (
	"context"
	"fmt"
	"maps"
	"regexp"
	"slices"
	"strings"

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
	// Name and Resolution complete the recipe. A Profile that is not one of the six builtin ones needs all four of Name,
	// Family, Resolution and Language; a builtin one leaves them empty to keep its own. Resolution is the Config File's
	// word: hd, 4k or any.
	Name       string
	Resolution string
}

// builtinProfile is the builtin Profile with the key, as shipped.
func builtinProfile(key string) (Profile, bool) {
	for _, p := range Builtin() {
		if p.Key == key {
			return p, true
		}
	}
	return Profile{}, false
}

// keyOK is the shape of a Profile key: lower-case letters and digits in words joined by single hyphens.
var keyOK = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

// declaredProfile is the Profile a Config File's entry for key makes. base is the Profile as it stands, or as shipped for a
// builtin key that is not stored; the fields the State leaves empty keep base's. A key that is not a builtin one has no
// base and must give its name and its whole recipe. A field named wrongly is a *ValidationError on prefix+field.
func declaredProfile(base Profile, key string, s State, prefix string) (Profile, error) {
	p := base
	p.Key = key
	if _, builtin := builtinProfile(key); !builtin {
		if !keyOK.MatchString(key) {
			return p, invalid(strings.TrimSuffix(prefix, "."), "A Profile key is lower-case letters and digits, with single hyphens between")
		}
		for _, f := range []struct {
			field string
			given bool
		}{{"name", s.Name != ""}, {"release_family", s.Family != ""}, {"resolution", s.Resolution != ""}, {"language_rule", s.Language != ""}} {
			if !f.given {
				return p, invalid(prefix+f.field, "required: a Profile that is not one of the six builtin ones declares its name, release_family, resolution and language_rule")
			}
		}
		p = Profile{Key: key, Custom: true, Enabled: true, OriginalChoice: scoring.OriginalReject, Family: scoring.FamilyBlurayWeb}
	}
	if s.Name != "" {
		p.Name = strings.TrimSpace(s.Name)
	}
	if err := checkDeclaredName(p.Name, prefix); err != nil {
		return p, err
	}
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
	if s.Resolution != "" {
		res, ok := ResolutionOf(s.Resolution)
		if !ok {
			return p, invalid(prefix+"resolution", "Choose hd, 4k or any")
		}
		p.setResolution(res)
	}
	return p, nil
}

func checkDeclaredName(name, prefix string) error {
	switch {
	case name == "":
		return invalid(prefix+"name", "Give the Profile a name")
	case len([]rune(name)) > maxNameLength:
		return invalid(prefix+"name", fmt.Sprintf("A name is at most %d characters", maxNameLength))
	}
	return nil
}

// CheckAll applies Patch's rules to the settings of every Profile at once, as a Config File declares them: the file
// names every Profile the household has, any subset of the six builtin ones plus recipe Profiles, each under a name of
// its own; Original-Language Profiles always reject Original-only Releases and an enabled Profile's recipe has a backing
// TRaSH profile under the Primary Language. It writes nothing; a rejection is a *ValidationError whose Field is
// "<key>.<field>" or "<key>".
func CheckAll(want map[string]State, primary Language) error {
	names := map[string]string{}
	for _, key := range slices.Sorted(maps.Keys(want)) {
		st := want[key]
		base, _ := builtinProfile(key)
		next, err := declaredProfile(base, key, st, key+".")
		if err != nil {
			return err
		}
		if other, dup := names[strings.ToLower(next.Name)]; dup {
			return invalid(key+".name", "Another Profile ("+other+") has that name")
		}
		names[strings.ToLower(next.Name)] = key
		if err := checkRecipe(next, st.Enabled, primary, key+"."); err != nil {
			return err
		}
		if err := checkOwn(next.Rule, st, key+"."); err != nil {
			return err
		}
	}
	return nil
}

// LeftOut is the stored Profiles the file does not name. SetAll disables them and keeps them (#304): the file names the
// household's set, but it never deletes a Profile.
func (s *Service) LeftOut(ctx context.Context, want map[string]State) ([]Profile, error) {
	rows, err := db.New(s.st.Read()).ListProfiles(ctx)
	if err != nil {
		return nil, err
	}
	var out []Profile
	for _, r := range rows {
		if _, ok := want[r.Key]; ok {
			continue
		}
		p, err := fromRow(r)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, nil
}

// CheckKept is nil when every stored Profile the file leaves out can be disabled: no Version uses it. A Slot's default is the
// caller's to check, as the Slots are the file's or the saved ones. A rejection is an error naming the Profile.
func (s *Service) CheckKept(ctx context.Context, want map[string]State) error {
	q := db.New(s.st.Read())
	rows, err := q.ListProfiles(ctx)
	if err != nil {
		return err
	}
	for _, r := range rows {
		if _, ok := want[r.Key]; ok {
			continue
		}
		n, err := q.ProfileVersionCount(ctx, r.Key)
		if err != nil {
			return err
		}
		if n > 0 {
			noun := "Versions"
			if n == 1 {
				noun = "Version"
			}
			return fmt.Errorf("the Profile %q (%s) is used by %d %s and the file leaves it out: keep it in the file, or move its Versions to another Profile first", r.Key, r.Name, n, noun)
		}
	}
	return nil
}

// AppliesTo reports whether the Profile key, as declared, applies to a kind under the Primary Language: whether
// a TRaSH profile backs its recipe for the kind. A Slot's default for a kind must be a Profile that does.
func AppliesTo(key string, st State, primary Language, kind release.Kind) bool {
	base, _ := builtinProfile(key)
	next, err := declaredProfile(base, key, st, "")
	return err == nil && next.LacksBacking(primary, kind) == nil
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

// SetAll brings the Profiles to want after checking it with CheckAll: the ones the file names are made if missing and
// changed if they differ, and a stored Profile it leaves out is disabled and kept (#304). It writes only what differs, so the same state
// twice writes nothing. A Profile a Slot names as its default stays: the file declares the Slots first (see the Config
// File's order), so the Slot's default is already the one it wants, and a Profile a Version uses cannot go
// (CheckKept asks first; this is the same rule held in the transaction).
// Nothing here deletes a Profile.
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
		// A fresh install has none of the six (#304): the file declares them into being, as it says.
		if rows, err = s.insertMissing(ctx, q, rows, want, primary); err != nil {
			return err
		}
		for _, r := range rows {
			cur, err := fromRow(r)
			if err != nil {
				return err
			}
			w, kept := want[cur.Key]
			if !kept {
				if err := disableUndeclared(ctx, q, cur); err != nil {
					return err
				}
				continue
			}
			next, err := declaredProfile(cur, cur.Key, w, cur.Key+".")
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
				if next.Name != cur.Name {
					if err := q.SetProfileName(ctx, db.SetProfileNameParams{Name: next.Name, Key: cur.Key}); err != nil {
						return err
					}
				}
				shape := next.Any != cur.Any || next.MinHeight != cur.MinHeight || next.MaxHeight != cur.MaxHeight
				if !shape && next.Family == cur.Family && next.RuleKey() == cur.RuleKey() {
					return nil
				}
				if shape {
					if err := q.SetProfileShape(ctx, db.SetProfileShapeParams{
						Any: b2i(next.Any), MinHeight: int64(next.MinHeight), MaxHeight: int64(next.MaxHeight), Key: cur.Key,
					}); err != nil {
						return err
					}
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

// disableUndeclared disables a Profile the Config File leaves out and keeps it, unless a Slot defaults to it
// (*DefaultError) or a Version uses it (ErrInUse).
func disableUndeclared(ctx context.Context, q *db.Queries, p Profile) error {
	if err := notADefault(ctx, q, p.Key); err != nil {
		return err
	}
	n, err := q.ProfileVersionCount(ctx, p.Key)
	if err != nil {
		return err
	}
	if n > 0 {
		return fmt.Errorf("%w: %s (%s)", ErrInUse, p.Key, p.Name)
	}
	if !p.Enabled {
		return nil
	}
	return q.SetProfileEnabled(ctx, db.SetProfileEnabledParams{Enabled: 0, Key: p.Key})
}

// insertMissing makes each Profile the file declares that the rows lack, enabled, and returns the rows again. A builtin
// one is made as shipped and a recipe one from its recipe; SetAll then applies the rest of what the file says.
func (s *Service) insertMissing(ctx context.Context, q *db.Queries, rows []db.Profile, want map[string]State, primary Language) ([]db.Profile, error) {
	have := map[string]bool{}
	for _, r := range rows {
		have[r.Key] = true
	}
	top, err := q.MaxProfileSort(ctx)
	if err != nil {
		return nil, err
	}
	next := toInt64(top)
	var inserted bool
	for _, key := range slices.Sorted(maps.Keys(want)) {
		if have[key] {
			continue
		}
		base, builtin := builtinProfile(key)
		p, err := declaredProfile(base, key, want[key], key+".")
		if err != nil {
			return nil, err
		}
		movies, series, _ := p.Backing(primary)
		sort := int64(0)
		if builtin {
			sort = int64(slices.IndexFunc(Builtin(), func(b Profile) bool { return b.Key == key }) + 1)
		} else {
			next++
			sort = next
		}
		if builtin {
			err = q.InsertBuiltinProfile(ctx, db.InsertBuiltinProfileParams{
				Key: p.Key, Name: p.Name, Sort: sort, Any: b2i(p.Any), ReleaseFamily: string(p.Family), LanguageRule: p.RuleKey(),
				MinHeight: int64(p.MinHeight), MaxHeight: int64(p.MaxHeight), TrashProfileMovies: movies, TrashProfileSeries: series,
			})
		} else {
			err = q.InsertCustomProfile(ctx, db.InsertCustomProfileParams{
				Key: p.Key, Name: p.Name, Sort: sort, Any: b2i(p.Any), ReleaseFamily: string(p.Family), LanguageRule: p.RuleKey(),
				MinHeight: int64(p.MinHeight), MaxHeight: int64(p.MaxHeight), TrashProfileMovies: movies, TrashProfileSeries: series,
				OriginalLanguage: string(scoring.OriginalReject),
			})
		}
		if err != nil {
			return nil, err
		}
		inserted = true
	}
	if !inserted {
		return rows, nil
	}
	return q.ListProfiles(ctx)
}

// EnsureDeclared makes the Profiles the file declares and the database lacks: a fresh install has none (#304), and a
// Slot's default must name a Profile that is there, so they come before the Slots. declared is the Primary Language the file
// declares, empty for the stored one.
func (s *Service) EnsureDeclared(ctx context.Context, want map[string]State, declared Language) error {
	region, _, err := s.Region(ctx)
	if err != nil {
		return err
	}
	primary := region.Primary
	if declared != "" {
		primary = declared
	}
	return s.write(ctx, func(q *db.Queries) error {
		rows, err := q.ListProfiles(ctx)
		if err != nil {
			return err
		}
		_, err = s.insertMissing(ctx, q, rows, want, primary)
		return err
	})
}
