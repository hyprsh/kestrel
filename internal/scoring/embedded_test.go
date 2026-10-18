package scoring_test

import (
	"os"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/resolution"
	"github.com/hyprsh/kestrel/internal/scoring"
)

func embedded(t testing.TB) *scoring.Snapshot {
	t.Helper()
	snap, err := scoring.Embedded()
	if err != nil {
		t.Fatalf("Embedded: %v", err)
	}
	return snap
}

func TestEmbeddedSnapshotCarriesItsLicenceAndCommit(t *testing.T) {
	if got := embedded(t).Commit(); len(got) != 40 {
		t.Errorf("Commit() = %q, want a 40 character commit hash", got)
	}
	lic, err := os.ReadFile("trash/LICENSE")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(lic), "MIT License") || !strings.Contains(string(lic), "TRaSH") {
		t.Errorf("trash/LICENSE does not look like TRaSH's MIT licence:\n%s", lic)
	}
}

// The backing-profile table of PRD Settled 5.
func TestBackingProfileTable(t *testing.T) {
	snap := embedded(t)
	type row struct {
		primary release.Language
		rule    scoring.LanguageRule
		slot    resolution.Class
		wide    bool
		movie   string
		series  string
	}
	rows := []row{
		{release.LangGerman, scoring.PrimaryLanguage, resolution.HD, false, "german-hd-bluray-web", "german-hd-bluray-web"},
		{release.LangGerman, scoring.PrimaryLanguage, resolution.UHD, false, "german-uhd-bluray-web", "german-uhd-bluray-web"},
		{release.LangGerman, scoring.PrimaryLanguage, resolution.SD, false, "german-hd-bluray-web", "german-hd-bluray-web"},
		{release.LangGerman, scoring.PrimaryLanguage, resolution.HD, true, "german-hd-bluray-web", "german-hd-bluray-web"},
		{release.LangFrench, scoring.PrimaryLanguage, resolution.HD, false, "french-multi-vf-hd-bluray-web", "french-multi-vf-bluray-web-1080p"},
		{release.LangFrench, scoring.PrimaryLanguage, resolution.UHD, false, "french-multi-vf-uhd-bluray-web", "french-multi-vf-bluray-web-2160p"},
		{release.LangFrench, scoring.OriginalLanguage, resolution.HD, false, "french-multi-vo-hd-bluray-web", "french-multi-vo-bluray-web-1080p"},
		{release.LangFrench, scoring.OriginalLanguage, resolution.UHD, false, "french-multi-vo-uhd-bluray-web", "french-multi-vo-bluray-web-2160p"},
		{release.LangFrench, scoring.OriginalLanguage, resolution.SD, false, "french-multi-vo-hd-bluray-web", "french-multi-vo-bluray-web-1080p"},
		{release.LangEnglish, scoring.PrimaryLanguage, resolution.HD, false, "hd-bluray-web", "web-1080p"},
		{release.LangEnglish, scoring.OriginalLanguage, resolution.HD, false, "hd-bluray-web", "web-1080p"},
		{release.LangEnglish, scoring.PrimaryLanguage, resolution.UHD, false, "uhd-bluray-web", "web-2160p"},
		{release.LangGerman, scoring.OriginalLanguage, resolution.HD, false, "hd-bluray-web", "web-1080p"},
		{release.LangGerman, scoring.OriginalLanguage, resolution.UHD, false, "uhd-bluray-web", "web-2160p"},
	}
	for _, r := range rows {
		prof, err := snap.Profile(scoring.ProfileSpec{Slot: r.slot, Any: r.wide, Rule: r.rule, Primary: r.primary})
		if err != nil {
			t.Errorf("%s rule %d %v wide=%v: %v", r.primary.Name, r.rule, r.slot, r.wide, err)
			continue
		}
		if got := prof.BackingProfile(release.KindMovie); got != r.movie {
			t.Errorf("%s rule %d %v wide=%v: Movie backing %q, want %q", r.primary.Name, r.rule, r.slot, r.wide, got, r.movie)
		}
		if got := prof.BackingProfile(release.KindSeries); got != r.series {
			t.Errorf("%s rule %d %v wide=%v: Series backing %q, want %q", r.primary.Name, r.rule, r.slot, r.wide, got, r.series)
		}
	}
}

func TestEveryProfileOfEveryPrimaryLanguageResolves(t *testing.T) {
	snap := embedded(t)
	for _, primary := range []release.Language{release.LangEnglish, release.LangGerman, release.LangFrench} {
		for _, rule := range []scoring.LanguageRule{scoring.PrimaryLanguage, scoring.OriginalLanguage} {
			for _, slot := range []resolution.Class{resolution.SD, resolution.HD, resolution.UHD} {
				for _, wide := range []bool{false, true} {
					if wide && slot != resolution.HD {
						continue
					}
					if _, err := snap.Profile(scoring.ProfileSpec{Slot: slot, Any: wide, Rule: rule, Primary: primary}); err != nil {
						t.Errorf("%s rule=%d %v wide=%v: %v", primary.Name, rule, slot, wide, err)
					}
				}
			}
		}
	}
}

