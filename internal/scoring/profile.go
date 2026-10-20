package scoring

import (
	"errors"
	"fmt"
	"slices"

	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/resolution"
	"github.com/hyprsh/kestrel/internal/slot"
)

// LanguageRule says which audio a Profile requires.
type LanguageRule int

const (
	// PrimaryLanguage requires the household's Primary Language.
	PrimaryLanguage LanguageRule = iota
	// OriginalLanguage requires the Title's Original Language.
	OriginalLanguage
)

// OriginalChoice is what a Primary-Language Profile does with a Release that
// has the Title's Original Language but no Primary-Language audio: reject it,
// offer it to the admin (an Original Offer) or accept it like any other.
type OriginalChoice string

const (
	OriginalReject OriginalChoice = "reject"
	OriginalOffer  OriginalChoice = "offer"
	OriginalAccept OriginalChoice = "accept"
)

// Valid reports whether c is one of the three choices.
func (c OriginalChoice) Valid() bool {
	return c == OriginalReject || c == OriginalOffer || c == OriginalAccept
}

// DeprecatedFlag is what the deprecated original_fallback says for c: true for
// accept only.
func (c OriginalChoice) DeprecatedFlag() bool { return c == OriginalAccept }

// ErrOriginalChoiceDisagrees says a declaration gives both original_language
// and the deprecated original_fallback, and they disagree.
var ErrOriginalChoiceDisagrees = errors.New("original_fallback disagrees with original_language")

// OriginalChoiceOf is the choice a Profile declares by original_language, or
// else by the deprecated original_fallback (true is accept, false reject); nil
// when neither is given. Given both, they must agree (see DeprecatedFlag), else the
// error is ErrOriginalChoiceDisagrees.
func OriginalChoiceOf(choice *OriginalChoice, deprecated *bool) (*OriginalChoice, error) {
	if choice == nil {
		if deprecated == nil {
			return nil, nil
		}
		c := OriginalReject
		if *deprecated {
			c = OriginalAccept
		}
		return &c, nil
	}
	if deprecated != nil && *deprecated != choice.DeprecatedFlag() {
		return nil, ErrOriginalChoiceDisagrees
	}
	return choice, nil
}

// ProfileSpec describes a Kestrel Profile: which Slot it fills, which audio it
// requires and, for Primary-Language Profiles, what it does with a Release in
// the Title's Original Language only (PRD Settled 1, #103).
type ProfileSpec struct {
	// Slot is Standard or 4K. Any Profiles sit in the Standard Slot.
	Slot slot.Slot
	// Any marks an Any Profile, which sits in the Standard Slot but accepts
	// SD too.
	Any  bool
	Rule LanguageRule
	// Primary is the household's Primary Language: English, German or French.
	Primary release.Language
	// OriginalChoice is what happens to a Release with the Title's Original
	// Language but no Primary audio; the zero value rejects it. Only
	// meaningful with PrimaryLanguage.
	OriginalChoice OriginalChoice
}

// HeightBounds are the resolution bounds of a builtin Profile (Settled 2),
// derived from the Slot's range: an Any Profile takes the whole Standard
// range, HD (the other Standard Profiles) starts at 720 and 4K takes its
// Slot's range. They always lie inside the Slot.
func HeightBounds(s slot.Slot, isAny bool) (min, max int) {
	lo, hi := s.Range()
	if s == slot.Standard && !isAny {
		lo = 720
	}
	return lo, hi
}

// ErrUnsupportedProfile means no TRaSH backing profile exists for the spec.
var ErrUnsupportedProfile = errors.New("no TRaSH profile backs this Profile")

// Profile is a ProfileSpec resolved against a Snapshot: for Movies and for
// Series, the backing TRaSH profile, its Custom Formats with their scores and
// the allowed qualities.
type Profile struct {
	spec ProfileSpec
	// MinHeight and MaxHeight bound the resolutions the Profile accepts
	// (Settled 2): HD 720-1080, Any 0-1080, 4K 2160-2160.
	MinHeight, MaxHeight int
	sets                 map[release.Kind]*formatSet
}

type scoredFormat struct {
	cf    *customFormat
	score int
}

type formatSet struct {
	backing   string
	backingID string
	minScore  int
	formats   []scoredFormat
	qualities []string
}

// Spec returns the ProfileSpec the Profile was resolved from.
func (p *Profile) Spec() ProfileSpec { return p.spec }

// Classes lists the resolution classes the Profile accepts.
func (p *Profile) Classes() []resolution.Class {
	var out []resolution.Class
	for _, c := range []resolution.Class{resolution.SD, resolution.HD, resolution.UHD} {
		if c.Within(p.MinHeight, p.MaxHeight) {
			out = append(out, c)
		}
	}
	return out
}

// MinScore is the minimum Score of the backing profile for a kind (inclusive).
func (p *Profile) MinScore(kind release.Kind) int {
	if s := p.sets[kind]; s != nil {
		return s.minScore
	}
	return 0
}

// BackingProfile is the file name (without .json) of the TRaSH profile the
// Profile's Custom Formats come from, for a kind.
func (p *Profile) BackingProfile(kind release.Kind) string {
	if s := p.sets[kind]; s != nil {
		return s.backing
	}
	return ""
}

