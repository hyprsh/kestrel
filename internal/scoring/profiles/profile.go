// Package profiles, part of the scoring module, owns the six builtin Profiles and the household's
// language settings: the Primary Language and the release-date country. It
// holds the pure helpers other modules share: Profile resolution.
//
// Nothing branches on a Profile's key: behaviour comes from the fields (Any,
// resolution range, language rule, enabled). The keys only name the rows.
package profiles

import (
	"errors"

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
	Any  bool
	Rule scoring.LanguageRule
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
	return scoring.ProfileSpec{
		UHD: p.UHD(), Any: p.Any, Rule: p.Rule, Primary: primary, OriginalChoice: p.OriginalChoice, Overlay: p.overlay(),
	}
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
		p := Profile{Key: key, Name: name, Any: isAny, Rule: rule, Enabled: true, OriginalChoice: scoring.OriginalReject}
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
		if p.Enabled && p.Any && p.Rule == r.Rule && accepts(p) {
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
