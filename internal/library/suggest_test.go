package library_test

import (
	"testing"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/resolution"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
)

func certified(country, cert string) metadata.ReleaseDates {
	return metadata.ReleaseDates{{Country: country, Type: metadata.Theatrical, Date: day(2015, 1, 1), Certification: cert}}
}

func profilesWith(edit func(map[string]*profiles.Profile)) []profiles.Profile {
	all := profiles.Builtin()
	m := map[string]*profiles.Profile{}
	for i := range all {
		m[all[i].Key] = &all[i]
	}
	if edit != nil {
		edit(m)
	}
	return all
}

func TestOnlySlotsWithADefaultArePreselected(t *testing.T) {
	s := library.Suggest(profilesWith(nil), library.Movie, certified("US", "R"), "US", profiles.DefaultKidsRule)
	if len(s.Slots) != 1 || s.Slots[0].Slot != resolution.HD || s.Slots[0].Profile.Key != "hd-primary" || s.Slots[0].Reason != library.ReasonDefault {
		t.Fatalf("suggestion = %+v", s)
	}

	s = library.Suggest(profilesWith(func(m map[string]*profiles.Profile) {
		m["uhd-primary"].DefaultMovies = true
		m["sd-original"].DefaultMovies = true
	}), library.Movie, certified("US", "R"), "US", profiles.DefaultKidsRule)
	var got []string
	for _, sl := range s.Slots {
		got = append(got, sl.Slot.String()+":"+sl.Profile.Key)
	}
	if len(got) != 3 || got[0] != "SD:sd-original" || got[1] != "HD:hd-primary" || got[2] != "UHD:uhd-primary" {
		t.Errorf("slots = %v, want every Slot with a default, in Slot order", got)
	}
}

func TestDefaultsAreReadPerKind(t *testing.T) {
	all := profilesWith(func(m map[string]*profiles.Profile) { m["uhd-primary"].DefaultSeries = true })
	if s := library.Suggest(all, library.Movie, nil, "US", profiles.DefaultKidsRule); len(s.Slots) != 1 {
		t.Errorf("a Series-only UHD default preselected for a Movie: %+v", s.Slots)
	}
	if s := library.Suggest(all, library.Series, nil, "US", profiles.DefaultKidsRule); len(s.Slots) != 2 {
		t.Errorf("Series defaults = %+v", s.Slots)
	}
}

func TestTheKidsRuleSwapsHDAndSaysWhy(t *testing.T) {
	for _, c := range []struct {
		name    string
		rel     metadata.ReleaseDates
		country string
		kids    profiles.KidsRule
		profile string
		label   string
		reason  library.Reason
	}{
		{"FSK 6 in Germany", certified("DE", "6"), "DE", profiles.DefaultKidsRule, "kids-primary", "Kids (FSK 6)", library.ReasonKidsRule},
		{"PG in the US", certified("US", "PG"), "US", profiles.DefaultKidsRule, "kids-primary", "Kids (PG)", library.ReasonKidsRule},
		{"above the threshold", certified("DE", "12"), "DE", profiles.DefaultKidsRule, "hd-primary", "HD", library.ReasonDefault},
		{"threshold 12 widens it", certified("DE", "12"), "DE", profiles.KidsRule{Enabled: true, Threshold: 12}, "kids-primary", "Kids (FSK 12)", library.ReasonKidsRule},
		{"rule off", certified("DE", "0"), "DE", profiles.KidsRule{Enabled: false, Threshold: 6}, "hd-primary", "HD", library.ReasonDefault},
		{"no certification anywhere", nil, "DE", profiles.DefaultKidsRule, "hd-primary", "HD", library.ReasonDefault},
		{"unmapped certification", certified("DE", "BPjM"), "DE", profiles.DefaultKidsRule, "hd-primary", "HD", library.ReasonDefault},
		{"the US rating stands in, read as a US rating", certified("US", "G"), "DE", profiles.DefaultKidsRule, "kids-primary", "Kids (G)", library.ReasonKidsRule},
	} {
		s := library.Suggest(profilesWith(nil), library.Movie, c.rel, c.country, c.kids)
		if len(s.Slots) != 1 {
			t.Errorf("%s: slots = %+v", c.name, s.Slots)
			continue
		}
		got := s.Slots[0]
		if got.Profile.Key != c.profile || got.Label != c.label || got.Reason != c.reason {
			t.Errorf("%s: got %s %q %v, want %s %q %v", c.name, got.Profile.Key, got.Label, got.Reason, c.profile, c.label, c.reason)
		}
	}
}

func TestTheKidsSwapOnlyAppliesToHDAndToEnabledKidsProfiles(t *testing.T) {
	all := profilesWith(func(m map[string]*profiles.Profile) {
		m["uhd-primary"].DefaultMovies = true
		m["kids-primary"].Enabled = false
	})
	s := library.Suggest(all, library.Movie, certified("US", "G"), "US", profiles.DefaultKidsRule)
	if s.Slots[0].Profile.Key != "hd-primary" || s.Slots[1].Profile.Key != "uhd-primary" || s.Slots[1].Reason != library.ReasonDefault {
		t.Errorf("slots = %+v", s.Slots)
	}
}

func TestTheSuggestionCarriesTheRatingItWasMadeFrom(t *testing.T) {
	s := library.Suggest(profilesWith(nil), library.Movie, certified("DE", "6"), "DE", profiles.DefaultKidsRule)
	if s.CertificationCountry != "DE" || s.Certification != "6" {
		t.Errorf("rating = %s %q", s.CertificationCountry, s.Certification)
	}
}
