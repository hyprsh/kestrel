package scoring

import (
	"cmp"
	"regexp"
	"slices"
	"strconv"

	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/resolution"
)

// QualityPref is one quality of a Profile's ladder and whether the Profile takes it.
type QualityPref struct {
	Name     string `json:"name"`
	Accepted bool   `json:"accepted"`
}

// SizeLimit bounds the size of one Movie, or of one episode of a Series, in
// bytes. A zero bound is no bound.
type SizeLimit struct{ Min, Max int64 }

// Any reports whether the limit bounds anything.
func (l SizeLimit) Any() bool { return l.Min > 0 || l.Max > 0 }

// Outside reports whether size lies outside the limit.
func (l SizeLimit) Outside(size int64) bool {
	return l.Min > 0 && size < l.Min || l.Max > 0 && size > l.Max
}

// KindOverlay is what the household set on a Profile for one kind of Title.
type KindOverlay struct {
	// Qualities, best first, replace TRaSH's order and acceptance; nil leaves TRaSH's.
	Qualities []QualityPref
	// Cutoff is the quality that is good enough ("Good enough at"); "" is none.
	Cutoff string
}

// Overlay is what the household set on a Profile on top of the TRaSH snapshot
// (ADR 0023): nil or empty fields leave TRaSH's data, or no limit, in place.
type Overlay struct {
	// MinScore replaces the backing TRaSH profile's minimum Score.
	MinScore *int
	// UpgradeUntil is the Score at which a file stops being upgraded.
	UpgradeUntil   *int
	Series, Movies KindOverlay
	// EpisodeSize bounds one episode of a Series, MovieSize one Movie.
	EpisodeSize, MovieSize SizeLimit
}

func (o *Overlay) kind(k release.Kind) KindOverlay {
	switch {
	case o == nil:
		return KindOverlay{}
	case k == release.KindMovie:
		return o.Movies
	}
	return o.Series
}

// Overlay is the household's settings on the Profile; nil when it has none.
func (p *Profile) Overlay() *Overlay { return p.spec.Overlay }

// SizeLimit is the size limit the Profile puts on a Release of the kind: per
// Movie, or per episode of a Series.
func (p *Profile) SizeLimit(kind release.Kind) SizeLimit {
	o := p.spec.Overlay
	switch {
	case o == nil:
		return SizeLimit{}
	case kind == release.KindMovie:
		return o.MovieSize
	}
	return o.EpisodeSize
}

// UpgradeUntil is the Score at which a file stops being upgraded; nil for none.
func (p *Profile) UpgradeUntil() *int {
	if o := p.spec.Overlay; o != nil {
		return o.UpgradeUntil
	}
	return nil
}

// Cutoff is the quality that is good enough for the kind; "" for none.
func (p *Profile) Cutoff(kind release.Kind) string {
	if s := p.sets[kind]; s != nil {
		return s.cutoff
	}
	return ""
}

// Ladder lists the qualities the Profile knows for the kind, best first, each
// with whether it takes it: the household's order and choices, else TRaSH's.
func (p *Profile) Ladder(kind release.Kind) []QualityPref {
	if s := p.sets[kind]; s != nil {
		return slices.Clone(s.ladder)
	}
	return nil
}

// TrashLadder is the ladder as TRaSH has it, whatever the household set.
func (p *Profile) TrashLadder(kind release.Kind) []QualityPref {
	if s := p.sets[kind]; s != nil {
		return p.buildLadder(kind, s.trash, nil)
	}
	return nil
}

// UpgradesLimited reports whether the Profile stops upgrading at all for the
// kind: it has a cutoff for it, or an Upgrade-until Score.
func (p *Profile) UpgradesLimited(kind release.Kind) bool {
	return p.Cutoff(kind) != "" || p.UpgradeUntil() != nil
}

// AtCutoff reports whether a file of the quality and Score needs no Upgrade:
// the Profile limits upgrades for the kind, the file's quality is the cutoff or
// above it in the ladder (when there is a cutoff), and its Score has reached
// the Upgrade-until Score (when there is one). A quality the ladder does not
// know is never at the cutoff. A Profile with neither limit never stops
// upgrading.
func (p *Profile) AtCutoff(kind release.Kind, quality string, score int) bool {
	if !p.UpgradesLimited(kind) {
		return false
	}
	if cut := p.Cutoff(kind); cut != "" {
		ladder := p.sets[kind].ladder
		at := slices.IndexFunc(ladder, func(q QualityPref) bool { return q.Name == quality })
		ci := slices.IndexFunc(ladder, func(q QualityPref) bool { return q.Name == cut })
		if at < 0 || ci < 0 || at > ci {
			return false
		}
	}
	if until := p.UpgradeUntil(); until != nil && score < *until {
		return false
	}
	return true
}