// Formats lists the Custom Formats the Profile scores for a kind, with their
// scores, in no particular order.
func (p *Profile) Formats(kind release.Kind) []MatchedFormat {
	s := p.sets[kind]
	if s == nil {
		return nil
	}
	out := make([]MatchedFormat, 0, len(s.formats))
	for _, f := range s.formats {
		out = append(out, MatchedFormat{TrashID: f.cf.id, Name: f.cf.name, Score: f.score})
	}
	return out
}

// AllowedQualities lists the quality names the Profile allows for a kind. Any
// derives them from the HD backing profile (Settled 5).
func (p *Profile) AllowedQualities(kind release.Kind) []string {
	if s := p.sets[kind]; s != nil {
		return slices.Clone(s.qualities)
	}
	return nil
}

// Profile resolves a ProfileSpec against the snapshot. Any Profiles
// are derived from the HD backing profile: same Custom Formats and scores,
// different allowed qualities and resolution bounds.
func (s *Snapshot) Profile(spec ProfileSpec) (*Profile, error) {
	if spec.Any && spec.Slot != slot.Standard {
		return nil, fmt.Errorf("%w: Any sits in the Standard Slot", ErrUnsupportedProfile)
	}
	if spec.Rule == OriginalLanguage {
		spec.OriginalChoice = OriginalReject // no choice on Original-Language Profiles
	}
	p := &Profile{spec: spec, sets: map[release.Kind]*formatSet{}}
	p.MinHeight, p.MaxHeight = HeightBounds(spec.Slot, spec.Any)
	for _, a := range apps {
		d := s.apps[a.kind]
		name, err := backingName(spec, a.kind)
		if err != nil {
			return nil, err
		}
		bp, ok := d.profiles[name]
		if !ok {
			return nil, fmt.Errorf("%w: %s profile %q is not in the snapshot", ErrUnsupportedProfile, a.dir, name)
		}
		set := &formatSet{backing: name, backingID: bp.id, minScore: bp.minScore}
		set.formats = d.formatsFor(bp)
		set.qualities = derivedQualities(spec, a.kind, bp.qualities)
		p.sets[a.kind] = set
	}
	return p, nil
}

// formatsFor resolves the Custom Format set of a backing profile the way
// Recyclarr does: every formatItems entry, plus the required and default
// Custom Formats of every default CF group that includes the profile. Scores
// come from the profile's score set, else the default set.
func (d *appData) formatsFor(bp *backingProfile) []scoredFormat {
	seen := map[string]bool{}
	var out []scoredFormat
	add := func(id string) {
		if seen[id] {
			return
		}
		seen[id] = true
		cf := d.cfs[id]
		out = append(out, scoredFormat{cf: cf, score: cf.scoreIn(bp.scoreSet)})
	}
	for _, id := range bp.formatItems {
		add(id)
	}
	for _, g := range d.groups {
		if !g.isDefault || !g.include[bp.id] {
			continue
		}
		for _, f := range g.formats {
			if f.required || f.def {
				add(f.id)
			}
		}
	}
	return out
}

// backingName is the Settled 5 table: the TRaSH profile file backing a
// (Primary Language, language rule, kind, Slot). Any uses the HD file.
func backingName(spec ProfileSpec, kind release.Kind) (string, error) {
	uhd := spec.Slot == slot.FourK
	pick := func(hd, uhdName string) string {
		if uhd {
			return uhdName
		}
		return hd
	}
	english := func() string {
		if kind == release.KindMovie {
			return pick("hd-bluray-web", "uhd-bluray-web")
		}
		return pick("web-1080p", "web-2160p")
	}
	switch spec.Primary {
	case release.LangEnglish:
		return english(), nil
	case release.LangGerman:
		if spec.Rule == OriginalLanguage {
			return english(), nil
		}
		return pick("german-hd-bluray-web", "german-uhd-bluray-web"), nil
	case release.LangFrench:
		variant := "vf"
		if spec.Rule == OriginalLanguage {
			variant = "vo"
		}
		if kind == release.KindMovie {
			return pick("french-multi-"+variant+"-hd-bluray-web", "french-multi-"+variant+"-uhd-bluray-web"), nil
		}
		return pick("french-multi-"+variant+"-bluray-web-1080p", "french-multi-"+variant+"-bluray-web-2160p"), nil
	}
	return "", fmt.Errorf("%w: Primary Language %q", ErrUnsupportedProfile, spec.Primary.Name)
}

var sdQualities = []string{"SDTV", "DVD", "WEBDL-480p", "WEBRip-480p", "Bluray-480p", "Bluray-576p"}

// derivedQualities gives the allowed qualities of a Profile: 4K and HD keep
// the backing profile's, Any adds the SD qualities
// to HD's (for Series it also widens to WEB 480p/720p/1080p, DVD and SDTV).
func derivedQualities(spec ProfileSpec, kind release.Kind, backing []string) []string {
	switch {
	case spec.Any:
		out := slices.Clone(backing)
		extra := sdQualities
		if kind == release.KindSeries {
			extra = append(slices.Clone(sdQualities), "WEBDL-720p", "WEBRip-720p", "WEBDL-1080p", "WEBRip-1080p")
		}
		for _, q := range extra {
			if !slices.Contains(out, q) {
				out = append(out, q)
			}
		}
		return out
	}
	return slices.Clone(backing)
}
