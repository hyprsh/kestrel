package profiles_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
	"github.com/hyprsh/kestrel/internal/store"
)

// remuxAndWeb makes HD Remux + WEB and 4K WEB, the Slots' defaults: under English both are backed, but French has
// no WEB and no Remux for Series.
func remuxAndWeb(t *testing.T, s *profiles.Service) {
	t.Helper()
	if err := s.SetAll(context.Background(), declareAll(t, s, map[string]profiles.State{
		"hd-primary": {Family: scoring.FamilyRemuxWeb}, "4k-primary": {Family: scoring.FamilyWeb},
	}), ""); err != nil {
		t.Fatal(err)
	}
}

func addKindTitle(t *testing.T, st *store.Store, id int, kind string, versions ...string) {
	t.Helper()
	mustExec(t, st, `INSERT INTO titles (id, kind, title, original_title, primary_title, year, tmdb_id, tvdb_id, root_folder, added_at, refreshed_at)
		VALUES (?, ?, 'T', 'T', 'T', 2021, ?, ?, '/m', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`, id, kind, id, id)
	for i, key := range versions {
		mustExec(t, st, `INSERT INTO versions (id, title_id, slot, profile_key, added_at) VALUES (?, ?, ?, ?, 'x')`, id*10+i, id, []string{"standard", "4k"}[i], key)
	}
}

func TestChangingThePrimaryLanguageIsRefusedWhileASlotDefaultWouldLoseItsBackingProfileForAKind(t *testing.T) {
	s, _ := newRig(t)
	ctx := context.Background()
	remuxAndWeb(t, s)
	fr := profiles.French
	_, err := s.SetRegion(ctx, profiles.RegionPatch{Primary: &fr})
	var ve *profiles.ValidationError
	if !errors.As(err, &ve) || ve.Field != "primary_language" {
		t.Fatalf("err = %v, want a ValidationError on primary_language", err)
	}
	for _, name := range []string{"HD", "4K", "Series"} {
		if !strings.Contains(ve.Message, name) {
			t.Errorf("message %q lacks %q", ve.Message, name)
		}
	}
	if strings.Contains(ve.Message, "Any") || strings.Contains(ve.Message, "Original") {
		t.Errorf("message %q names a Profile that keeps its backing profile", ve.Message)
	}
	if r, _, _ := s.Region(ctx); r.Primary != profiles.English {
		t.Errorf("a refused change moved the Primary Language to %q", r.Primary)
	}
	if m := byKey(t, s); m["hd-primary"].TrashMovies != "remux-web-1080p" {
		t.Errorf("a refused change re-backed hd-primary with %q", m["hd-primary"].TrashMovies)
	}
	// CheckPrimary answers the same without writing.
	if err := s.CheckPrimary(ctx, profiles.French); err == nil {
		t.Error("CheckPrimary accepted French")
	}
	if err := s.CheckPrimary(ctx, profiles.English); err != nil {
		t.Errorf("CheckPrimary refused the Primary Language it already is: %v", err)
	}
	// German backs HD Remux for both kinds but not 4K WEB, so it names only the 4K Profile.
	err = s.CheckPrimary(ctx, profiles.German)
	if !errors.As(err, &ve) || !strings.Contains(ve.Message, "4K") || strings.Contains(ve.Message, "HD") {
		t.Errorf("CheckPrimary(German) = %v, want a refusal naming 4K only", err)
	}
}

func TestADisabledProfileThatAVersionUsesHoldsThePrimaryLanguageToo(t *testing.T) {
	s, st := newRig(t)
	ctx := context.Background()
	remuxAndWeb(t, s)
	setSlotDefaults(t, st, "standard", "hd-original", "hd-original")
	setSlotDefaults(t, st, "4k", "4k-original", "4k-original")
	for _, key := range []string{"hd-primary", "4k-primary"} {
		if _, err := s.Patch(ctx, key, profiles.Patch{Enabled: no()}); err != nil {
			t.Fatal(err)
		}
	}
	fr := profiles.French
	// A Movie under HD Remux is fine under French (Movies are backed); a Series is not.
	addKindTitle(t, st, 1, "movie", "hd-primary")
	if err := s.CheckPrimary(ctx, fr); err != nil {
		t.Fatalf("a Movie Version of a Remux Profile under French: %v", err)
	}
	addKindTitle(t, st, 2, "series", "hd-primary")
	err := s.CheckPrimary(ctx, fr)
	var ve *profiles.ValidationError
	if !errors.As(err, &ve) || !strings.Contains(ve.Message, "HD") || !strings.Contains(ve.Message, "Series") || strings.Contains(ve.Message, "4K") {
		t.Fatalf("a Series Version of a disabled Profile: err = %v, want a refusal naming HD for Series only", err)
	}
	if _, err := s.SetRegion(ctx, profiles.RegionPatch{Primary: &fr}); err == nil {
		t.Error("SetRegion let a used, disabled Profile lose its Series backing")
	}
}

func TestAProfileNothingUsesMayLoseItsBackingButCannotBeEnabledWithout(t *testing.T) {
	s, st := newRig(t)
	ctx := context.Background()
	remuxAndWeb(t, s)
	setSlotDefaults(t, st, "standard", "hd-original", "hd-original")
	setSlotDefaults(t, st, "4k", "4k-original", "4k-original")
	fr := profiles.French
	if _, err := s.SetRegion(ctx, profiles.RegionPatch{Primary: &fr}); err != nil {
		t.Fatalf("French with nothing using the Profiles: %v", err)
	}
	m := byKey(t, s)
	if p := m["4k-primary"]; p.Enabled || p.TrashMovies != "" || p.TrashSeries != "" || p.AppliesTo("movie") {
		t.Errorf("4k-primary (WEB) under French = %+v, want disabled and backed by nothing", p)
	}
	if p := m["hd-primary"]; p.TrashMovies != "french-multi-vf-hd-remux-web" || p.TrashSeries != "" {
		t.Errorf("hd-primary (Remux) under French: %q / %q, want Movies only", p.TrashMovies, p.TrashSeries)
	}
	if _, err := s.Patch(ctx, "4k-primary", profiles.Patch{Enabled: yes()}); err == nil {
		t.Error("enabled a Profile with no backing profile")
	} else {
		wantField(t, err, "enabled")
	}
	// English again: it has a backing profile, and can be enabled.
	en := profiles.English
	if _, err := s.SetRegion(ctx, profiles.RegionPatch{Primary: &en}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Patch(ctx, "4k-primary", profiles.Patch{Enabled: yes()}); err != nil {
		t.Errorf("enabling it under English: %v", err)
	}
	if p := byKey(t, s)["4k-primary"]; p.TrashMovies != "web-2160p" || p.TrashSeries != "web-2160p" {
		t.Errorf("4k-primary under English = %q / %q", p.TrashMovies, p.TrashSeries)
	}
}
