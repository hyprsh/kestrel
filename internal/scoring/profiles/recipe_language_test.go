package profiles_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
)

func TestChangingThePrimaryLanguageIsRefusedWhileAnEnabledProfileWouldLoseItsBackingProfile(t *testing.T) {
	s, st := newRig(t)
	ctx := context.Background()
	// Under English, HD is Remux + WEB and 4K is WEB: both are backed, but French has no WEB and no Remux for Series.
	if err := s.SetAll(ctx, declareAll(t, s, map[string]profiles.State{
		"hd-primary": {Family: scoring.FamilyRemuxWeb}, "4k-primary": {Family: scoring.FamilyWeb},
	})); err != nil {
		t.Fatal(err)
	}
	fr := profiles.French
	_, err := s.SetRegion(ctx, profiles.RegionPatch{Primary: &fr})
	var ve *profiles.ValidationError
	if !errors.As(err, &ve) || ve.Field != "primary_language" {
		t.Fatalf("err = %v, want a ValidationError on primary_language", err)
	}
	for _, name := range []string{"HD", "4K"} {
		if !strings.Contains(ve.Message, name) {
			t.Errorf("message %q does not name the Profile %q", ve.Message, name)
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

	// CheckPrimary answers the same without writing, for the API to refuse before it queues the change.
	if err := s.CheckPrimary(ctx, profiles.French); err == nil {
		t.Error("CheckPrimary accepted French")
	}
	if err := s.CheckPrimary(ctx, profiles.English); err != nil {
		t.Errorf("CheckPrimary refused the Primary Language it already is: %v", err)
	}
	// German backs HD Remux but not 4K WEB, so it names only the 4K Profile.
	err = s.CheckPrimary(ctx, profiles.German)
	if !errors.As(err, &ve) || !strings.Contains(ve.Message, "4K") || strings.Contains(ve.Message, "HD") {
		t.Errorf("CheckPrimary(German) = %v, want a refusal naming 4K only", err)
	}

	// A disabled Profile is not held to it: disable them (moving the Slots' defaults first) and the change goes through.
	setSlotDefaults(t, st, "standard", "hd-original", "hd-original")
	setSlotDefaults(t, st, "4k", "4k-original", "4k-original")
	for _, key := range []string{"hd-primary", "4k-primary"} {
		if _, err := s.Patch(ctx, key, profiles.Patch{Enabled: no()}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.SetRegion(ctx, profiles.RegionPatch{Primary: &fr}); err != nil {
		t.Fatalf("French with the Profiles disabled: %v", err)
	}
	// And such a Profile cannot be enabled again where it has no backing profile.
	if _, err := s.Patch(ctx, "hd-primary", profiles.Patch{Enabled: yes()}); err == nil {
		t.Error("enabled a Profile with no backing profile in the Primary Language")
	} else {
		wantField(t, err, "enabled")
	}
}
