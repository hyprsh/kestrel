// Package profiles, part of the scoring module, owns the six builtin Profiles and the household's
// language settings: the Primary Language and the release-date country. It
// holds the pure helpers other modules share: Profile resolution.
//
// Nothing branches on a Profile's key: behaviour comes from the fields (Any,
// resolution range, language rule, enabled). The keys only name the rows.
package profiles

import (
	"errors"
	"fmt"
	"strings"

	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/slot"
)

// Profile is a Profile with its per-Profile settings: one of the six builtin ones or a custom copy.
// It has no Slot (ADR 0024): any Profile can fill any Slot, and the Slots name their default Profiles.
type Profile struct {
	Key  string
	Name string
	// Any accepts SD too.
	Any bool
	// Family is the Release Family: Bluray + WEB, Remux + WEB, WEB or SQP (ADR 0026).
	Family scoring.ReleaseFamily
	Rule   scoring.LanguageRule
	// Named is the language of a NamedLanguage rule, and empty otherwise.
	Named Language
	// MinHeight and MaxHeight bound the resolutions it accepts (Settled 2); they are the only
	// resolution rule.
	MinHeight, MaxHeight int

	Enabled bool
	// OriginalChoice is what the Profile does with a Release in the Title's
	// Original Language only; always reject on Original-Language Profiles.
	OriginalChoice scoring.OriginalChoice

	// TrashMovies and TrashSeries name the TRaSH profile files (without .json)
	// backing the Profile under the current Primary Language (Settled 5).
	TrashMovies, TrashSeries string

	// Custom marks a Profile made with "New Profile…": a copy of another that can be renamed and deleted.
	Custom bool
	// Overlay is what the household set on top of TRaSH's data (ADR 0023); zero leaves TRaSH's.
	Overlay scoring.Overlay
}

// UHD reports whether the Profile takes only 4K, which is what picks the UHD TRaSH profile behind it.
func (p Profile) UHD() bool { return p.MinHeight >= 2160 }

// Spec is the scoring.ProfileSpec of the Profile under a Primary Language.
func (p Profile) Spec(primary release.Language) scoring.ProfileSpec {
	spec := scoring.ProfileSpec{
		UHD: p.UHD(), Any: p.Any, Family: p.Family, Rule: p.Rule, Primary: primary, OriginalChoice: p.OriginalChoice, Overlay: p.overlay(),
	}
	if p.Rule == scoring.NamedLanguage {
		spec.Language = p.Named.Release()
	}
	return spec
}

// RuleKey is the Profile's language rule as the API and the Config File name it: primary, original, or the
// named language's code (en, de or fr).
func (p Profile) RuleKey() string { return ruleKey(p.Rule, p.Named) }

// ruleKey is the key of a language rule: primary, original, or the named language's code.
func ruleKey(rule scoring.LanguageRule, named Language) string {
	switch rule {
	case scoring.OriginalLanguage:
		return "original"
	case scoring.NamedLanguage:
		return string(named)
	}
	return "primary"
}

// Resolution is the resolution range of the Profile as a recipe names it.
func (p Profile) Resolution() Resolution {
	switch {
	case p.UHD():
		return ResUHD
	case p.Any:
		return ResAny
	}
	return ResHD
}

// setResolution gives the Profile the bounds of a resolution range.
func (p *Profile) setResolution(r Resolution) {
	p.Any = r == ResAny
	p.MinHeight, p.MaxHeight = scoring.HeightBounds(r == ResUHD, p.Any)
}

// ParseRule is the language rule a key names, and the named language when it is one; false for a key that is none.
func ParseRule(key string) (scoring.LanguageRule, Language, bool) {
	switch key {
	case "primary":
		return scoring.PrimaryLanguage, "", true
	case "original":
		return scoring.OriginalLanguage, "", true
	case string(English), string(German), string(French):
		return scoring.NamedLanguage, Language(key), true
	}
	return 0, "", false
}

// NoBackingError says no TRaSH profile backs a Profile's recipe for some kind in the language its rule names (ADR 0026).
type NoBackingError struct {
	Profile string // the Profile's name
	Recipe  string
	Kinds   []release.Kind
}

func (e *NoBackingError) Error() string {
	names := make([]string, len(e.Kinds))
	for i, k := range e.Kinds {
		names[i] = "Series"
		if k == release.KindMovie {
			names[i] = "Movies"
		}
	}
	return fmt.Sprintf("%s (%s) has no TRaSH profile for %s", e.Profile, e.Recipe, strings.Join(names, " and "))
}

// Backing names the TRaSH profiles that back the Profile under a Primary Language, for Movies and for Series.
// A recipe applies to the kinds that have one, and the other name is empty; when neither has one the error is a
// *NoBackingError.
func (p Profile) Backing(primary Language) (movies, series string, err error) {
	spec := p.Spec(primary.Release())
	movies, okM := scoring.BackingProfile(spec, release.KindMovie)
	series, okS := scoring.BackingProfile(spec, release.KindSeries)
	if !okM && !okS {
		return "", "", &NoBackingError{Profile: p.Name, Recipe: p.recipeName(primary), Kinds: []release.Kind{release.KindMovie, release.KindSeries}}
	}
	return movies, series, nil
}

