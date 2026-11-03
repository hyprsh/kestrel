package acquire

import (
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/hyprsh/kestrel/internal/indexers"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring"
)

const (
	// RejectYearOutsideRun says a Series Release names a year outside the Series' run: from the year before it
	// first aired to the year after it last aired (up to this year while it continues). Overridable.
	RejectYearOutsideRun scoring.Rejection = "year_outside_run"
	// RejectAliasOnly says a text hit matches only one of the Series' aliases, and neither a year in the Series'
	// run nor the episode's title backs that up: likely another show of that name. Overridable.
	RejectAliasOnly scoring.Rejection = "alias_only"
	// RejectEpisodeTitle says the Release names an episode title that clearly differs from the Series' title for
	// that episode: likely another show. Overridable.
	RejectEpisodeTitle scoring.Rejection = "episode_title_mismatch"
)

// minTitleSimilarity is the least similarity (1 is equal) two episode titles need, after normalising, not to
// count as clearly different. It is low on purpose: scene names abbreviate and rewrite punctuation, and a false
// rejection of the right show costs more than a missed wrong one.
const minTitleSimilarity = 0.5

// showCheck judges whether a Series Release is about this Series, beyond its title being one of the Series' names.
type showCheck struct {
	canonical, alias map[string]bool
	episodes         []library.Episode
	from, to         int // the years a Release may name; 0 for no bound
}

func newShowCheck(d library.Detail, eps []library.Episode, now time.Time) showCheck {
	c := showCheck{canonical: map[string]bool{}, alias: map[string]bool{}, episodes: eps}
	for _, n := range []string{d.Title, d.OriginalTitle, d.PrimaryTitle} {
		c.canonical[normalize(n)] = true
	}
	for _, a := range d.Aliases {
		if n := normalize(a.Title); !c.canonical[n] {
			c.alias[n] = true
		}
	}
	first, last := d.Year, 0
	for _, ep := range eps {
		if ep.Season == 0 || ep.AirDate == nil || ep.AirDate.After(now) {
			continue
		}
		y := ep.AirDate.Year()
		if first == 0 || y < first {
			first = y
		}
		last = max(last, y)
	}
	if first > 0 {
		c.from = first - 1
	}
	if strings.EqualFold(d.SeriesStatus, "ended") && last > 0 {
		c.to = last + 1
	} else if first > 0 {
		c.to = max(now.Year(), last+1)
	}
	return c
}

// nameKnown reports whether the names include one of the Release's titles.
func nameKnown(names map[string]bool, p release.ParsedRelease) bool {
	return slices.ContainsFunc(parsedTitles(p), func(t string) bool { return names[normalize(t)] })
}

// yearIn is whether the Release names a year, and if so whether it lies in the Series' run.
func (c showCheck) yearIn(p release.ParsedRelease) (named, in bool) {
	if p.Year == 0 || (c.from == 0 && c.to == 0) {
		return false, false
	}
	return true, (c.from == 0 || p.Year >= c.from) && (c.to == 0 || p.Year <= c.to)
}

// rejections are the reasons a Release found for the Series is probably another show. orig is the parsed name as
// the indexer gave it and p the same with a daily episode resolved. A hit by id is trusted for who it is (only its
// year is checked); a text hit is also judged on its alias and episode title.
func (c showCheck) rejections(r indexers.Release, orig, p release.ParsedRelease) []scoring.Rejection {
	var out []scoring.Rejection
	named, inRun := c.yearIn(orig)
	if named && !inRun {
		out = append(out, RejectYearOutsideRun)
	}
	if r.ByID {
		return out
	}
	title := c.episodeTitleMatch(orig, p)
	if title == titleDiffers {
		out = append(out, RejectEpisodeTitle)
	}
	aliasOnly := !nameKnown(c.canonical, orig) && nameKnown(c.alias, orig)
	if aliasOnly && !(named && inRun) && title != titleMatched {
		out = append(out, RejectAliasOnly)
	}
	return out
}

type titleVerdict int

const (
	titleUnknown titleVerdict = iota // the Release or the Series gives no title to compare
	titleMatched
	titleDiffers
)