var heightRE = regexp.MustCompile(`(\d{3,4})p`)

// sourceRank orders sources best first (a bigger number is better).
func sourceRank(q release.Quality) int {
	switch {
	case q.Modifier == release.ModifierRemux || q.Source == release.SourceBlurayRaw:
		return 6
	case q.Source == release.SourceBluray:
		return 5
	case q.Source == release.SourceWebDL:
		return 4
	case q.Source == release.SourceWebRip:
		return 3
	case q.Source == release.SourceTV || q.Source == release.SourceTVRaw:
		return 2
	case q.Source == release.SourceDVD:
		return 1
	}
	return 0
}

// buildLadder lists the qualities a Profile knows for a kind, best first, with
// the ones in accepted ticked. Without household preferences the order is
// resolution, then source, and the accepted ones are TRaSH's. With them the
// household's order and choices stand, and any quality they leave out follows
// at the end as TRaSH has it.
func (p *Profile) buildLadder(kind release.Kind, trash []string, prefs []QualityPref) []QualityPref {
	byName := map[string]release.Quality{}
	for _, q := range release.Qualities(kind) {
		if class, ok := resolution.OfHeight(q.Resolution); ok && class.Within(p.MinHeight, p.MaxHeight) {
			byName[q.Name] = q
		}
	}
	for _, n := range trash {
		if _, ok := byName[n]; !ok {
			h := 0
			if m := heightRE.FindStringSubmatch(n); m != nil {
				h, _ = strconv.Atoi(m[1])
			}
			byName[n] = release.Quality{Name: n, Resolution: h}
		}
	}
	rest := make([]release.Quality, 0, len(byName))
	for _, q := range byName {
		rest = append(rest, q)
	}
	slices.SortFunc(rest, func(a, b release.Quality) int {
		return cmp.Or(cmp.Compare(b.Resolution, a.Resolution), cmp.Compare(sourceRank(b), sourceRank(a)), cmp.Compare(a.Name, b.Name))
	})
	var out []QualityPref
	seen := map[string]bool{}
	for _, pref := range prefs {
		if !seen[pref.Name] {
			seen[pref.Name] = true
			out = append(out, pref)
		}
	}
	for _, q := range rest {
		if !seen[q.Name] {
			out = append(out, QualityPref{Name: q.Name, Accepted: slices.Contains(trash, q.Name)})
		}
	}
	return out
}

// unitsOf is how many Movies or episodes a Release holds, for judging its size
// per unit; 0 when that is not known (a pack of a season the Library has no
// episodes for, a multi-season pack, a numbering that names no episode).
func unitsOf(rel Release, title Title) int {
	s := rel.Parsed.Series
	switch {
	case rel.Parsed.Kind == release.KindMovie:
		return 1
	case s == nil || s.MultiSeason:
		return 0
	case s.FullSeason:
		return title.SeasonEpisodes
	}
	return len(s.Episodes)
}

// sizeRejected reports whether the Release's size per Movie or per episode lies
// outside the Profile's limit. A Release with no known size or unit count is not judged.
func sizeRejected(rel Release, title Title, p *Profile) bool {
	lim := p.SizeLimit(rel.Parsed.Kind)
	if !lim.Any() || rel.Size <= 0 {
		return false
	}
	n := unitsOf(rel, title)
	return n > 0 && lim.Outside(rel.Size/int64(n))
}

// IsZero reports whether the Overlay changes nothing.
func (o Overlay) IsZero() bool {
	return o.MinScore == nil && o.UpgradeUntil == nil && o.Series.IsZero() && o.Movies.IsZero() &&
		!o.EpisodeSize.Any() && !o.MovieSize.Any()
}

// IsZero reports whether the KindOverlay changes nothing.
func (k KindOverlay) IsZero() bool { return len(k.Qualities) == 0 && k.Cutoff == "" }