// AppliesTo reports whether the Profile applies to a kind: whether a TRaSH profile backs it for the kind under the
// current Primary Language (the names the Profile stores).
func (p Profile) AppliesTo(kind release.Kind) bool {
	if kind == release.KindMovie {
		return p.TrashMovies != ""
	}
	return p.TrashSeries != ""
}

// LacksBacking is the *NoBackingError for a kind the Profile would not apply to under the Primary Language, or nil.
func (p Profile) LacksBacking(primary Language, kind release.Kind) error {
	if _, ok := scoring.BackingProfile(p.Spec(primary.Release()), kind); ok {
		return nil
	}
	return &NoBackingError{Profile: p.Name, Recipe: p.recipeName(primary), Kinds: []release.Kind{kind}}
}

// recipeName is the recipe in words: the Release Family and the language.
func (p Profile) recipeName(primary Language) string {
	lang := "the Primary Language " + primary.Release().Name
	switch p.Rule {
	case scoring.OriginalLanguage:
		lang = "the Original Language"
	case scoring.NamedLanguage:
		lang = p.Named.Release().Name
	}
	return p.Family.Name() + ", " + lang
}

// overlay is the Overlay the Spec carries: nil when the household set nothing.
func (p Profile) overlay() *scoring.Overlay {
	if p.Overlay.IsZero() {
		return nil
	}
	o := p.Overlay
	return &o
}

// Builtin returns the six Profiles as shipped: all enabled, Original-only Releases rejected.
// Backing TRaSH names are the English household's.
func Builtin() []Profile {
	mk := func(key, name string, uhd, isAny bool, rule scoring.LanguageRule) Profile {
		p := Profile{Key: key, Name: name, Any: isAny, Family: scoring.FamilyBlurayWeb, Rule: rule, Enabled: true, OriginalChoice: scoring.OriginalReject}
		p.MinHeight, p.MaxHeight = scoring.HeightBounds(uhd, isAny)
		return p
	}
	return []Profile{
		mk("hd-primary", "HD", false, false, scoring.PrimaryLanguage),
		mk("hd-original", "HD Original", false, false, scoring.OriginalLanguage),
		mk("any-primary", "Any", false, true, scoring.PrimaryLanguage),
		mk("any-original", "Any Original", false, true, scoring.OriginalLanguage),
		mk("4k-primary", "4K", true, false, scoring.PrimaryLanguage),
		mk("4k-original", "4K Original", true, false, scoring.OriginalLanguage),
	}
}

// ErrNoEnabledProfile means the Slot has no enabled default Profile for the kind, so a Request
// for it is rejected `no_enabled_profile`.
var ErrNoEnabledProfile = errors.New("no enabled Profile")

// Resolve picks the Profile for a new Version in a Slot when the caller named none (ADR 0024):
// the Slot, then the kind, then the Slot's default Profile. It returns ErrNoEnabledProfile when
// the Slot has no default for the kind or its default is disabled.
func Resolve(all []Profile, kind release.Kind, sl slot.Record) (Profile, error) {
	key := sl.Default(kind)
	for _, p := range all {
		if p.Enabled && p.Key == key {
			return p, nil
		}
	}
	return Profile{}, ErrNoEnabledProfile
}

// ResolveAccepting is Resolve for a file already in hand: when the Slot's
// Profile would not accept the file, it picks the enabled Any Profile with the
// same language rule if that accepts it, else the Slot's Profile as Resolve gave it.
// This is how Adoption files a 576p file under Any.
func ResolveAccepting(all []Profile, kind release.Kind, sl slot.Record, accepts func(Profile) bool) (Profile, error) {
	r, err := Resolve(all, kind, sl)
	if err != nil || accepts(r) || r.UHD() { // Any takes SD to 1080p: it is no stand-in for a 4K default
		return r, err
	}
	for _, p := range all {
		if p.Enabled && p.Any && p.Rule == r.Rule && p.Named == r.Named && accepts(p) {
			return p, nil
		}
	}
	return r, nil
}

// Why a Profile named for a Version is refused.
var (
	ErrNoSuchProfile = errors.New("no such Profile")
	ErrDisabled      = errors.New("that Profile is disabled")
)

// ErrWrongKind means the Profile applies to the other kind only: a Movies-only Profile (SQP, French Remux) cannot
// be a Series' Version or a Series default (spec #304).
var ErrWrongKind = errors.New("that Profile does not apply to that kind")

// PickFor is Pick for a Version of a kind: the Profile must also apply to the kind (ErrWrongKind).
func PickFor(all []Profile, key string, kind release.Kind) (Profile, error) {
	p, err := Pick(all, key)
	if err == nil && !p.AppliesTo(kind) {
		return Profile{}, ErrWrongKind
	}
	return p, err
}

// OutOfKind is the Titles, by id, whose kind the Profile does not apply to: a Movies-only Profile cannot serve a Series.
func OutOfKind(p Profile, kinds map[int64]release.Kind) map[int64]bool {
	out := map[int64]bool{}
	for id, k := range kinds {
		if !p.AppliesTo(k) {
			out[id] = true
		}
	}
	return out
}

// Pick finds the Profile with the key and checks it can be used: it exists and is enabled.
// Any Profile can fill any Slot.
func Pick(all []Profile, key string) (Profile, error) {
	for _, p := range all {
		if p.Key != key {
			continue
		}
		if !p.Enabled {
			return Profile{}, ErrDisabled
		}
		return p, nil
	}
	return Profile{}, ErrNoSuchProfile
}
