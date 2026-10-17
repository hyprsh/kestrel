package scoring

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/dlclark/regexp2"
	"github.com/hyprsh/kestrel/internal/release"
)

// MatchTimeout bounds every Custom Format regex match (ADR 0006). A match that
// times out counts as no match and logs a warning. It is read when a snapshot
// is loaded.
var MatchTimeout = 100 * time.Millisecond

// Flags are the indexer flags Kestrel knows. Usenet indexers only ever set
// Scene and Nuked, so Freeleech and Internal never match on usenet; they are
// kept for the Torznab seam.
type Flags uint8

const (
	FlagFreeleech Flags = 1 << iota
	FlagInternal
	FlagScene
	FlagNuked
)

// releaseType is what Sonarr's Release Type condition tests, numbered as in
// Sonarr's ReleaseType enum.
type releaseType int

const (
	releaseTypeUnknown releaseType = iota
	releaseTypeSingleEpisode
	releaseTypeMultiEpisode
	releaseTypeSeasonPack
)

func releaseTypeOf(t release.SeriesReleaseType) releaseType {
	switch t {
	case release.SeriesReleaseSingleEpisode:
		return releaseTypeSingleEpisode
	case release.SeriesReleaseMultiEpisode:
		return releaseTypeMultiEpisode
	case release.SeriesReleaseSeasonPack:
		return releaseTypeSeasonPack
	}
	return releaseTypeUnknown
}

// input is everything a Custom Format condition can look at, assembled once
// per Evaluate.
type input struct {
	kind         release.Kind
	releaseTitle string // what Release Title conditions match (Radarr: simplified title)
	filename     string
	group        string // empty means none: Radarr's null
	edition      string
	quality      release.Quality
	languages    []release.Language
	originalLang release.Language
	flags        Flags
	size         int64
	year         int
	releaseType  releaseType
}

type rawSpec struct {
	Name           string          `json:"name"`
	Implementation string          `json:"implementation"`
	Negate         bool            `json:"negate"`
	Required       bool            `json:"required"`
	Fields         json.RawMessage `json:"fields"`
}

type rawFields struct {
	Value          json.RawMessage `json:"value"`
	ExceptLanguage bool            `json:"exceptLanguage"`
	Min            float64         `json:"min"`
	Max            float64         `json:"max"`
}

// spec is one compiled condition. Conditions of the same implementation are
// grouped when a Custom Format is evaluated.
type spec struct {
	impl     string
	negate   bool
	required bool
	// test reports whether the condition holds before negation. ok is false
	// when it could not be decided (a regex timed out): the condition then
	// counts as not matched, negated or not.
	test func(in *input) (matched, ok bool)
}

func (s *spec) satisfiedBy(in *input) bool {
	m, ok := s.test(in)
	if !ok {
		return false
	}
	return m != s.negate
}

// matches ports SpecificationMatchesGroup and CustomFormatCalculationService:
// conditions are grouped by implementation, a group matches unless a required
// condition is false or every condition is false, and the Custom Format
// matches when every group does.
func (c *customFormat) matches(in *input) bool {
	type result struct {
		anyTrue, requiredFalse bool
	}
	order := make([]string, 0, 4)
	groups := map[string]*result{}
	for _, s := range c.specs {
		r, ok := groups[s.impl]
		if !ok {
			r = &result{}
			groups[s.impl] = r
			order = append(order, s.impl)
		}
		if s.satisfiedBy(in) {
			r.anyTrue = true
		} else if s.required {
			r.requiredFalse = true
		}
	}
	for _, impl := range order {
		r := groups[impl]
		if r.requiredFalse || !r.anyTrue {
			return false
		}
	}
	return true
}

