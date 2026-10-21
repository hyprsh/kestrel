package api

import (
	"cmp"
	"context"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"

	"github.com/hyprsh/kestrel/internal/metadata"
)

// The add-search is TMDB's: Kestrel only makes it forgiving. It searches without a
// trailing year and ranks by it, asks once more with a folded query when TMDB finds
// nothing, ranks TMDB's results by how well they match what was typed, and names the
// best one when it differs a lot, so the SPA can offer it as "Did you mean …?".

// trailingYear is a release year typed after the title: "dune 2021" or "dune (2021)".
var trailingYear = regexp.MustCompile(`^(.*\S)\s+\(?((?:18|19|20)\d\d)\)?$`)

// unlike is how close (0 to 1) the best result must come to the query for no
// "Did you mean …?": below it, the result differs a lot from what was typed.
const unlike = 0.8

// findTitles runs the add-search for q, keeping the results `keep` wants, best first,
// with at most one extra TMDB request.
func (s *server) findTitles(ctx context.Context, q string, keep func(metadata.SearchResult) bool) (ranked []metadata.SearchResult, didYouMean string, err error) {
	query, year := q, 0
	if m := trailingYear.FindStringSubmatch(q); m != nil {
		query, year = m[1], atoi(m[2])
	}
	search := func(query string) ([]metadata.SearchResult, error) {
		found, err := s.meta.Search(ctx, query)
		return slices.DeleteFunc(found, func(f metadata.SearchResult) bool { return !keep(f) }), err
	}
	found, err := search(query)
	if err != nil {
		return nil, "", err
	}
	if folded := fold(query); len(found) == 0 && folded != "" && folded != strings.Join(strings.Fields(strings.ToLower(query)), " ") {
		if found, err = search(folded); err != nil {
			return nil, "", err
		}
	}
	if len(found) == 0 {
		return nil, "", nil
	}
	typed := []string{fold(q), fold(query)}
	type hit struct {
		metadata.SearchResult
		key rankKey
	}
	hits := make([]hit, len(found))
	for i, f := range found {
		hits[i] = hit{f, keyOf(typed, year, f)}
	}
	slices.SortStableFunc(hits, func(a, b hit) int { return b.key.compare(a.key) })
	for _, h := range hits {
		ranked = append(ranked, h.SearchResult)
	}
	if hits[0].key.match < unlike {
		didYouMean = hits[0].Title
	}
	return ranked, didYouMean, nil
}

func atoi(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}

// rankKey orders search results: how well the query is found in the title, then
// the typed year, then how close the whole title is to the query.
type rankKey struct {
	match float64
	year  bool
	close float64
}

func (k rankKey) compare(o rankKey) int {
	if c := cmp.Compare(k.match, o.match); c != 0 {
		return c
	}
	if k.year != o.year {
		if k.year {
			return 1
		}
		return -1
	}
	return cmp.Compare(k.close, o.close)
}

// keyOf is the best key of a result's title and original title against any typed form.
func keyOf(typed []string, year int, f metadata.SearchResult) rankKey {
	k := rankKey{year: year != 0 && f.Year == year}
	for _, title := range []string{f.Title, f.OriginalTitle} {
		t := fold(title)
		if t == "" {
			continue
		}
		for _, q := range typed {
			k.match = max(k.match, within(q, t))
			k.close = max(k.close, closeness(compact(q), compact(t)))
		}
	}
	return k
}

// fold lower-cases s and drops accents and punctuation, reading "&" as "and":
// "Amélie & the Spider-Man's" is "amelie and the spider mans".
func fold(s string) string {
	var b strings.Builder
	for _, r := range norm.NFD.String(strings.ReplaceAll(s, "&", " and ")) {
		switch {
		case unicode.Is(unicode.Mn, r), r == '\'', r == '’', r == '`':
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(unicode.ToLower(r))
		default:
			b.WriteRune(' ')
		}
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

func compact(s string) string { return strings.ReplaceAll(s, " ", "") }

// within is how well (0 to 1) the folded query is found in the folded title: the
// closeness of the whole, or of each query word to the title word, or start of a
// word, it is closest to.
func within(q, t string) float64 {
	if compact(q) == compact(t) {
		return 1
	}
	words := strings.Fields(t)
	var sum float64
	qs := strings.Fields(q)
	for _, w := range qs {
		var best float64
		for _, tw := range words {
			start := tw
			if r := []rune(tw); len(r) > len([]rune(w)) {
				start = string(r[:len([]rune(w))])
			}
			best = max(best, closeness(w, tw), closeness(w, start))
		}
		sum += best
	}
	return max(closeness(compact(q), compact(t)), sum/float64(len(qs)))
}

// closeness is 1 less the edits between a and b per letter of the longer one.
func closeness(a, b string) float64 {
	ra, rb := []rune(a), []rune(b)
	n := max(len(ra), len(rb))
	if n == 0 {
		return 1
	}
	return 1 - float64(edits(ra, rb))/float64(n)
}

// edits is the optimal string alignment distance: a letter added, dropped,
// changed, or two neighbours swapped each count one.
func edits(a, b []rune) int {
	d := make([][]int, len(a)+1)
	for i := range d {
		d[i] = make([]int, len(b)+1)
		d[i][0] = i
	}
	for j := range d[0] {
		d[0][j] = j
	}
	for i := 1; i <= len(a); i++ {
		for j := 1; j <= len(b); j++ {
			cost := 1
			if a[i-1] == b[j-1] {
				cost = 0
			}
			d[i][j] = min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1]+cost)
			if i > 1 && j > 1 && a[i-1] == b[j-2] && a[i-2] == b[j-1] {
				d[i][j] = min(d[i][j], d[i-2][j-2]+1)
			}
		}
	}
	return d[len(a)][len(b)]
}
