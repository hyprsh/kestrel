// Package scoring decides whether a Release suits a Profile and what it is
// worth, exactly as Radarr and Sonarr would score it with TRaSH's Custom
// Formats (ADR 0005, ADR 0006). Evaluate is pure: the Release, the Title, the
// Profile and the Blocklist answer go in, a Verdict comes out.
//
// TRaSH's JSON is loaded as published (see Snapshot). Custom Format regexes
// run on regexp2, the .NET-compatible engine, with a match timeout.
package scoring

import (
	"slices"
	"sort"

	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/resolution"
)

// Rejection says why a Release is not acceptable.
type Rejection string

const (
	RejectBelowMinScore           Rejection = "below_min_score"
	RejectResolution              Rejection = "resolution"
	RejectLanguage                Rejection = "language"
	RejectOriginalLanguageUnknown Rejection = "original_language_unknown"
	RejectBlocklisted             Rejection = "blocklisted"
)

// Release is a candidate to score: the parsed name plus what only the
// indexer knows.
type Release struct {
	Parsed release.ParsedRelease
	// IndexerLanguages, when not empty, win over the parsed languages.
	IndexerLanguages []release.Language
	// IndexerFlags carry Scene and Nuked from Newznab.
	IndexerFlags Flags
	// Size in bytes (Size conditions; TRaSH uses none today).
	Size int64
	// Filename is matched by Release Title conditions as well as the title,
	// for files already on disk.
	Filename string
	// ReleaseType is the episode shape of a Series release, which Sonarr's
	// Release Type condition tests: single episode, multi-episode or season
	// pack. Zero for Movies.
	ReleaseType ReleaseType
	// Blocklisted is the Blocklist's answer for this Release; Evaluate knows
	// nothing of the Blocklist itself.
	Blocklisted bool
}

// Title is what Evaluate needs to know about the Title being searched for.
type Title struct {
	Name string
	Year int
	// OriginalLanguage is the Title's Original Language as its metadata
	// states it; release.LangUnknown when not known.
	OriginalLanguage release.Language
}

// MatchedFormat is a Custom Format a Release matched and its score under the
// Profile.
type MatchedFormat struct {
	TrashID string
	Name    string
	Score   int
}

// Verdict is the result of Evaluate.
type Verdict struct {
	// Accepted is true when there are no Rejections.
	Accepted bool
	// Score is the sum of the matched Custom Formats' scores.
	Score int
	// MinScore is the Profile's minimum Score; a Score at or above it passes.
	MinScore int
	// Matched lists the matched Custom Formats ordered by name.
	Matched []MatchedFormat
	// Languages are the Release's languages after the indexer, fallback and
	// Original resolution rules: what the language gate and Language
	// conditions saw.
	Languages []release.Language
	// Rejections lists every reason, in a fixed order.
	Rejections []Rejection
}

// Rejected reports whether the Verdict carries the rejection.
func (v Verdict) Rejected(r Rejection) bool { return slices.Contains(v.Rejections, r) }

// Evaluate scores a Release for a Title under a Profile. The release's kind
// picks the data: Radarr's Custom Formats for Movies, Sonarr's for Series.
func Evaluate(rel Release, title Title, p *Profile) Verdict {
	if title.OriginalLanguage.ID == 0 {
		title.OriginalLanguage = release.LangUnknown // the zero value means not known
	}
	kind := rel.Parsed.Kind
	v := Verdict{}
	set := p.sets[kind]
	if set == nil {
		// A kind the Profile has no data for can never be accepted.
		v.Rejections = append(v.Rejections, RejectResolution)
		return v
	}
	v.MinScore = set.minScore
	v.Languages = resolveLanguages(rel, title)

	in := newInput(rel, title, v.Languages)
	for _, f := range set.formats {
		if f.cf.matches(in) {
			v.Matched = append(v.Matched, MatchedFormat{TrashID: f.cf.id, Name: f.cf.name, Score: f.score})
			v.Score += f.score
		}
	}
	sort.SliceStable(v.Matched, func(i, j int) bool { return v.Matched[i].Name < v.Matched[j].Name })

	v.Rejections = rejections(rel, title, p, v)
	v.Accepted = len(v.Rejections) == 0
	return v
}

func rejections(rel Release, title Title, p *Profile, v Verdict) []Rejection {
	var out []Rejection

	class, known := resolution.OfHeight(rel.Parsed.Quality.Quality.Resolution)
	if !known || !class.Within(p.MinHeight, p.MaxHeight) {
		out = append(out, RejectResolution)
	}

	out = append(out, languageGate(p.spec, title, v.Languages)...)

	if v.Score < v.MinScore {
		out = append(out, RejectBelowMinScore)
	}
	if rel.Blocklisted {
		out = append(out, RejectBlocklisted)
	}
	return out
}

// languageGate checks the Profile's language rule against the Release's
// languages. A Primary-Language Profile needs the Primary Language, or with
// original_fallback the Title's Original Language; an Original-Language
// Profile needs the Original Language and rejects a Title whose Original
// Language is unknown.
func languageGate(spec ProfileSpec, title Title, languages []release.Language) []Rejection {
	has := func(l release.Language) bool {
		return slices.ContainsFunc(languages, func(x release.Language) bool { return x.ID == l.ID })
	}
	originalKnown := title.OriginalLanguage != release.LangUnknown
	switch spec.Rule {
	case OriginalLanguage:
		if !originalKnown {
			return []Rejection{RejectOriginalLanguageUnknown}
		}
		if !has(title.OriginalLanguage) {
			return []Rejection{RejectLanguage}
		}
	default:
		if has(spec.Primary) {
			return nil
		}
		if spec.OriginalFallback && originalKnown && has(title.OriginalLanguage) {
			return nil
		}
		return []Rejection{RejectLanguage}
	}
	return nil
}

// resolveLanguages ports AggregateLanguages: the indexer's languages win over
// the parsed ones; no language at all falls back to the Title's Original
// Language; the Original pseudo-language is replaced by it (or by Unknown when
// it is already there).
func resolveLanguages(rel Release, title Title) []release.Language {
	langs := slices.Clone(rel.Parsed.Languages)
	if len(rel.IndexerLanguages) > 0 {
		langs = slices.Clone(rel.IndexerLanguages)
	}
	if len(langs) == 0 || (len(langs) == 1 && langs[0] == release.LangUnknown) {
		langs = []release.Language{title.OriginalLanguage}
	}
	if i := slices.Index(langs, release.LangOriginal); i >= 0 {
		langs = slices.Delete(langs, i, i+1)
		if !slices.Contains(langs, title.OriginalLanguage) {
			langs = append(langs, title.OriginalLanguage)
		} else {
			langs = append(langs, release.LangUnknown)
		}
	}
	return langs
}

func newInput(rel Release, title Title, languages []release.Language) *input {
	p := rel.Parsed
	in := &input{
		kind:         p.Kind,
		filename:     rel.Filename,
		group:        p.ReleaseGroup,
		edition:      p.Edition,
		quality:      p.Quality.Quality,
		languages:    languages,
		originalLang: title.OriginalLanguage,
		flags:        rel.IndexerFlags,
		size:         rel.Size,
		year:         p.Year,
		releaseType:  rel.ReleaseType,
	}
	if in.year == 0 {
		in.year = title.Year
	}
	// Radarr matches Release Title conditions against the simplified title,
	// Sonarr against the release title.
	if p.Kind == release.KindMovie {
		in.releaseTitle = p.SimpleReleaseTitle
	} else {
		in.releaseTitle = p.ReleaseTitle
	}
	return in
}
