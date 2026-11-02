package scoring

import (
	"errors"
	"fmt"
	"slices"

	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/resolution"
)

// LanguageRule says which audio a Profile requires.
type LanguageRule int

const (
	// PrimaryLanguage requires the household's Primary Language.
	PrimaryLanguage LanguageRule = iota
	// OriginalLanguage requires the Title's Original Language.
	OriginalLanguage
	// NamedLanguage requires one named language (ProfileSpec.Language), whatever the household's
	// Primary Language is (ADR 0026).
	NamedLanguage
)

// ReleaseFamily is which kind of Releases a Profile goes after, as TRaSH groups them (ADR 0026).
// The empty value is Bluray + WEB.
type ReleaseFamily string

const (
	FamilyBlurayWeb ReleaseFamily = "bluray-web"
	FamilyRemuxWeb  ReleaseFamily = "remux-web"
	FamilyWeb       ReleaseFamily = "web"
	FamilySQP       ReleaseFamily = "sqp"
)

// ReleaseFamilies lists the families in display order.
var ReleaseFamilies = []ReleaseFamily{FamilyBlurayWeb, FamilyRemuxWeb, FamilyWeb, FamilySQP}

// Valid reports whether f is one of the four families.
func (f ReleaseFamily) Valid() bool { return slices.Contains(ReleaseFamilies, f) }

// Name is the family as people say it.
func (f ReleaseFamily) Name() string {
	switch f.OrDefault() {
	case FamilyRemuxWeb:
		return "Remux + WEB"
	case FamilyWeb:
		return "WEB"
	case FamilySQP:
		return "SQP"
	}
	return "Bluray + WEB"
}

// OrDefault is f, or Bluray + WEB for the empty value.
func (f ReleaseFamily) OrDefault() ReleaseFamily {
	if f == "" {
		return FamilyBlurayWeb
	}
	return f
}

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

// ProfileSpec describes a Kestrel Profile: which resolutions it takes, which audio it
// requires and, for Primary-Language Profiles, what it does with a Release in
// the Title's Original Language only (PRD Settled 1).
type ProfileSpec struct {
	// UHD marks a Profile that takes only 4K; it is backed by the UHD TRaSH profile.
	UHD bool
	// Any marks an Any Profile, which accepts SD too, up to 1080p.
	Any bool
	// Family is the Release Family; the empty value is Bluray + WEB.
	Family ReleaseFamily
	Rule   LanguageRule
	// Language is the named language of a NamedLanguage rule: English, German or French.
	Language release.Language
	// Primary is the household's Primary Language: English, German or French.
	Primary release.Language
	// OriginalChoice is what happens to a Release with the Title's Original
	// Language but no Primary audio; the zero value rejects it. Only
	// meaningful with PrimaryLanguage and NamedLanguage.
	OriginalChoice OriginalChoice
	// Overlay is what the household set on top of TRaSH's data (ADR 0023);
	// nil leaves TRaSH's order and acceptance and sets no limit.
	Overlay *Overlay
}

