package profiles

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/scoring/profiles/db"
)

// Resolution is the resolution range of a recipe.
type Resolution string

const (
	ResHD  Resolution = "hd"
	ResUHD Resolution = "uhd"
	ResAny Resolution = "any"
)

// Resolutions lists them in display order.
var Resolutions = []Resolution{ResHD, ResUHD, ResAny}

// ResolutionOf is the resolution range a Config File's `resolution` names: hd, 4k or any.
func ResolutionOf(word string) (Resolution, bool) {
	switch word {
	case "hd":
		return ResHD, true
	case "4k":
		return ResUHD, true
	case "any":
		return ResAny, true
	}
	return "", false
}

// Recipe is what a Profile is made of (ADR 0026): a resolution range, a Release Family and a language rule. Named is the
// language of a named-language rule and empty otherwise.
type Recipe struct {
	Family     scoring.ReleaseFamily
	Resolution Resolution
	Rule       scoring.LanguageRule
	Named      Language
}

// RuleKey is the rule as the API names it: primary, original, or the named language's code.
func (r Recipe) RuleKey() string { return ruleKey(r.Rule, r.Named) }

// ParseRecipe is the recipe a Release Family, a resolution and a language rule key name; a *ValidationError when the key is none.
func ParseRecipe(family scoring.ReleaseFamily, res Resolution, rule string) (Recipe, error) {
	r, named, ok := ParseRule(rule)
	if !ok {
		return Recipe{}, invalid("language_rule", "Choose primary, original, en, de or fr")
	}
	return Recipe{Family: family, Resolution: res, Rule: r, Named: named}, nil
}

// Suggestion is a recipe the household can import, with the name it would get and the kinds it applies to.
type Suggestion struct {
	Recipe Recipe
	Name   string
	Kinds  []release.Kind
}

// ErrRecipeExists means the household already has a Profile for the recipe.
var ErrRecipeExists = errors.New("a Profile for that recipe exists")

// RecipeOf is the recipe a Profile is made of, as stored.
func RecipeOf(p Profile) Recipe {
	return Recipe{Family: p.Family.OrDefault(), Resolution: p.Resolution(), Rule: p.Rule, Named: p.Named}
}

// normalized is the recipe with a named language that is the Primary Language written as the Primary-Language rule,
// which is what the Profile does under that Primary Language.
func (r Recipe) normalized(primary Language) Recipe {
	if r.Rule == scoring.NamedLanguage && r.Named == primary {
		r.Rule, r.Named = scoring.PrimaryLanguage, ""
	}
	return r
}

// profile is the Profile the recipe makes, named name.
func (r Recipe) profile(name string) (Profile, bool) {
	if !r.Family.Valid() || !slices.Contains(Resolutions, r.Resolution) {
		return Profile{}, false
	}
	if _, _, ok := ParseRule(r.RuleKey()); !ok {
		return Profile{}, false
	}
	p := Profile{Name: name, Family: r.Family, Rule: r.Rule, Named: r.Named, OriginalChoice: scoring.OriginalReject}
	p.setResolution(r.Resolution)
	return p, true
}

// recipeName generates the name: "4K Remux", "HD Original", "HD French", "WEB 1080p", "SQP 2160p".
func recipeName(r Recipe) string {
	res := map[Resolution]string{ResHD: "HD", ResUHD: "4K", ResAny: "Any"}[r.Resolution]
	var parts []string
	switch r.Family {
	case scoring.FamilyRemuxWeb:
		parts = []string{res, "Remux"}
	case scoring.FamilyWeb, scoring.FamilySQP:
		label, px := "WEB", "1080p"
		if r.Family == scoring.FamilySQP {
			label = "SQP"
		}
		if r.Resolution == ResUHD {
			px = "2160p"
		}
		parts = []string{label, px}
	default:
		parts = []string{res}
	}
	switch r.Rule {
	case scoring.PrimaryLanguage:
	case scoring.OriginalLanguage:
		parts = append(parts, "Original")
	default:
		parts = append(parts, r.Named.Release().Name)
	}
	return strings.Join(parts, " ")
}

// kindsOf is the kinds a recipe applies to under the Primary Language: those with a TRaSH profile to back it.
func kindsOf(r Recipe, primary Language) []release.Kind {
	p, ok := r.profile("")
	if !ok {
		return nil
	}
	spec := p.Spec(primary.Release())
	var out []release.Kind
	for _, k := range []release.Kind{release.KindMovie, release.KindSeries} {
		if _, ok := scoring.BackingProfile(spec, k); ok {
			out = append(out, k)
		}
	}
	return out
}

// suggestedRules are the language rules a suggestion can have, in display order.
var suggestedRules = []struct {
	rule  scoring.LanguageRule
	named Language
}{
	{scoring.PrimaryLanguage, ""}, {scoring.OriginalLanguage, ""},
	{scoring.NamedLanguage, English}, {scoring.NamedLanguage, German}, {scoring.NamedLanguage, French},
}

