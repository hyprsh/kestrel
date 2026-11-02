package api_test

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/jobs"
)

func TestAVersionInStandardSwitchesToThe4KProfileAndBackWithoutItsFileBeingRenamed(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	s.addMovie(t, `{"slot":"standard","profile":"hd-primary"}`)
	s.prober.set(goodProbe(), nil)
	s.download(t, map[string]string{"paddington.mkv": "the movie"})
	s.pass(t, jobs.Poll)
	s.pass(t, jobs.Import)
	before := s.version(t, s.hd)
	if before.File == nil {
		t.Fatal("the Version holds no file")
	}

	r := s.valid("PATCH", fmt.Sprintf("/versions/%d", s.hd), `{"profile":"4k-primary"}`)

	if r.Status != 200 {
		t.Fatalf("switch to the 4K Profile = %d %s", r.Status, r.Body)
	}
	got := s.version(t, s.hd)
	if got.Slot != "standard" || got.Profile != "4k-primary" || got.File == nil || got.File.Path != before.File.Path {
		t.Errorf("version = %+v, want it still in standard, under 4K, with the same file", got)
	}
	if _, err := os.Stat(before.File.Path); err != nil {
		t.Errorf("the file was renamed or removed: %v", err)
	}

	if r := s.valid("PATCH", fmt.Sprintf("/versions/%d", s.hd), `{"profile":"hd-primary"}`); r.Status != 200 {
		t.Fatalf("switching back = %d %s", r.Status, r.Body)
	}
	if back := s.version(t, s.hd); back.Profile != "hd-primary" || back.Slot != "standard" || back.File == nil || back.File.Path != before.File.Path {
		t.Errorf("version = %+v, want HD again with the same file", back)
	}
}

func TestATitleCannotHoldTwoVersionsUnderOneProfile(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	s.addMovie(t, `{"slot":"standard","profile":"hd-primary"}`)
	path := fmt.Sprintf("/titles/%d/versions", s.title)

	// Adding: the 4K Slot cannot take the Profile Standard already uses.
	r := s.do("POST", path, `{"slot":"4k","profile":"hd-primary"}`)
	if r.Status != 422 || !strings.Contains(r.Body, `"field":"profile"`) || !strings.Contains(r.Body, "profile_taken") {
		t.Errorf("adding a taken Profile = %d %s, want 422 on profile", r.Status, r.Body)
	}
	r = s.valid("POST", path, `{"slot":"4k","profile":"4k-primary"}`)
	if r.Status != 201 {
		t.Fatalf("adding a free Profile = %d %s", r.Status, r.Body)
	}
	uhd := decode[versionJSON](t, r).ID

	// Switching: neither Version can take the other's Profile.
	r = s.do("PATCH", fmt.Sprintf("/versions/%d", s.hd), `{"profile":"4k-primary"}`)
	if r.Status != 422 || !strings.Contains(r.Body, "profile_taken") {
		t.Errorf("switching to a taken Profile = %d %s, want 422", r.Status, r.Body)
	}
	if got := s.version(t, s.hd); got.Profile != "hd-primary" {
		t.Errorf("a refused switch moved the Version to %q", got.Profile)
	}

	// Any Profile still fits any Slot: the 4K Slot's Version can take a Standard-range Profile.
	if r := s.valid("PATCH", fmt.Sprintf("/versions/%d", uhd), `{"profile":"any-primary"}`); r.Status != 200 {
		t.Errorf("a 4K Version under a Standard-range Profile = %d %s", r.Status, r.Body)
	}
}

func TestSettingsWarnsWhenTwoSlotsShareADefaultProfileForAKind(t *testing.T) {
	t.Parallel()
	b := newInstance(t, "").setUp()
	has := func() string { return b.valid("GET", "/settings", "").Body }
	if body := has(); strings.Contains(body, "shared_slot_default") {
		t.Fatalf("a fresh library warns: %s", body)
	}

	b.valid("PATCH", "/slots/4k", `{"default_movies":"hd-primary"}`) // a warning, not an error

	body := has()
	for _, want := range []string{`"code":"shared_slot_default"`, `"kind":"movies"`, `"profile":"hd-primary"`, `"slots":["standard","4k"]`} {
		if !strings.Contains(body, want) {
			t.Errorf("settings = %s, want %s", body, want)
		}
	}
	if strings.Contains(body, `"kind":"series"`) {
		t.Errorf("Series defaults are not shared: %s", body)
	}
}
