// Package updates is the daily check against GitHub: the latest release and
// the published security advisories (PRD Settled 25, 26; #59).
package updates

import (
	"strconv"
	"strings"
)

type semver [3]int

// parse reads "v1.2.3", "1.2.3" or "1.2.3-rc.1" (the suffix is ignored).
func parse(s string) (semver, bool) {
	s = strings.TrimPrefix(strings.TrimSpace(s), "v")
	if i := strings.IndexAny(s, "-+"); i >= 0 {
		s = s[:i]
	}
	parts := strings.Split(s, ".")
	if len(parts) != 3 {
		return semver{}, false
	}
	var v semver
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return semver{}, false
		}
		v[i] = n
	}
	return v, true
}

func (a semver) cmp(b semver) int {
	for i := range a {
		if a[i] != b[i] {
			if a[i] < b[i] {
				return -1
			}
			return 1
		}
	}
	return 0
}

// Covers reports whether version lies inside an advisory's vulnerable range:
// comma-separated clauses such as ">= 0.1.0, < 0.3.2", all of which must hold.
// A range or version it cannot read covers nothing (dev and edge builds too).
func Covers(rng, version string) bool {
	v, ok := parse(version)
	if !ok || strings.TrimSpace(rng) == "" {
		return false
	}
	for _, clause := range strings.Split(rng, ",") {
		clause = strings.TrimSpace(clause)
		op := "="
		for _, o := range []string{">=", "<=", "==", ">", "<", "="} {
			if strings.HasPrefix(clause, o) {
				op, clause = o, strings.TrimSpace(clause[len(o):])
				break
			}
		}
		b, ok := parse(clause)
		if !ok {
			return false
		}
		c := v.cmp(b)
		var holds bool
		switch op {
		case ">=":
			holds = c >= 0
		case "<=":
			holds = c <= 0
		case ">":
			holds = c > 0
		case "<":
			holds = c < 0
		default:
			holds = c == 0
		}
		if !holds {
			return false
		}
	}
	return true
}

// Newer reports whether release is a newer version than running. Builds that
// are not releases (dev, edge) never see an update.
func Newer(release, running string) bool {
	r, ok1 := parse(release)
	v, ok2 := parse(running)
	return ok1 && ok2 && r.cmp(v) > 0
}
