package imports

import (
	"sort"
	"unicode"

	"golang.org/x/text/unicode/norm"

	"github.com/hyprsh/kestrel/internal/metadata"
)

// How Kestrel ranks the candidates of a Needs choice row and decides whether
// its first pick may be accepted in bulk.
//
// A candidate scores on how well its title reads like the name (edit similarity, 0
// to 1) and how close its year is to the parsed one; the best
// score is the suggestion. The suggestion is confident when ALL of these hold:
//
//   - the name states a year and the candidate's is within one of it;
//   - its title is a near-exact match (similarity of at least nearExactTitle),
//     or it is a close enough title (at least runtimeTitleFloor) whose Runtime
//     fits every file;
//   - it leads the runner-up by at least confidentLead, so two Movies that
//     fit equally (a remake in the same year) are left to the admin.
//
// These thresholds are tested against the fake TMDB's Dune, Blade Runner and
// Jurassic Park searches (see adoption_suggest_test.go): a sequel's longer
// title (similarity below 0.9) or a year a decade off never clears them.
const (
	nearExactTitle    = 0.9
	runtimeTitleFloor = 0.7
	confidentLead     = 0.15
	titleWeight       = 0.7
	yearWeight        = 0.3
	// offByOneYear is the year score of a result a year off the parsed one.
	offByOneYear = 0.6
)

type scored struct {
	r      metadata.SearchResult
	title  float64
	year   float64
	yearOK bool
	score  float64
}

func (s scored) candidate() Candidate {
	return Candidate{TMDBID: s.r.TMDBID, Title: s.r.Title, Year: s.r.Year}
}

// rankResults orders the search results best first (equal scores keep the
// provider's order) and scores them against the parsed titles and year; a year
// of 0 is unknown.
func rankResults(titles []string, year int, results []metadata.SearchResult) []scored {
	out := make([]scored, 0, len(results))
	for _, r := range results {
		s := scored{r: r}
		for _, t := range titles {
			s.title = max(s.title, similarity(t, r.Title), similarity(t, r.OriginalTitle))
		}
		if year != 0 && r.Year != 0 {
			switch d := r.Year - year; {
			case d == 0:
				s.year, s.yearOK = 1, true
			case d == 1 || d == -1:
				s.year, s.yearOK = offByOneYear, true
			}
		}
		s.score = titleWeight*s.title + yearWeight*s.year
		out = append(out, s)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].score > out[j].score })
	return out
}

// suggest turns the ranked results into the candidates of a row, marking the
// first as suggested and, when the rules above allow, confident. fits says
// whether the Movie's runtime fits the row's files; nil (a Series has none)
// means it never helps.
func suggest(ranked []scored, fits func(tmdbID int) bool) []Candidate {
	var out []Candidate
	for i, s := range ranked {
		if i == maxCandidates {
			break
		}
		c := s.candidate()
		if i == 0 {
			c.Suggested = true
			c.Confident = confident(ranked, fits)
		}
		out = append(out, c)
	}
	return out
}

func confident(ranked []scored, fits func(int) bool) bool {
	top := ranked[0]
	if !top.yearOK {
		return false
	}
	if len(ranked) > 1 && top.score-ranked[1].score < confidentLead {
		return false
	}
	switch {
	case top.title >= nearExactTitle:
		return true
	case top.title >= runtimeTitleFloor && fits != nil:
		return fits(top.r.TMDBID)
	}
	return false
}

// similarity is how alike two titles read, 0 to 1: one minus their edit
// distance over the longer one's length, after folding case, accents and
// punctuation away.
func similarity(a, b string) float64 {
	ra, rb := []rune(fold(a)), []rune(fold(b))
	n := max(len(ra), len(rb))
	if n == 0 {
		return 0
	}
	return 1 - float64(editDistance(ra, rb))/float64(n)
}

// fold is normalise with accents taken off the letters.
func fold(s string) string {
	var plain []rune
	for _, r := range norm.NFD.String(s) {
		if !unicode.Is(unicode.Mn, r) {
			plain = append(plain, r)
		}
	}
	return normalise(string(plain))
}

func editDistance(a, b []rune) int {
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