// HeightBounds are the resolution bounds of a builtin Profile (Settled 2),
// derived from the kind of Profile: an Any Profile takes 0 to 1080, HD starts
// at 720 and 4K takes exactly 2160. A custom Profile copies them.
func HeightBounds(uhd, isAny bool) (min, max int) {
	switch {
	case uhd:
		return 2160, 2160
	case isAny:
		return 0, 1080
	}
	return 720, 1080
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
	// trashMinScore is the backing TRaSH profile's, before the household's replaces minScore.
	trashMinScore int
	formats       []scoredFormat
	qualities     []string // the accepted quality names, as the Profile has them
	trash         []string // the quality names TRaSH accepts
	ladder        []QualityPref
	cutoff        string
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

// TrashMinScore is the minimum Score of the backing TRaSH profile for a kind,
// whatever the household set.
func (p *Profile) TrashMinScore(kind release.Kind) int {
	if s := p.sets[kind]; s != nil {
		return s.trashMinScore
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
	if spec.Any && spec.UHD {
		return nil, fmt.Errorf("%w: Any takes SD up to 1080p, not 4K", ErrUnsupportedProfile)
	}
	if !spec.Family.OrDefault().Valid() {
		return nil, fmt.Errorf("%w: no Release Family %q", ErrUnsupportedProfile, spec.Family)
	}
	if spec.Any && spec.Family.OrDefault() != FamilyBlurayWeb {
		return nil, fmt.Errorf("%w: Any is only Bluray + WEB", ErrUnsupportedProfile)
	}
	if spec.Rule == OriginalLanguage {
		spec.OriginalChoice = OriginalReject // no choice on Original-Language Profiles
	}
	p := &Profile{spec: spec, sets: map[release.Kind]*formatSet{}}
	p.MinHeight, p.MaxHeight = HeightBounds(spec.UHD, spec.Any)
	for _, a := range apps {
		d := s.apps[a.kind]
		name, ok := BackingProfile(spec, a.kind)
		if !ok {
			continue // the recipe does not apply to this kind
		}
		bp, ok := d.profiles[name]
		if !ok {
			return nil, fmt.Errorf("%w: %s profile %q is not in the snapshot", ErrUnsupportedProfile, a.dir, name)
		}
		set := &formatSet{backing: name, backingID: bp.id, minScore: bp.minScore, trashMinScore: bp.minScore}
		set.formats = d.formatsFor(bp)
		set.trash = derivedQualities(spec, a.kind, bp.qualities)
		ko := spec.Overlay.kind(a.kind)
		set.ladder = p.buildLadder(a.kind, set.trash, ko.Qualities)
		for _, q := range set.ladder {
			if q.Accepted {
				set.qualities = append(set.qualities, q.Name)
			}
		}
		set.cutoff = ko.Cutoff
		if spec.Overlay != nil && spec.Overlay.MinScore != nil {
			set.minScore = *spec.Overlay.MinScore
		}
		p.sets[a.kind] = set
	}
	if len(p.sets) == 0 {
		return nil, fmt.Errorf("%w: no TRaSH profile backs %s", ErrUnsupportedProfile, spec.describe())
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

// BackingProfile answers which TRaSH profile backs the recipe for a kind: the file name (without .json),
// or false when there is none (ADR 0026). Every other module asks this to decide what to offer; a recipe
// applies to the kinds that have one. It never falls back to another language, except for Original.
//
// The language is the household's for Primary and the named one for NamedLanguage. Original uses the
// household's VO variant where TRaSH has one (French: french-multi-vo-*, Bluray + WEB and Remux + WEB Movies),
// else the English profile. Any is Bluray + WEB, HD and SD only.
func BackingProfile(spec ProfileSpec, kind release.Kind) (string, bool) {
	family := spec.Family.OrDefault()
	if spec.Any && (family != FamilyBlurayWeb || spec.UHD) {
		return "", false
	}
	switch spec.Rule {
	case OriginalLanguage:
		if spec.Primary == release.LangFrench {
			if name, ok := backingIn(spec, family, kind, release.LangFrench, "vo"); ok {
				return name, true
			}
		}
		return backingIn(spec, family, kind, release.LangEnglish, "")
	case NamedLanguage:
		return backingIn(spec, family, kind, spec.Language, "vf")
	}
	return backingIn(spec, family, kind, spec.Primary, "vf")
}

// backingIn is the TRaSH profile of a family in a language (and, for French, the MULTi variant), or false.
func backingIn(spec ProfileSpec, family ReleaseFamily, kind release.Kind, lang release.Language, variant string) (string, bool) {
	pick := func(hd, uhd string) (string, bool) {
		if spec.UHD {
			return uhd, true
		}
		return hd, true
	}
	switch lang {
	case release.LangEnglish:
		switch family {
		case FamilyBlurayWeb:
			if kind == release.KindMovie {
				return pick("hd-bluray-web", "uhd-bluray-web")
			}
			return pick("web-1080p", "web-2160p")
		case FamilyRemuxWeb:
			return pick("remux-web-1080p", "remux-web-2160p")
		case FamilyWeb:
			return pick("web-1080p", "web-2160p")
		case FamilySQP:
			if kind == release.KindMovie {
				return pick("sqp-1-1080p", "sqp-1-2160p")
			}
		}
	case release.LangGerman:
		switch family {
		case FamilyBlurayWeb:
			return pick("german-hd-bluray-web", "german-uhd-bluray-web")
		case FamilyRemuxWeb:
			return pick("german-hd-remux-web", "german-uhd-remux-web")
		}
	case release.LangFrench:
		switch {
		case family == FamilyBlurayWeb && kind == release.KindMovie:
			return pick("french-multi-"+variant+"-hd-bluray-web", "french-multi-"+variant+"-uhd-bluray-web")
		case family == FamilyBlurayWeb:
			return pick("french-multi-"+variant+"-bluray-web-1080p", "french-multi-"+variant+"-bluray-web-2160p")
		case family == FamilyRemuxWeb && kind == release.KindMovie:
			return pick("french-multi-"+variant+"-hd-remux-web", "french-multi-"+variant+"-uhd-remux-web")
		}
	}
	return "", false
}

// describe names the recipe for an error.
func (s ProfileSpec) describe() string {
	rule := "the Primary Language " + s.Primary.Name
	switch s.Rule {
	case OriginalLanguage:
		rule = "the Original Language"
	case NamedLanguage:
		rule = s.Language.Name
	}
	res := "HD"
	switch {
	case s.UHD:
		res = "4K"
	case s.Any:
		res = "Any"
	}
	return fmt.Sprintf("%s, %s, %s", res, s.Family.Name(), rule)
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
