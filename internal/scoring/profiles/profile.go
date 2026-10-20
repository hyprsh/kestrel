// Package profiles, part of the scoring module, owns the six builtin Profiles and the household's
// language settings: the Primary Language and the release-date country. It
// holds the pure helpers other modules share: Profile resolution.
//
// Nothing branches on a Profile's key: behaviour comes from the fields (Slot,
// Any, language rule, enabled, defaults). The keys only name the rows.
package profiles

import (
	"errors"

	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/slot"
)

// Profile is one of the six builtin Profiles with its per-Profile settings.
type Profile struct {
	Key  string
	Name string
	// Slot is the Slot the Profile fills; Any sits in Standard but also accepts SD.
	Slot slot.Slot
	Any  bool
	Rule scoring.LanguageRule
	// MinHeight and MaxHeight bound the resolutions it accepts (Settled 2).
	MinHeight, MaxHeight int

	Enabled bool
	// OriginalLanguage is what the Profile does with a Release in the Title's
	// Original Language only; always reject on Original-Language Profiles.
	OriginalLanguage scoring.OriginalChoice
	DefaultMovies    bool
	DefaultSeries    bool

	// TrashMovies and TrashSeries name the TRaSH profile files (without .json)
	// backing the Profile under the current Primary Language (Settled 5).
	TrashMovies, TrashSeries string
}

// Default reports whether the Profile is the default of its Slot for a kind.
func (p Profile) Default(kind release.Kind) bool {
	if kind == release.KindSeries {
		return p.DefaultSeries
	}
	return p.DefaultMovies
}

// Spec is the scoring.ProfileSpec of the Profile under a Primary Language.
func (p Profile) Spec(primary release.Language) scoring.ProfileSpec {
	return scoring.ProfileSpec{
		Slot: p.Slot, Any: p.Any, Rule: p.Rule, Primary: primary, Original: p.OriginalLanguage,
	}
}

// Builtin returns the six Profiles as shipped: all enabled, HD the default
// of both kinds, Original-only Releases rejected. Backing TRaSH names are the English household's.
func Builtin() []Profile {
	mk := func(key, name string, sl slot.Slot, isAny bool, rule scoring.LanguageRule) Profile {
		p := Profile{Key: key, Name: name, Slot: sl, Any: isAny, Rule: rule, Enabled: true, OriginalLanguage: scoring.OriginalReject}
		p.MinHeight, p.MaxHeight = scoring.HeightBounds(sl, isAny)
		return p
	}
	out := []Profile{
		mk("hd-primary", "HD", slot.Standard, false, scoring.PrimaryLanguage),
		mk("hd-original", "HD Original", slot.Standard, false, scoring.OriginalLanguage),
		mk("any-primary", "Any", slot.Standard, true, scoring.PrimaryLanguage),
		mk("any-original", "Any Original", slot.Standard, true, scoring.OriginalLanguage),
		mk("4k-primary", "4K", slot.FourK, false, scoring.PrimaryLanguage),
		mk("4k-original", "4K Original", slot.FourK, false, scoring.OriginalLanguage),
	}
	for i := range out {
		if out[i].Key == "hd-primary" {
			out[i].DefaultMovies, out[i].DefaultSeries = true, true
		}
	}
	return out
}

// ErrNoEnabledProfile means no Profile in the Slot is enabled, so a Request
// for it is rejected `no_enabled_profile`.
var ErrNoEnabledProfile = errors.New("no enabled Profile")

// Resolve picks the Profile for a Slot when the caller named none (PRD
// Settled 8): the Slot's default for the kind, else the enabled
// Primary-Language Profile of the Slot, else the enabled Original-Language
// Profile. An Any Profile is only ever the Slot's default, never a fallback.
// It returns ErrNoEnabledProfile when the Slot has nothing enabled.
func Resolve(all []Profile, kind release.Kind, sl slot.Slot) (Profile, error) {
	pick := func(match func(Profile) bool) (Profile, bool) {
		for _, p := range all {
			if p.Enabled && p.Slot == sl && match(p) {
				return p, true
			}
		}
		return Profile{}, false
	}
	p, ok := pick(func(p Profile) bool { return p.Default(kind) })
	if !ok {
		p, ok = pick(func(p Profile) bool { return !p.Any && p.Rule == scoring.PrimaryLanguage })
	}
	if !ok {
		p, ok = pick(func(p Profile) bool { return !p.Any && p.Rule == scoring.OriginalLanguage })
	}
	if !ok {
		return Profile{}, ErrNoEnabledProfile
	}
	return p, nil
}

// ResolveAccepting is Resolve for a file already in hand: when the Slot's
// Profile would not accept the file, it picks the enabled Any Profile of the
// Slot with the same language rule if that accepts it, else the Slot's Profile
// as Resolve gave it. This is how Adoption files a 576p file in Standard under Any.
func ResolveAccepting(all []Profile, kind release.Kind, sl slot.Slot, accepts func(Profile) bool) (Profile, error) {
	r, err := Resolve(all, kind, sl)
	if err != nil || accepts(r) {
		return r, err
	}
	for _, p := range all {
		if p.Enabled && p.Any && p.Slot == sl && p.Rule == r.Rule && accepts(p) {
			return p, nil
		}
	}
	return r, nil
}

// Why a Profile named for a Slot is refused.
var (
	ErrNoSuchProfile = errors.New("no such Profile")
	ErrWrongSlot     = errors.New("that Profile belongs to another Slot")
	ErrDisabled      = errors.New("that Profile is disabled")
)

// Pick finds the Profile with the key and checks it can fill the Slot: it
// exists, belongs to the Slot and is enabled.
func Pick(all []Profile, key string, sl slot.Slot) (Profile, error) {
	for _, p := range all {
		if p.Key != key {
			continue
		}
		switch {
		case p.Slot != sl:
			return Profile{}, ErrWrongSlot
		case !p.Enabled:
			return Profile{}, ErrDisabled
		}
		return p, nil
	}
	return Profile{}, ErrNoSuchProfile
}
