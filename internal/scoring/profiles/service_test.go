package profiles_test

import (
	"context"
	"errors"
	"fmt"
	"github.com/hyprsh/kestrel/internal/slot"
	"testing"

	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
	"github.com/hyprsh/kestrel/internal/scoring/profiles/db"
	"github.com/hyprsh/kestrel/internal/settings"
	"github.com/hyprsh/kestrel/internal/store"
	"github.com/hyprsh/kestrel/internal/store/storetest"
)

func newService(t *testing.T) *profiles.Service {
	t.Helper()
	st, err := store.Open(context.Background(), store.Options{Dir: storetest.Dir(t)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return profiles.New(st, settings.New(st))
}

func byKey(t *testing.T, s *profiles.Service) map[string]profiles.Profile {
	t.Helper()
	all, err := s.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	m := map[string]profiles.Profile{}
	for _, p := range all {
		m[p.Key] = p
	}
	return m
}

func yes() *bool { b := true; return &b }
func no() *bool  { b := false; return &b }

func wantField(t *testing.T, err error, field string) {
	t.Helper()
	var ve *profiles.ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("err = %v, want a ValidationError on %q", err, field)
	}
	if ve.Field != field {
		t.Errorf("ValidationError on %q, want %q (%v)", ve.Field, field, err)
	}
}

func TestSeedsTheSixBuiltinProfiles(t *testing.T) {
	s := newService(t)
	all, err := s.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	var keys []string
	for _, p := range all {
		keys = append(keys, p.Key)
		if !p.Enabled || p.OriginalFallback {
			t.Errorf("%s: enabled=%v fallback=%v, want enabled without fallback", p.Key, p.Enabled, p.OriginalFallback)
		}
	}
	want := []string{"hd-primary", "hd-original", "any-primary", "any-original", "4k-primary", "4k-original"}
	if len(keys) != len(want) {
		t.Fatalf("keys = %v, want %v", keys, want)
	}
	for i := range want {
		if keys[i] != want[i] {
			t.Fatalf("keys = %v, want %v", keys, want)
		}
	}
	m := byKey(t, s)
	if hd := m["hd-primary"]; !hd.DefaultMovies || !hd.DefaultSeries {
		t.Errorf("hd-primary is not the default of both kinds: %+v", hd)
	}
	for _, k := range []string{"4k-original", "4k-primary", "any-primary", "hd-original"} {
		if m[k].DefaultMovies || m[k].DefaultSeries {
			t.Errorf("%s has a default out of the box", k)
		}
	}
	if k := m["any-primary"]; !k.Any || k.Slot != slot.Standard || k.MinHeight != 0 || k.MaxHeight != 1080 {
		t.Errorf("any-primary = %+v", k)
	}
	if o := m["4k-original"]; o.Rule != scoring.OriginalLanguage || o.Slot != slot.FourK || o.MinHeight != 2160 {
		t.Errorf("4k-original = %+v", o)
	}
}

func TestOriginalFallbackIsRejectedOnOriginalLanguageProfiles(t *testing.T) {
	s := newService(t)
	_, err := s.Patch(context.Background(), "hd-original", profiles.Patch{OriginalFallback: yes()})
	wantField(t, err, "original_fallback")

	p, err := s.Patch(context.Background(), "hd-primary", profiles.Patch{OriginalFallback: yes()})
	if err != nil || !p.OriginalFallback {
		t.Fatalf("Primary-Language fallback: %+v, %v", p, err)
	}
	if !byKey(t, s)["hd-primary"].OriginalFallback {
		t.Error("fallback not stored")
	}
}

func TestUnknownProfileKey(t *testing.T) {
	_, err := newService(t).Patch(context.Background(), "nope", profiles.Patch{Enabled: yes()})
	if !errors.Is(err, profiles.ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

func TestAtMostOneDefaultPerSlotAndKind(t *testing.T) {
	s := newService(t)
	ctx := context.Background()

	// Moving the HD default for Movies leaves Series alone.
	if _, err := s.Patch(ctx, "any-primary", profiles.Patch{DefaultMovies: yes()}); err != nil {
		t.Fatal(err)
	}
	m := byKey(t, s)
	if m["hd-primary"].DefaultMovies || !m["any-primary"].DefaultMovies {
		t.Errorf("movies default did not move: hd=%v wide=%v", m["hd-primary"].DefaultMovies, m["any-primary"].DefaultMovies)
	}
	if !m["hd-primary"].DefaultSeries || m["any-primary"].DefaultSeries {
		t.Errorf("series default moved too")
	}

	// 4K takes a default and let go of it.
	if _, err := s.Patch(ctx, "4k-primary", profiles.Patch{DefaultSeries: yes()}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Patch(ctx, "4k-original", profiles.Patch{DefaultSeries: yes()}); err != nil {
		t.Fatal(err)
	}
	m = byKey(t, s)
	if m["4k-primary"].DefaultSeries || !m["4k-original"].DefaultSeries {
		t.Errorf("4K series default did not move: %+v %+v", m["4k-primary"], m["4k-original"])
	}
	if _, err := s.Patch(ctx, "4k-original", profiles.Patch{DefaultSeries: no()}); err != nil {
		t.Fatalf("unsetting a 4K default: %v", err)
	}
	for _, p := range byKey(t, s) {
		if p.Slot == slot.FourK && p.DefaultSeries {
			t.Errorf("%s kept its default", p.Key)
		}
	}
}

func TestHDAlwaysHasExactlyOneDefault(t *testing.T) {
	s := newService(t)
	ctx := context.Background()

	_, err := s.Patch(ctx, "hd-primary", profiles.Patch{DefaultMovies: no()})
	wantField(t, err, "default_movies")
	_, err = s.Patch(ctx, "hd-primary", profiles.Patch{DefaultSeries: no()})
	wantField(t, err, "default_series")
	_, err = s.Patch(ctx, "hd-primary", profiles.Patch{Enabled: no()})
	wantField(t, err, "enabled")

	// Unchanged after the refusals.
	if p := byKey(t, s)["hd-primary"]; !p.Enabled || !p.DefaultMovies || !p.DefaultSeries {
		t.Errorf("hd-primary changed by a rejected patch: %+v", p)
	}

	// Another HD default for both kinds frees hd-primary to be disabled.
	if _, err := s.Patch(ctx, "hd-original", profiles.Patch{DefaultMovies: yes(), DefaultSeries: yes()}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Patch(ctx, "hd-primary", profiles.Patch{Enabled: no()}); err != nil {
		t.Fatalf("disabling a non-default HD Profile: %v", err)
	}
}

func TestDisablingAProfileClearsItsDefaults(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	if _, err := s.Patch(ctx, "4k-primary", profiles.Patch{DefaultMovies: yes(), DefaultSeries: yes()}); err != nil {
		t.Fatal(err)
	}
	p, err := s.Patch(ctx, "4k-primary", profiles.Patch{Enabled: no()})
	if err != nil {
		t.Fatal(err)
	}
	if p.Enabled || p.DefaultMovies || p.DefaultSeries {
		t.Errorf("after disabling: %+v", p)
	}
}

func TestADisabledProfileCannotBeADefault(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	if _, err := s.Patch(ctx, "4k-original", profiles.Patch{Enabled: no()}); err != nil {
		t.Fatal(err)
	}
	_, err := s.Patch(ctx, "4k-original", profiles.Patch{DefaultMovies: yes()})
	wantField(t, err, "default_movies")
	// Enabling and defaulting in one patch is fine.
	if _, err := s.Patch(ctx, "4k-original", profiles.Patch{Enabled: yes(), DefaultMovies: yes()}); err != nil {
		t.Fatalf("enable and default together: %v", err)
	}
}

func TestOriginalFallbackIsKeptWhenDisabling(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	if _, err := s.Patch(ctx, "4k-primary", profiles.Patch{OriginalFallback: yes()}); err != nil {
		t.Fatal(err)
	}
	p, err := s.Patch(ctx, "4k-primary", profiles.Patch{Enabled: no()})
	if err != nil || !p.OriginalFallback {
		t.Fatalf("%+v, %v", p, err)
	}
}

func TestRegionDefaultsAndValidation(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	r, saved, err := s.Region(ctx)
	if err != nil || saved || r.Primary != profiles.English || r.Country != "US" {
		t.Fatalf("defaults: %+v saved=%v err=%v", r, saved, err)
	}
	de := profiles.German
	r, err = s.SetRegion(ctx, profiles.RegionPatch{Primary: &de, Country: strp("DE")})
	if err != nil || r.Primary != profiles.German || r.Country != "DE" {
		t.Fatalf("SetRegion: %+v, %v", r, err)
	}
	if _, saved, _ := s.Region(ctx); !saved {
		t.Error("region not reported as saved")
	}

	bad := profiles.Language("klingon")
	_, err = s.SetRegion(ctx, profiles.RegionPatch{Primary: &bad})
	wantField(t, err, "primary_language")
	_, err = s.SetRegion(ctx, profiles.RegionPatch{Country: strp("Germany")})
	wantField(t, err, "release_date_country")
	_, err = s.SetRegion(ctx, profiles.RegionPatch{Country: strp("de")})
	wantField(t, err, "release_date_country")
}

func strp(s string) *string { return &s }

// The re-point table of PRD Settled 5, checked against the scoring package's
// own resolution of each Profile.
func TestChangingThePrimaryLanguageRepointsTheSixProfiles(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	want := map[profiles.Language]map[string][2]string{
		profiles.German: {
			"hd-primary":  {"german-hd-bluray-web", "german-hd-bluray-web"},
			"any-primary": {"german-hd-bluray-web", "german-hd-bluray-web"}, "4k-primary": {"german-uhd-bluray-web", "german-uhd-bluray-web"},
			"hd-original":  {"hd-bluray-web", "web-1080p"},
			"any-original": {"hd-bluray-web", "web-1080p"}, "4k-original": {"uhd-bluray-web", "web-2160p"},
		},
		profiles.French: {
			"hd-primary":   {"french-multi-vf-hd-bluray-web", "french-multi-vf-bluray-web-1080p"},
			"4k-primary":   {"french-multi-vf-uhd-bluray-web", "french-multi-vf-bluray-web-2160p"},
			"any-original": {"french-multi-vo-hd-bluray-web", "french-multi-vo-bluray-web-1080p"},
			"4k-original":  {"french-multi-vo-uhd-bluray-web", "french-multi-vo-bluray-web-2160p"},
		},
		profiles.English: {
			"hd-primary": {"hd-bluray-web", "web-1080p"}, "4k-original": {"uhd-bluray-web", "web-2160p"},
		},
	}
	// German's Series rows: Settled 5 gives german-hd-bluray-web for both apps.
	for _, lang := range []profiles.Language{profiles.German, profiles.French, profiles.English} {
		l := lang
		if _, err := s.SetRegion(ctx, profiles.RegionPatch{Primary: &l}); err != nil {
			t.Fatal(err)
		}
		m := byKey(t, s)
		for key, w := range want[lang] {
			if m[key].TrashMovies != w[0] || m[key].TrashSeries != w[1] {
				t.Errorf("%s under %s: %q / %q, want %q / %q", key, lang, m[key].TrashMovies, m[key].TrashSeries, w[0], w[1])
			}
		}
		// And every row agrees with what scoring resolves for the same spec.
		snap, err := scoring.Embedded()
		if err != nil {
			t.Fatal(err)
		}
		for key, p := range m {
			sp, err := snap.Profile(p.Spec(lang.Release()))
			if err != nil {
				t.Fatalf("%s under %s: %v", key, lang, err)
			}
			if p.TrashMovies != sp.BackingProfile(release.KindMovie) || p.TrashSeries != sp.BackingProfile(release.KindSeries) {
				t.Errorf("%s under %s: stored %q / %q, scoring backs it with %q / %q", key, lang, p.TrashMovies, p.TrashSeries,
					sp.BackingProfile(release.KindMovie), sp.BackingProfile(release.KindSeries))
			}
		}
	}
}

func TestRepointKeepsProfileSettings(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	if _, err := s.Patch(ctx, "hd-primary", profiles.Patch{OriginalFallback: yes()}); err != nil {
		t.Fatal(err)
	}
	fr := profiles.French
	if _, err := s.SetRegion(ctx, profiles.RegionPatch{Primary: &fr}); err != nil {
		t.Fatal(err)
	}
	p := byKey(t, s)["hd-primary"]
	if !p.OriginalFallback || !p.DefaultMovies || !p.Enabled {
		t.Errorf("settings lost on re-point: %+v", p)
	}
}

func TestSeededProfilesLieInsideTheirSlot(t *testing.T) {
	for _, p := range byKey(t, newService(t)) {
		if !p.Slot.Contains(p.MinHeight, p.MaxHeight) {
			t.Errorf("%s: heights %d-%d are outside the %v Slot", p.Key, p.MinHeight, p.MaxHeight, p.Slot)
		}
	}
	for _, p := range profiles.Builtin() {
		if !p.Slot.Contains(p.MinHeight, p.MaxHeight) {
			t.Errorf("builtin %s: heights %d-%d are outside the %v Slot", p.Key, p.MinHeight, p.MaxHeight, p.Slot)
		}
	}
}

func TestLoadingARowOutsideItsSlotIsAnError(t *testing.T) {
	row := db.Profile{Key: "x", Name: "X", Slot: "standard", LanguageRule: "primary", MinHeight: 0, MaxHeight: 2160}
	if _, err := profiles.FromRow(row); err == nil {
		t.Error("a Standard row up to 2160p loaded")
	}
	row.MaxHeight = 1080
	if _, err := profiles.FromRow(row); err != nil {
		t.Errorf("a Standard row 0-1080 was refused: %v", err)
	}
}

func TestAProfileOutsideItsSlotCannotBeStored(t *testing.T) {
	st, err := store.Open(context.Background(), store.Options{Dir: storetest.Dir(t)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	n := 0
	insert := func(slotKey string, minH, maxH int) error {
		n++
		_, err := st.Write().Exec(`INSERT INTO profiles (key, name, sort, slot, any, language_rule, min_height, max_height, trash_profile_movies, trash_profile_series)
			VALUES (?, 'X', 99, ?, 0, 'primary', ?, ?, 'a', 'b')`, fmt.Sprintf("x-%d", n), slotKey, minH, maxH)
		return err
	}
	if err := insert("standard", 0, 2160); err == nil {
		t.Error("a Standard Profile up to 2160p was stored")
	}
	if err := insert("4k", 1080, 2160); err == nil {
		t.Error("a 4K Profile from 1080p was stored")
	}
	if err := insert("hd", 720, 1080); err == nil {
		t.Error("a Profile in the retired hd Slot was stored")
	}
	if err := insert("standard", 480, 1080); err != nil {
		t.Errorf("a Standard Profile 480-1080 was refused: %v", err)
	}
}
