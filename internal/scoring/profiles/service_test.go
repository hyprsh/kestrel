package profiles_test

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
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
		if !p.Enabled || p.OriginalChoice != scoring.OriginalReject {
			t.Errorf("%s: enabled=%v original=%q, want enabled, rejecting originals", p.Key, p.Enabled, p.OriginalChoice)
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
	if k := m["any-primary"]; !k.Any || k.MinHeight != 0 || k.MaxHeight != 1080 {
		t.Errorf("any-primary = %+v", k)
	}
	if o := m["4k-original"]; o.Rule != scoring.OriginalLanguage || o.MinHeight != 2160 || o.MaxHeight != 2160 {
		t.Errorf("4k-original = %+v", o)
	}
}

func choice(c scoring.OriginalChoice) *scoring.OriginalChoice { return &c }

func TestOriginalLanguageChoiceIsRejectedOnOriginalLanguageProfiles(t *testing.T) {
	s := newService(t)
	for _, c := range []scoring.OriginalChoice{scoring.OriginalOffer, scoring.OriginalAccept} {
		_, err := s.Patch(context.Background(), "hd-original", profiles.Patch{OriginalChoice: choice(c)})
		wantField(t, err, "original_language")
	}
	if _, err := s.Patch(context.Background(), "hd-original", profiles.Patch{OriginalChoice: choice(scoring.OriginalReject)}); err != nil {
		t.Errorf("reject on an Original-Language Profile: %v", err)
	}
	_, err := s.Patch(context.Background(), "hd-primary", profiles.Patch{OriginalChoice: choice("maybe")})
	wantField(t, err, "original_language")

	for _, c := range []scoring.OriginalChoice{scoring.OriginalOffer, scoring.OriginalAccept, scoring.OriginalReject} {
		p, err := s.Patch(context.Background(), "hd-primary", profiles.Patch{OriginalChoice: choice(c)})
		if err != nil || p.OriginalChoice != c {
			t.Fatalf("Primary-Language %s: %+v, %v", c, p, err)
		}
		if got := byKey(t, s)["hd-primary"].OriginalChoice; got != c {
			t.Errorf("stored %q, want %q", got, c)
		}
	}
}

