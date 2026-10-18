package release

import (
	"log/slog"
	"sync"
	"time"

	"github.com/dlclark/regexp2"
)

// MatchTimeout bounds every regex match in this package (ADR 0006). A match
// that times out counts as no match and logs a warning. Tests may raise it
// before the first match; it is read when each pattern is first compiled.
var MatchTimeout = 100 * time.Millisecond

// rx wraps a .NET-compatible regexp2 expression with the .NET Regex calls the
// ported parsers use. Each pattern is compiled once, on first use, so that
// MatchTimeout set at package init or in a TestMain applies to it.
type rx struct {
	pattern string
	opts    regexp2.RegexOptions
	once    sync.Once
	re      *regexp2.Regexp
}

func mustRx(pattern string, opts regexp2.RegexOptions) *rx {
	return &rx{pattern: pattern, opts: opts}
}

// regexp returns the compiled expression, compiling it on the first call.
func (r *rx) regexp() *regexp2.Regexp {
	r.once.Do(func() {
		r.re = regexp2.MustCompile(r.pattern, r.opts)
		r.re.MatchTimeout = MatchTimeout
	})
	return r.re
}

// ci compiles with IgnoreCase, the most common *arr option set.
func ci(pattern string) *rx { return mustRx(pattern, regexp2.IgnoreCase) }

// cs compiles with no options (case-sensitive, .NET semantics).
func cs(pattern string) *rx { return mustRx(pattern, regexp2.None) }

// cix compiles with IgnoreCase and IgnorePatternWhitespace.
func cix(pattern string) *rx {
	return mustRx(pattern, regexp2.IgnoreCase|regexp2.IgnorePatternWhitespace)
}

func (r *rx) warn(err error) {
	slog.Warn("regex timed out, treating as no match", "pattern", r.pattern, "error", err)
}

// match returns the first match or nil.
func (r *rx) match(s string) *regexp2.Match {
	m, err := r.regexp().FindStringMatch(s)
	if err != nil {
		r.warn(err)
		return nil
	}
	return m
}

// matchAll returns every match, like Regex.Matches.
func (r *rx) matchAll(s string) []*regexp2.Match {
	var out []*regexp2.Match
	m, err := r.regexp().FindStringMatch(s)
	for err == nil && m != nil {
		out = append(out, m)
		m, err = r.regexp().FindNextMatch(m)
	}
	if err != nil {
		r.warn(err)
	}
	return out
}

func (r *rx) isMatch(s string) bool { return r.match(s) != nil }

// replace substitutes every match using .NET replacement syntax ($1, ${name}).
func (r *rx) replace(s, repl string) string {
	out, err := r.regexp().Replace(s, repl, -1, -1)
	if err != nil {
		r.warn(err)
		return s
	}
	return out
}

func (r *rx) replaceFunc(s string, f func(*regexp2.Match) string) string {
	out, err := r.regexp().ReplaceFunc(s, func(m regexp2.Match) string { return f(&m) }, -1, -1)
	if err != nil {
		r.warn(err)
		return s
	}
	return out
}

// split cuts s at every match (the patterns used have no capture groups, so
// like .NET's Regex.Split nothing but the pieces is returned).
func (r *rx) split(s string) []string {
	runes := []rune(s)
	var out []string
	last := 0
	for _, m := range r.matchAll(s) {
		out = append(out, string(runes[last:m.Index]))
		last = m.Index + m.Length
	}
	return append(out, string(runes[last:]))
}

// group returns the text of the named group and whether it took part in the match.
func group(m *regexp2.Match, name string) (string, bool) {
	if m == nil {
		return "", false
	}
	g := m.GroupByName(name)
	if g == nil || len(g.Captures) == 0 {
		return "", false
	}
	return g.String(), true
}

// hasGroup reports whether the named group captured anything.
func hasGroup(m *regexp2.Match, name string) bool {
	_, ok := group(m, name)
	return ok
}
