package profiles

import "testing"

func TestCertificationAge(t *testing.T) {
	cases := []struct {
		country, cert string
		age           int
		ok            bool
	}{
		// numeric: DE FSK and any country that rates by age
		{"DE", "0", 0, true},
		{"DE", "6", 6, true},
		{"DE", "FSK 12", 12, true},
		{"DE", "16", 16, true},
		{"NL", "9", 9, true},
		{"DE", "", 0, false},
		{"DE", "Unrated", 0, false},
		// US film
		{"US", "G", 0, true},
		{"US", "PG", 6, true},
		{"US", "PG-13", 12, true},
		{"US", "R", 16, true},
		{"US", "NC-17", 18, true},
		{"US", "NR", 0, false},
		// US TV
		{"US", "TV-Y", 0, true},
		{"US", "TV-G", 0, true},
		{"US", "TV-Y7", 6, true},
		{"US", "TV-PG", 12, true},
		{"US", "TV-14", 14, true},
		{"US", "TV-MA", 17, true},
		{"US", "tv-pg", 12, true},
		// GB
		{"GB", "U", 0, true},
		{"GB", "PG", 8, true},
		{"GB", "12", 12, true},
		{"GB", "12A", 12, true},
		{"GB", "15", 15, true},
		{"GB", "18", 18, true},
		{"GB", "R18", 0, false},
		// FR
		{"FR", "U", 0, true},
		{"FR", "TP", 0, true},
		{"FR", "10", 10, true},
		{"FR", "-12", 12, true},
		{"FR", "18", 18, true},
		// a letter code outside its country is unmapped
		{"DE", "PG", 0, false},
		{"FR", "PG", 0, false},
	}
	for _, c := range cases {
		age, ok := CertificationAge(c.country, c.cert)
		if ok != c.ok || (ok && age != c.age) {
			t.Errorf("CertificationAge(%q, %q) = %d, %v; want %d, %v", c.country, c.cert, age, ok, c.age, c.ok)
		}
	}
}

func TestKidsRuleApplies(t *testing.T) {
	cases := []struct {
		name          string
		rule          KidsRule
		country, cert string
		want          bool
	}{
		{"at threshold", KidsRule{Enabled: true, Threshold: 6}, "DE", "6", true},
		{"below threshold", KidsRule{Enabled: true, Threshold: 6}, "DE", "0", true},
		{"above threshold", KidsRule{Enabled: true, Threshold: 6}, "DE", "12", false},
		{"threshold 12", KidsRule{Enabled: true, Threshold: 12}, "US", "PG-13", true},
		{"threshold 0 excludes 6", KidsRule{Enabled: true, Threshold: 0}, "US", "PG", false},
		{"threshold 0 takes G", KidsRule{Enabled: true, Threshold: 0}, "US", "G", true},
		{"switched off", KidsRule{Enabled: false, Threshold: 12}, "DE", "0", false},
		{"unmapped does not apply", KidsRule{Enabled: true, Threshold: 12}, "US", "NR", false},
		{"missing does not apply", KidsRule{Enabled: true, Threshold: 12}, "US", "", false},
	}
	for _, c := range cases {
		if got := c.rule.Applies(c.country, c.cert); got != c.want {
			t.Errorf("%s: Applies = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestKidsLabel(t *testing.T) {
	cases := []struct{ country, cert, want string }{
		{"DE", "6", "Kids (FSK 6)"},
		{"DE", "FSK 12", "Kids (FSK 12)"},
		{"US", "PG", "Kids (PG)"},
		{"US", "TV-Y7", "Kids (TV-Y7)"},
		{"GB", "PG", "Kids (PG)"},
		{"FR", "U", "Kids (U)"},
		{"FR", "10", "Kids (FR 10)"},
		{"DE", "", "Kids"},
	}
	for _, c := range cases {
		if got := KidsLabel(c.country, c.cert); got != c.want {
			t.Errorf("KidsLabel(%q, %q) = %q, want %q", c.country, c.cert, got, c.want)
		}
	}
}