// Suggestions lists every valid recipe the household has no Profile for, in display order: by Release Family, then
// resolution, then language rule. A named language that is the Primary Language is the Primary-Language recipe, so
// it is not listed twice.
func (s *Service) Suggestions(ctx context.Context) ([]Suggestion, error) {
	all, err := s.List(ctx)
	if err != nil {
		return nil, err
	}
	region, _, err := s.Region(ctx)
	if err != nil {
		return nil, err
	}
	have := map[Recipe]bool{}
	for _, p := range all {
		have[RecipeOf(p).normalized(region.Primary)] = true
	}
	var out []Suggestion
	for _, family := range scoring.ReleaseFamilies {
		for _, res := range Resolutions {
			for _, rule := range suggestedRules {
				r := Recipe{Family: family, Resolution: res, Rule: rule.rule, Named: rule.named}
				if r.normalized(region.Primary) != r || have[r] {
					continue
				}
				if kinds := kindsOf(r, region.Primary); len(kinds) > 0 {
					out = append(out, Suggestion{Recipe: r, Name: recipeName(r), Kinds: kinds})
				}
			}
		}
	}
	return out, nil
}

// Import makes a custom Profile of a recipe, enabled, under its generated name or name when that is not empty. A
// recipe with no backing profile for any kind is a *ValidationError, a taken name too, and a recipe the household
// already has a Profile for is ErrRecipeExists.
func (s *Service) Import(ctx context.Context, r Recipe, name string) (Profile, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		name = recipeName(r)
	}
	p, ok := r.profile(name)
	if !ok {
		return Profile{}, invalid("release_family", "Not a recipe: choose a Release Family, a resolution and a language rule")
	}
	region, _, err := s.Region(ctx)
	if err != nil {
		return Profile{}, err
	}
	movies, series, err := p.Backing(region.Primary)
	if err != nil {
		return Profile{}, invalid("release_family", err.Error()+" under the Primary Language "+region.Primary.Release().Name)
	}
	var out Profile
	err = s.write(ctx, func(q *db.Queries) error {
		rows, err := q.ListProfiles(ctx)
		if err != nil {
			return err
		}
		existing, err := convert(rows)
		if err != nil {
			return err
		}
		for _, e := range existing {
			if RecipeOf(e).normalized(region.Primary) == r.normalized(region.Primary) {
				return ErrRecipeExists
			}
		}
		if err := checkName(name, "", rows); err != nil {
			return err
		}
		out, err = insertCustom(ctx, q, db.InsertCustomProfileParams{
			Name: name, Any: b2i(p.Any), ReleaseFamily: string(p.Family), LanguageRule: p.RuleKey(),
			MinHeight: int64(p.MinHeight), MaxHeight: int64(p.MaxHeight),
			TrashProfileMovies: movies, TrashProfileSeries: series, OriginalLanguage: string(scoring.OriginalReject),
		})
		return err
	})
	return out, err
}

// Name is the name an import of the recipe gets: "4K Remux", "HD Original", "HD French".
func (r Recipe) Name() string { return recipeName(r) }

// Ensure is the household's Profile of the recipe, enabled: the one it has, or else an import of the recipe. A setup
// preset names its default Profiles this way (#304), so a household that already has "HD" keeps it.
func (s *Service) Ensure(ctx context.Context, r Recipe) (Profile, error) {
	var all []Profile
	err := s.write(ctx, func(q *db.Queries) error { // through the write side, to see what an open transaction has made
		rows, err := q.ListProfiles(ctx)
		if err != nil {
			return err
		}
		all, err = convert(rows)
		return err
	})
	if err != nil {
		return Profile{}, err
	}
	region, _, err := s.Region(ctx)
	if err != nil {
		return Profile{}, err
	}
	for _, p := range all {
		if RecipeOf(p).normalized(region.Primary) != r.normalized(region.Primary) {
			continue
		}
		if p.Enabled {
			return p, nil
		}
		on := true
		return s.Patch(ctx, p.Key, Patch{Enabled: &on})
	}
	return s.Import(ctx, r, "")
}

// Duplicate is two Profiles that are the same recipe under the Primary Language though they are not stored as the
// same: one names the Primary Language and the other says Primary.
type Duplicate struct{ A, B Profile }

// Message says so.
func (d Duplicate) Message(primary Language) string {
	return fmt.Sprintf("%s and %s are the same recipe now that the Primary Language is %s. Both stay, and nothing is merged: remove or change one when you are ready",
		d.A.Name, d.B.Name, primary.Release().Name)
}

// Duplicates finds the pairs of Profiles that became the same recipe by a change of Primary Language. A copy of a
// Profile is the same recipe on purpose and is not one.
func Duplicates(all []Profile, primary Language) []Duplicate {
	var out []Duplicate
	for i, a := range all {
		for _, b := range all[i+1:] {
			ra, rb := RecipeOf(a), RecipeOf(b)
			if ra != rb && ra.normalized(primary) == rb.normalized(primary) {
				out = append(out, Duplicate{A: a, B: b})
			}
		}
	}
	return out
}