func TestUnknownProfileKey(t *testing.T) {
	_, err := newService(t).Patch(context.Background(), "nope", profiles.Patch{Enabled: yes()})
	if !errors.Is(err, profiles.ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

func setSlotDefaults(t *testing.T, st *store.Store, slotID, movies, series string) {
	t.Helper()
	mustExec(t, st, `UPDATE slots SET default_movies = ?, default_series = ? WHERE id = ?`, movies, series, slotID)
}

func TestAProfileASlotDefaultsToCannotBeDisabled(t *testing.T) {
	s, st := newRig(t)
	ctx := context.Background()

	// A fresh library has hd-primary as the Standard default and 4k-primary as the 4K default.
	for _, key := range []string{"hd-primary", "4k-primary"} {
		_, err := s.Patch(ctx, key, profiles.Patch{Enabled: no()})
		var de *profiles.DefaultError
		if !errors.As(err, &de) || de.Profile != key {
			t.Fatalf("disabling the default %s: err = %v, want a *DefaultError", key, err)
		}
	}
	if p := byKey(t, s)["hd-primary"]; !p.Enabled {
		t.Errorf("hd-primary changed by a rejected patch: %+v", p)
	}

	// A Profile that is the default for one kind only is still held.
	setSlotDefaults(t, st, "standard", "hd-original", "hd-primary")
	if _, err := s.Patch(ctx, "hd-primary", profiles.Patch{Enabled: no()}); err == nil {
		t.Error("disabled the Series default")
	}
	// Once the default moves, the old one can go.
	setSlotDefaults(t, st, "standard", "hd-original", "hd-original")
	if _, err := s.Patch(ctx, "hd-primary", profiles.Patch{Enabled: no()}); err != nil {
		t.Fatalf("disabling a Profile no Slot defaults to: %v", err)
	}
	// Any Profile can be a Slot's default, so a Profile no Slot used before can be held too.
	setSlotDefaults(t, st, "4k", "any-primary", "any-primary")
	if _, err := s.Patch(ctx, "any-primary", profiles.Patch{Enabled: no()}); err == nil {
		t.Error("disabled the 4K Slot's default, a Standard-range Profile")
	}
}

func TestAProfileASlotDefaultsToCannotBeDeleted(t *testing.T) {
	s, st := newRig(t)
	ctx := context.Background()
	p, err := s.Create(ctx, "Mine", "hd-primary")
	if err != nil {
		t.Fatal(err)
	}
	setSlotDefaults(t, st, "4k", p.Key, p.Key)
	var de *profiles.DefaultError
	if err := s.Delete(ctx, p.Key); !errors.As(err, &de) {
		t.Fatalf("deleting a Slot's default: err = %v, want a *DefaultError", err)
	}
	setSlotDefaults(t, st, "4k", "4k-primary", "4k-primary")
	if err := s.Delete(ctx, p.Key); err != nil {
		t.Fatalf("deleting it once no Slot defaults to it: %v", err)
	}
}

func TestOriginalLanguageChoiceIsKeptWhenDisabling(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	if _, err := s.Patch(ctx, "any-primary", profiles.Patch{OriginalChoice: choice(scoring.OriginalOffer)}); err != nil {
		t.Fatal(err)
	}
	p, err := s.Patch(ctx, "any-primary", profiles.Patch{Enabled: no()})
	if err != nil || p.OriginalChoice != scoring.OriginalOffer {
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
	if _, err := s.Patch(ctx, "hd-primary", profiles.Patch{OriginalChoice: choice(scoring.OriginalAccept)}); err != nil {
		t.Fatal(err)
	}
	fr := profiles.French
	if _, err := s.SetRegion(ctx, profiles.RegionPatch{Primary: &fr}); err != nil {
		t.Fatal(err)
	}
	p := byKey(t, s)["hd-primary"]
	if p.OriginalChoice != scoring.OriginalAccept || !p.Enabled {
		t.Errorf("settings lost on re-point: %+v", p)
	}
}

func TestAProfilesOwnHeightRangeIsTheOnlyResolutionRule(t *testing.T) {
	for _, p := range profiles.Builtin() {
		if p.MinHeight < 0 || p.MaxHeight > 2160 || p.MinHeight > p.MaxHeight {
			t.Errorf("builtin %s: heights %d-%d", p.Key, p.MinHeight, p.MaxHeight)
		}
	}
	st, err := store.Open(context.Background(), store.Options{Dir: storetest.Dir(t)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	n := 0
	insert := func(minH, maxH int) error {
		n++
		_, err := st.Write().Exec(`INSERT INTO profiles (key, name, sort, any, language_rule, min_height, max_height, trash_profile_movies, trash_profile_series)
			VALUES (?, 'X', 99, 0, 'primary', ?, ?, 'a', 'b')`, fmt.Sprintf("x-%d", n), minH, maxH)
		return err
	}
	for _, c := range [][2]int{{0, 2160}, {1080, 2160}, {2160, 2160}, {480, 1080}} {
		if err := insert(c[0], c[1]); err != nil {
			t.Errorf("a Profile %d-%d was refused: %v", c[0], c[1], err)
		}
	}
	for _, c := range [][2]int{{0, 4320}, {1080, 720}, {-1, 1080}} {
		if err := insert(c[0], c[1]); err == nil {
			t.Errorf("a Profile %d-%d was stored", c[0], c[1])
		}
	}
}

func TestRestoreRegionPutsBackTheStoredStateIncludingNotSavedYet(t *testing.T) {
	ctx := context.Background()
	s := newService(t)
	before, saved, _ := s.Region(ctx)
	de := profiles.German
	if _, err := s.SetRegion(ctx, profiles.RegionPatch{Primary: &de}); err != nil {
		t.Fatal(err)
	}
	if err := s.RestoreRegion(ctx, before, saved); err != nil {
		t.Fatal(err)
	}
	if r, saved, _ := s.Region(ctx); saved || r != before {
		t.Errorf("after restoring an unsaved region: %+v saved=%v, want %+v not saved", r, saved, before)
	}

	fr := profiles.French
	if _, err := s.SetRegion(ctx, profiles.RegionPatch{Primary: &fr}); err != nil {
		t.Fatal(err)
	}
	before, saved, _ = s.Region(ctx)
	if _, err := s.SetRegion(ctx, profiles.RegionPatch{Primary: &de}); err != nil {
		t.Fatal(err)
	}
	if err := s.RestoreRegion(ctx, before, saved); err != nil {
		t.Fatal(err)
	}
	if r, saved, _ := s.Region(ctx); !saved || r != before {
		t.Errorf("after restoring a saved region: %+v saved=%v, want %+v saved", r, saved, before)
	}
}
