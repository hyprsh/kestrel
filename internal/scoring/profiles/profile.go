// Package profiles, part of the scoring module, owns the eight builtin Profiles and the household's
// language settings: the Primary Language and the release-date country. It
// holds the pure helpers other modules share: Profile resolution.
//
// Nothing branches on a Profile's key: behaviour comes from the fields (Slot,
// Any, language rule, enabled, defaults). The keys only name the rows.
package profiles

import (
	"errors"

	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/resolution"
	"github.com/hyprsh/kestrel/internal/scoring"
)

// Profile is one of the eight builtin Profiles with its per-Profile settings.
type Profile struct {
	Key  string
	Name string
	// Slot is the Slot the Profile fills; Any sits in HD but also accepts SD.
	Slot resolution.Class
	Any  bool
	Rule scoring.LanguageRule
	// MinHeight and MaxHeight bound the resolutions it accepts (Settled 2).
	MinHeight, MaxHeight int

	Enabled bool
	// OriginalFallback is only ever true on Primary-Language Profiles.
	OriginalFallback bool
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
		Slot: p.Slot, Any: p.Any, Rule: p.Rule, Primary: primary, OriginalFallback: p.OriginalFallback,
	}
}

// Builtin returns the eight Profiles as shipped: all enabled, HD the default
// of both kinds, no fallback. Backing TRaSH names are the English household's.
func Builtin() []Profile {
	mk := func(key, name string, slot resolution.Class, any bool, rule scoring.LanguageRule) Profile {
		p := Profile{Key: key, Name: name, Slot: slot, Any: any, Rule: rule, Enabled: true}
		if any {
			p.MinHeight, p.MaxHeight = 0, 1080
		} else {
			p.MinHeight, p.MaxHeight = slot.Range()
		}
		return p
	}
	out := []Profile{
		mk("sd-primary", "SD", resolution.SD, false, scoring.PrimaryLanguage),
		mk("sd-original", "SD Original", resolution.SD, false, scoring.OriginalLanguage),
		mk("hd-primary", "HD", resolution.HD, false, scoring.PrimaryLanguage),
		mk("hd-original", "HD Original", resolution.HD, false, scoring.OriginalLanguage),
		mk("any-primary", "Any", resolution.HD, true, scoring.PrimaryLanguage),
		mk("any-original", "Any Original", resolution.HD, true, scoring.OriginalLanguage),
		mk("uhd-primary", "UHD", resolution.UHD, false, scoring.PrimaryLanguage),
		mk("uhd-original", "UHD Original", resolution.UHD, false, scoring.OriginalLanguage),
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

// Resolved is the outcome of Profile resolution.
type Resolved struct {
	Profile
}

// Resolve picks the Profile for a Slot when the caller named none (PRD
// Settled 8): the Slot's default for the kind, else the enabled
// Primary-Language Profile of the Slot, else the enabled Original-Language
// Profile. An Any Profile is only ever the Slot's default, never a fallback.
// It returns ErrNoEnabledProfile when the Slot has nothing enabled.
func Resolve(all []Profile, kind release.Kind, slot resolution.Class) (Resolved, error) {
	pick := func(match func(Profile) bool) (Profile, bool) {
		for _, p := range all {
			if p.Enabled && p.Slot == slot && match(p) {
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
		return Resolved{}, ErrNoEnabledProfile
	}
	return Resolved{Profile: p}, nil
}

// ResolveAccepting is Resolve for a file already in hand: when the Slot's
// Profile would not accept the file, it picks the enabled Any Profile of the
// Slot with the same language rule if that accepts it, else the Slot's Profile
// as Resolve gave it. This is how Adoption files a 576p file in HD under Any.
func ResolveAccepting(all []Profile, kind release.Kind, slot resolution.Class, accepts func(Profile) bool) (Resolved, error) {
	r, err := Resolve(all, kind, slot)
	if err != nil || accepts(r.Profile) {
		return r, err
	}
	for _, p := range all {
		if p.Enabled && p.Any && p.Slot == slot && p.Rule == r.Rule && accepts(p) {
			return Resolved{Profile: p}, nil
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
func Pick(all []Profile, key string, slot resolution.Class) (Profile, error) {
	for _, p := range all {
		if p.Key != key {
			continue
		}
		switch {
		case p.Slot != slot:
			return Profile{}, ErrWrongSlot
		case !p.Enabled:
			return Profile{}, ErrDisabled
		}
		return p, nil
	}
	return Profile{}, ErrNoSuchProfile
}