// episodeTitleMatch compares the episode title a single-episode Release carries with the Series' title for that
// episode. Anything uncertain (a pack, several episodes, a daily, a Special, no title on either side) is unknown.
func (c showCheck) episodeTitleMatch(orig, p release.ParsedRelease) titleVerdict {
	if orig.IsDaily() {
		return titleUnknown
	}
	season, numbers, ok := namedEpisodes(p)
	if !ok || len(numbers) != 1 || season == 0 {
		return titleUnknown
	}
	got := releaseEpisodeTitle(p)
	if got == "" {
		return titleUnknown
	}
	var known bool
	for _, ep := range c.episodes {
		if ep.Season != season || ep.Number != numbers[0] {
			continue
		}
		for _, name := range []string{ep.Name, ep.PrimaryName} {
			if compact(name) == "" {
				continue
			}
			known = true
			if similarTitles(got, name) {
				return titleMatched
			}
		}
	}
	if !known {
		return titleUnknown
	}
	return titleDiffers
}

// compact reduces a title to its letters and digits, lower case, so punctuation, case and spacing do not count.
func compact(s string) string { return strings.ReplaceAll(normalize(s), " ", "") }

// similarTitles says two episode titles do not clearly differ: equal once compacted, one inside the other (names
// carry extra tokens or cut long titles short), or close by edit distance.
func similarTitles(a, b string) bool {
	a, b = compact(a), compact(b)
	if a == b {
		return true
	}
	short, long := a, b
	if len(short) > len(long) {
		short, long = long, short
	}
	if len(short) >= 3 && strings.Contains(long, short) {
		return true
	}
	return 1-float64(distance(a, b))/float64(len(long)) >= minTitleSimilarity
}

// reject adds the reasons to the Release's verdict under every Version's Profile.
func (e *entry) reject(why []scoring.Rejection) {
	if len(why) == 0 {
		return
	}
	for slot, v := range e.cand.Verdicts {
		v.Rejections = append(slices.Clone(v.Rejections), why...)
		v.Accepted = false
		e.cand.Verdicts[slot] = v
	}
}

// distance is the Levenshtein distance of two strings, by bytes.
func distance(a, b string) int {
	prev := make([]int, len(b)+1)
	for j := range prev {
		prev[j] = j
	}
	for i := 1; i <= len(a); i++ {
		cur := make([]int, len(b)+1)
		cur[0] = i
		for j := 1; j <= len(b); j++ {
			cost := 1
			if a[i-1] == b[j-1] {
				cost = 0
			}
			cur[j] = min(prev[j]+1, cur[j-1]+1, prev[j-1]+cost)
		}
		prev = cur
	}
	return prev[len(b)]
}

var (
	techToken = regexp.MustCompile(`^(?i:\d{3,4}[pi]|[48]k|uhd|(19|20)\d\d|web|webdl|webrip|hdtv|pdtv|dsr|bluray|bdrip|brrip|dvdrip|dvd|remux|` +
		`amzn|nf|dsnp|hmax|atvp|pcok|hulu|max|x26[45]|h26[45]|hevc|avc|xvid|av1|dd|ddp\d*|aac\d*|ac3|dts|atmos|truehd|` +
		`proper|repack|rerip|internal|real|multi|german|french|italian|spanish|dl|dubbed|subbed|complete|extended|uncut|hdr\d*|dv|sdr|10bit)$`)
	splitToken = regexp.MustCompile(`[._\s]+`)
)

// releaseEpisodeTitle is the episode title a single-episode Release name carries between its numbers and the
// first tag (resolution, source, codec ...); "" when it carries none or the name has no tag to end it.
func releaseEpisodeTitle(p release.ParsedRelease) string {
	if p.Series == nil || p.Series.ReleaseTokens == "" {
		return ""
	}
	tokens := splitToken.Split(strings.Trim(p.Series.ReleaseTokens, "._- "), -1)
	var words []string
	for i, t := range tokens {
		bare := strings.ReplaceAll(t, "-", "")
		if t == "" {
			continue
		}
		if techToken.MatchString(bare) || ((strings.EqualFold(t, "h") || strings.EqualFold(t, "x")) && i+1 < len(tokens) && techToken.MatchString(t+tokens[i+1])) {
			if len(words) == 0 {
				return ""
			}
			return strings.Join(words, " ")
		}
		words = append(words, t)
	}
	return "" // no tag ends the title: the rest is not told apart from it
}