func TestUnsupportedPrimaryLanguageHasNoBackingProfile(t *testing.T) {
	_, err := embedded(t).Profile(scoring.ProfileSpec{Slot: resolution.HD, Primary: release.LangJapanese})
	if err == nil {
		t.Fatal("expected an error for a Primary Language TRaSH has no profiles for")
	}
}

func TestDerivedProfilesShareTheHDScoresAndChangeTheQualities(t *testing.T) {
	snap := embedded(t)
	spec := scoring.ProfileSpec{Rule: scoring.PrimaryLanguage, Primary: release.LangGerman}

	spec.Slot = resolution.HD
	hd, _ := snap.Profile(spec)
	spec.Slot = resolution.SD
	sd, _ := snap.Profile(spec)
	spec.Slot, spec.Any = resolution.HD, true
	wide, _ := snap.Profile(spec)

	if sd.MinHeight != 0 || sd.MaxHeight != 576 || hd.MinHeight != 720 || hd.MaxHeight != 1080 || wide.MinHeight != 0 || wide.MaxHeight != 1080 {
		t.Errorf("height bounds SD %d-%d, HD %d-%d, Any %d-%d", sd.MinHeight, sd.MaxHeight, hd.MinHeight, hd.MaxHeight, wide.MinHeight, wide.MaxHeight)
	}
	for _, q := range []string{"WEBDL-1080p", "Bluray-720p"} {
		if !contains(hd.AllowedQualities(release.KindMovie), q) {
			t.Errorf("HD should allow %s", q)
		}
	}
	for _, q := range []string{"SDTV", "DVD", "WEBDL-480p", "WEBRip-480p", "Bluray-480p", "Bluray-576p"} {
		if !contains(sd.AllowedQualities(release.KindMovie), q) {
			t.Errorf("SD should allow %s", q)
		}
		if !contains(wide.AllowedQualities(release.KindMovie), q) {
			t.Errorf("Any should allow %s", q)
		}
		if contains(hd.AllowedQualities(release.KindMovie), q) {
			t.Errorf("HD should not allow %s", q)
		}
	}
	if contains(sd.AllowedQualities(release.KindMovie), "WEBDL-1080p") {
		t.Error("SD should not allow WEBDL-1080p")
	}
	if !contains(wide.AllowedQualities(release.KindMovie), "WEBDL-1080p") {
		t.Error("Any keeps the HD qualities")
	}
	// Series Any widens to WEB 480p, 720p and 1080p, DVD and SDTV.
	for _, q := range []string{"WEBDL-480p", "WEBDL-720p", "WEBRip-720p", "WEBDL-1080p", "DVD", "SDTV"} {
		if !contains(wide.AllowedQualities(release.KindSeries), q) {
			t.Errorf("Series Any should allow %s", q)
		}
	}
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

// Worked examples from the TRaSH German profile data: an English-original
// Movie under [German] HD Bluray + WEB. The scores are the sums of the German
// score set's values: German DL 11000, German 10000, 1080p Booster 650,
// 1080p 50, 720p 5, German Web Tier 01 2100, German Bluray Tier 01 2900.
func TestGermanProfileScoresFollowTheTrashScoreSet(t *testing.T) {
	snap := embedded(t)
	cases := []struct {
		name string
		rel  string
		want int
	}{
		{"English WEB-DL 1080p from a German Web Tier 01 group",
			"A.Movie.2020.1080p.WEB-DL.DDP5.1.H.264-CNY", 50 + 2100},
		{"German-only WEB-DL 1080p from a German Web Tier 01 group",
			"A.Movie.2020.German.1080p.WEB-DL.DDP5.1.H.264-CNY", 10000 + 50 + 2100},
		{"German DL WEB-DL 1080p from a German Web Tier 01 group",
			"A.Movie.2020.German.DL.1080p.WEB-DL.DDP5.1.H.264-CNY", 11000 + 650 + 50 + 2100},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			prof, err := snap.Profile(scoring.ProfileSpec{Slot: resolution.HD, Rule: scoring.PrimaryLanguage, Primary: release.LangGerman})
			if err != nil {
				t.Fatal(err)
			}
			v := scoring.Evaluate(scoring.Release{Parsed: mustMovie(t, tc.rel)}, titleEN, prof)
			if v.Score != tc.want {
				t.Errorf("Score = %d, want %d; matched %+v", v.Score, tc.want, v.Matched)
			}
		})
	}
}
