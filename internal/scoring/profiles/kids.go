package profiles

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// KidsRule is the household's Kids rule (PRD Settled 7): when a Title's
// certification in the release-date country reads as an age at or below the
// threshold, the HD Slot's Profile is swapped for its Kids counterpart.
type KidsRule struct {
	Enabled bool
	// Threshold is the highest age that counts as for kids: 0, 6 or 12.
	Threshold int
}

// DefaultKidsRule is on, with threshold 6.
var DefaultKidsRule = KidsRule{Enabled: true, Threshold: 6}

// Applies reports whether the rule makes a Title with this certification a
// kids' title. An unmapped or missing certification never applies.
func (r KidsRule) Applies(country, cert string) bool {
	if !r.Enabled {
		return false
	}
	age, ok := CertificationAge(country, cert)
	return ok && age <= r.Threshold
}

var (
	usAges = map[string]int{
		"G": 0, "PG": 6, "PG-13": 12, "R": 16, "NC-17": 18,
		"TV-Y": 0, "TV-G": 0, "TV-Y7": 6, "TV-PG": 12, "TV-14": 14, "TV-MA": 17,
	}
	gbAges = map[string]int{"U": 0, "PG": 8, "12": 12, "12A": 12, "15": 15, "18": 18}
	frAges = map[string]int{"U": 0, "TP": 0}

	// numericCert matches "6", "FSK 12", "-10", "12+".
	numericCert = regexp.MustCompile(`^(?:FSK\s*)?[-+]?(\d{1,2})\+?$`)
)

// CertificationAge reads a certification of the release-date country (an
// ISO 3166-1 alpha-2 code) as a minimum age. Numeric certifications are their
// number; US film and TV, GB and FR letter codes follow PRD Settled 7. ok is
// false for anything unmapped or empty.
func CertificationAge(country, cert string) (age int, ok bool) {
	c := strings.ToUpper(strings.TrimSpace(cert))
	if c == "" {
		return 0, false
	}
	var table map[string]int
	switch strings.ToUpper(country) {
	case "US":
		table = usAges
	case "GB":
		table = gbAges
	case "FR":
		table = frAges
	}
	if a, found := table[c]; found {
		return a, true
	}
	if m := numericCert.FindStringSubmatch(c); m != nil {
		n, _ := strconv.Atoi(m[1])
		return n, true
	}
	return 0, false
}

// KidsLabel is the Kids Profile's name with the country's own certification:
// "Kids (FSK 6)" in Germany, "Kids (PG)" in the US and GB. With no
// certification it is plain "Kids".
func KidsLabel(country, cert string) string {
	c := strings.ToUpper(strings.TrimSpace(cert))
	if c == "" {
		return "Kids"
	}
	country = strings.ToUpper(country)
	if m := numericCert.FindStringSubmatch(c); m != nil {
		if country == "DE" {
			return fmt.Sprintf("Kids (FSK %s)", m[1])
		}
		return fmt.Sprintf("Kids (%s %s)", country, m[1])
	}
	return fmt.Sprintf("Kids (%s)", c)
}