func compileSpec(rs rawSpec, kind release.Kind) (*spec, error) {
	var f rawFields
	if len(rs.Fields) > 0 {
		if err := json.Unmarshal(rs.Fields, &f); err != nil {
			return nil, fmt.Errorf("fields: %w", err)
		}
	}
	sp := &spec{impl: rs.Implementation, negate: rs.Negate, required: rs.Required}

	intValue := func() (int, error) {
		var v int
		if err := json.Unmarshal(f.Value, &v); err != nil {
			return 0, fmt.Errorf("%s needs an integer value, got %s", rs.Implementation, string(f.Value))
		}
		return v, nil
	}
	regexValue := func() (*regexp2.Regexp, error) {
		var pat string
		if err := json.Unmarshal(f.Value, &pat); err != nil {
			return nil, fmt.Errorf("%s needs a regex value, got %s", rs.Implementation, string(f.Value))
		}
		if pat == "" {
			return nil, nil // Radarr never compiles an empty value: it matches nothing
		}
		re, err := regexp2.Compile(pat, regexp2.IgnoreCase)
		if err != nil {
			return nil, fmt.Errorf("regex %q does not compile: %w", pat, err)
		}
		re.MatchTimeout = MatchTimeout
		return re, nil
	}

	switch rs.Implementation {
	case "ReleaseTitleSpecification":
		re, err := regexValue()
		if err != nil {
			return nil, err
		}
		sp.test = func(in *input) (bool, bool) {
			if m, ok := regexMatch(re, in.releaseTitle, true); m || !ok {
				return m, ok
			}
			return regexMatch(re, in.filename, in.filename != "")
		}
	case "ReleaseGroupSpecification":
		re, err := regexValue()
		if err != nil {
			return nil, err
		}
		sp.test = func(in *input) (bool, bool) { return regexMatch(re, in.group, in.group != "") }
	case "EditionSpecification":
		if kind != release.KindMovie {
			return nil, unknownCondition(rs.Implementation, kind)
		}
		re, err := regexValue()
		if err != nil {
			return nil, err
		}
		sp.test = func(in *input) (bool, bool) { return regexMatch(re, in.edition, true) }
	case "LanguageSpecification":
		v, err := intValue()
		if err != nil {
			return nil, err
		}
		sp.test = func(in *input) (bool, bool) { return languageMatches(v, f.ExceptLanguage, in), true }
	case "SourceSpecification":
		v, err := intValue()
		if err != nil {
			return nil, err
		}
		want, err := sourceFor(kind, v)
		if err != nil {
			return nil, err
		}
		sp.test = func(in *input) (bool, bool) { return in.quality.Source == want, true }
	case "ResolutionSpecification":
		v, err := intValue()
		if err != nil {
			return nil, err
		}
		sp.test = func(in *input) (bool, bool) { return in.quality.Resolution == v, true }
	case "QualityModifierSpecification":
		if kind != release.KindMovie {
			return nil, unknownCondition(rs.Implementation, kind)
		}
		v, err := intValue()
		if err != nil {
			return nil, err
		}
		if v < 0 || v > int(release.ModifierRemux) {
			return nil, fmt.Errorf("invalid quality modifier condition value %d", v)
		}
		sp.test = func(in *input) (bool, bool) { return int(in.quality.Modifier) == v, true }
	case "IndexerFlagSpecification":
		v, err := intValue()
		if err != nil {
			return nil, err
		}
		mask := flagFor(kind, v)
		sp.test = func(in *input) (bool, bool) { return mask != 0 && in.flags&mask == mask, true }
	case "SizeSpecification":
		min, max := f.Min*gigabyte, f.Max*gigabyte
		sp.test = func(in *input) (bool, bool) { return float64(in.size) > min && float64(in.size) <= max, true }
	case "YearSpecification":
		if kind != release.KindMovie {
			return nil, unknownCondition(rs.Implementation, kind)
		}
		min, max := int(f.Min), int(f.Max)
		sp.test = func(in *input) (bool, bool) { return in.year != 0 && in.year >= min && in.year <= max, true }
	case "ReleaseTypeSpecification":
		if kind != release.KindSeries {
			return nil, unknownCondition(rs.Implementation, kind)
		}
		v, err := intValue()
		if err != nil {
			return nil, err
		}
		if v < 0 || v > int(releaseTypeSeasonPack) {
			return nil, fmt.Errorf("invalid release type condition value %d", v)
		}
		sp.test = func(in *input) (bool, bool) { return int(in.releaseType) == v, true }
	default:
		return nil, unknownCondition(rs.Implementation, kind)
	}
	return sp, nil
}

const gigabyte = 1024 * 1024 * 1024

func unknownCondition(impl string, kind release.Kind) error {
	return fmt.Errorf("unknown condition type %q for %s", impl, kind)
}

// regexMatch matches s, treating a missing value (present false) or an empty
// pattern as no match. ok is false when the match timed out.
func regexMatch(re *regexp2.Regexp, s string, present bool) (matched, ok bool) {
	if re == nil || !present {
		return false, true
	}
	m, err := re.MatchString(s)
	if err != nil {
		slog.Warn("custom format regex timed out, treating as no match", "pattern", re.String(), "error", err)
		return false, false
	}
	return m, true
}

// languageMatches ports LanguageSpecification: the Original pseudo-language
// stands for the Title's Original Language when that is known.
func languageMatches(value int, except bool, in *input) bool {
	compared := release.Language{ID: value}
	if value == release.LangOriginal.ID && in.originalLang != release.LangUnknown {
		compared = in.originalLang
	}
	for _, l := range in.languages {
		if except {
			if l.ID != compared.ID {
				return true
			}
		} else if l.ID == compared.ID {
			return true
		}
	}
	return false
}

// sourceFor maps an app's Source condition code to Kestrel's enum. The per-app
// codes exist only here, at load time.
func sourceFor(kind release.Kind, code int) (release.Source, error) {
	if kind == release.KindMovie {
		if code < int(release.SourceUnknown) || code > int(release.SourceBluray) {
			return 0, fmt.Errorf("invalid source condition value %d", code)
		}
		return release.Source(code), nil // Radarr's QualitySource order is Kestrel's
	}
	switch code {
	case 0:
		return release.SourceUnknown, nil
	case 1:
		return release.SourceTV, nil
	case 2:
		return release.SourceTVRaw, nil
	case 3:
		return release.SourceWebDL, nil
	case 4:
		return release.SourceWebRip, nil
	case 5:
		return release.SourceDVD, nil
	case 6:
		return release.SourceBluray, nil
	case 7:
		return release.SourceBlurayRaw, nil
	}
	return 0, fmt.Errorf("invalid source condition value %d", code)
}

// flagFor maps an app's indexer flag bit to Kestrel's flags; 0 means a flag
// Kestrel never sees, which never matches.
func flagFor(kind release.Kind, bit int) Flags {
	if kind == release.KindMovie {
		switch bit {
		case 1:
			return FlagFreeleech
		case 32:
			return FlagInternal
		case 128:
			return FlagScene
		case 2048:
			return FlagNuked
		}
		return 0
	}
	switch bit {
	case 1:
		return FlagFreeleech
	case 8:
		return FlagInternal
	case 16:
		return FlagScene
	case 128:
		return FlagNuked
	}
	return 0
}
