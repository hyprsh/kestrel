package slots_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/slot"
	"github.com/hyprsh/kestrel/internal/slot/slots"
	"github.com/hyprsh/kestrel/internal/store"
	"github.com/hyprsh/kestrel/internal/store/storetest"
)

func newService(t *testing.T) (*slots.Service, *store.Store) {
	t.Helper()
	st, err := store.Open(context.Background(), store.Options{Dir: storetest.Dir(t)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return slots.New(st), st
}

func list(t *testing.T, s *slots.Service) []slot.Record {
	t.Helper()
	got, err := s.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return got
}

func ids(rs []slot.Record) string {
	var out []string
	for _, r := range rs {
		out = append(out, string(r.ID))
	}
	return strings.Join(out, ",")
}

// addVersion puts a Version in sl, under a throwaway Title.
func addVersion(t *testing.T, st *store.Store, titleID int, sl string) {
	t.Helper()
	for _, q := range []string{
		`INSERT OR IGNORE INTO titles (id, kind, title, original_title, primary_title, tmdb_id, root_folder, added_at, refreshed_at) VALUES (` + itoa(titleID) + `, 'movie', 'T', 'T', 'T', ` + itoa(titleID) + `, '/m', 'x', 'x')`,
		`INSERT INTO versions (title_id, slot, profile_key, added_at) VALUES (` + itoa(titleID) + `, '` + sl + `', 'hd-primary', 'x')`,
	} {
		if _, err := st.Write().Exec(q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
}

func itoa(n int) string { return string(rune('0' + n)) }

func ruleOf(t *testing.T, err error) *slot.RuleError {
	t.Helper()
	var re *slot.RuleError
	if !errors.As(err, &re) {
		t.Fatalf("err = %v, want a *slot.RuleError", err)
	}
	return re
}

func TestAFreshDatabaseListsTheTwoSeededSlots(t *testing.T) {
	s, _ := newService(t)
	got := list(t, s)
	if len(got) != 2 {
		t.Fatalf("slots = %+v", got)
	}
	std, fourK := got[0], got[1]
	if std.ID != "standard" || std.Label != "Standard" || !std.OnForNew || std.DefaultMovies != "hd-primary" || std.DefaultSeries != "hd-primary" || std.Position != 0 {
		t.Errorf("standard = %+v", std)
	}
	if fourK.ID != "4k" || fourK.Label != "4K" || fourK.OnForNew || fourK.DefaultMovies != "" || fourK.DefaultSeries != "" || fourK.Position != 1 {
		t.Errorf("4k = %+v", fourK)
	}
}

func TestCreateAppendsASlotWithAnIdFromItsLabel(t *testing.T) {
	s, _ := newService(t)
	got, err := s.Create(context.Background(), slots.Create{Label: "Remux", DefaultMovies: "4k-primary", OnForNew: true})
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != "remux" || got.Position != 2 || got.DefaultMovies != "4k-primary" || !got.OnForNew {
		t.Errorf("created = %+v", got)
	}
	if ids(list(t, s)) != "standard,4k,remux" {
		t.Errorf("slots = %s", ids(list(t, s)))
	}
}

func TestCreateRefusesWhatBreaksARule(t *testing.T) {
	s, _ := newService(t)
	ctx := context.Background()
	for _, label := range []string{"Re[mux", "standard", "4K", "", " x"} {
		if _, err := s.Create(ctx, slots.Create{Label: label}); ruleOf(t, err).Conflict {
			t.Errorf("Create(%q) = %v, want an invalid value, not a conflict", label, err)
		}
	}
	if _, err := s.Create(ctx, slots.Create{Label: "Dub", DefaultMovies: "no-such-profile"}); ruleOf(t, err).Field != "default_movies" {
		t.Errorf("an unknown default Profile: %v", err)
	}
	for _, label := range []string{"A", "B"} {
		if _, err := s.Create(ctx, slots.Create{Label: label}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.Create(ctx, slots.Create{Label: "Fifth"}); ruleOf(t, err).Conflict || !strings.Contains(err.Error(), "at most 4") {
		t.Errorf("a 5th Slot: %v", err)
	}
	if ids(list(t, s)) != "standard,4k,a,b" {
		t.Errorf("a refused create changed the Slots: %s", ids(list(t, s)))
	}
}

func TestDeleteRefusesTheLastSlotTheLastOnForNewAndOneWithVersions(t *testing.T) {
	s, st := newService(t)
	ctx := context.Background()

	// Standard is the only Slot on for new Titles.
	if err := s.Delete(ctx, "standard"); !ruleOf(t, err).Conflict {
		t.Errorf("deleting the last on-for-new Slot: %v", err)
	}
	if err := s.Delete(ctx, "4k"); err != nil {
		t.Fatal(err)
	}
	if err := s.Delete(ctx, "standard"); !ruleOf(t, err).Conflict {
		t.Errorf("deleting the last Slot: %v", err)
	}

	if _, err := s.Create(ctx, slots.Create{Label: "Remux", OnForNew: true}); err != nil {
		t.Fatal(err)
	}
	addVersion(t, st, 1, "remux")
	err := s.Delete(ctx, "remux")
	if re := ruleOf(t, err); !re.Conflict || !strings.Contains(re.Message, "1 Version") {
		t.Errorf("deleting a Slot that holds a Version: %v", err)
	}
	if err := s.Delete(ctx, "nope"); !errors.Is(err, slots.ErrNotFound) {
		t.Errorf("deleting an unknown Slot: %v", err)
	}
	if ids(list(t, s)) != "standard,remux" {
		t.Errorf("slots = %s", ids(list(t, s)))
	}
}

func TestDeleteRemovesAnEmptySlotAndClosesTheGap(t *testing.T) {
	s, _ := newService(t)
	ctx := context.Background()
	if _, err := s.Create(ctx, slots.Create{Label: "Remux"}); err != nil {
		t.Fatal(err)
	}
	if err := s.Delete(ctx, "4k"); err != nil {
		t.Fatal(err)
	}
	got := list(t, s)
	if ids(got) != "standard,remux" || got[1].Position != 1 {
		t.Errorf("slots = %+v", got)
	}
}

func TestUpdateChangesLabelDefaultsOnForNewAndPosition(t *testing.T) {
	s, _ := newService(t)
	ctx := context.Background()
	label, onNew, pos := "Ultra HD", true, 0
	movies := "4k-primary"
	got, err := s.Update(ctx, "4k", slots.Patch{Label: &label, DefaultMovies: &movies, OnForNew: &onNew, Position: &pos})
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != "4k" || got.Label != "Ultra HD" || got.DefaultMovies != "4k-primary" || !got.OnForNew || got.Position != 0 {
		t.Errorf("updated = %+v", got)
	}
	if ids(list(t, s)) != "4k,standard" {
		t.Errorf("order = %s", ids(list(t, s)))
	}
	none := ""
	if got, err = s.Update(ctx, "4k", slots.Patch{DefaultMovies: &none}); err != nil || got.DefaultMovies != "" {
		t.Errorf("clearing a default: %+v, %v", got, err)
	}
}

func TestUpdateRefusesWhatBreaksARule(t *testing.T) {
	s, _ := newService(t)
	ctx := context.Background()
	dup := "4k"
	if _, err := s.Update(ctx, "standard", slots.Patch{Label: &dup}); ruleOf(t, err).Conflict {
		t.Errorf("a duplicate label: %v", err)
	}
	same := "STANDARD" // a Slot may change the case of its own label
	if _, err := s.Update(ctx, "standard", slots.Patch{Label: &same}); err != nil {
		t.Errorf("recasing its own label: %v", err)
	}
	off := false
	if _, err := s.Update(ctx, "standard", slots.Patch{OnForNew: &off}); !ruleOf(t, err).Conflict {
		t.Errorf("turning off the last on-for-new Slot: %v", err)
	}
	if _, err := s.Update(ctx, "nope", slots.Patch{}); !errors.Is(err, slots.ErrNotFound) {
		t.Errorf("updating an unknown Slot: %v", err)
	}
	far := 9
	if _, err := s.Update(ctx, "4k", slots.Patch{Position: &far}); ruleOf(t, err).Field != "position" {
		t.Errorf("a position past the end: %v", err)
	}
}

func TestKnownTellsWhichIdsAreSlots(t *testing.T) {
	s, _ := newService(t)
	ctx := context.Background()
	for id, want := range map[slot.Slot]bool{"standard": true, "4k": true, "remux": false} {
		if got, err := s.Known(ctx, id); err != nil || got != want {
			t.Errorf("Known(%q) = %v, %v", id, got, err)
		}
	}
}

func declared(label string, onNew bool) slots.Declared {
	return slots.Declared{Label: label, OnForNew: onNew}
}

func TestADeclaredSetBringsTheSlotsToTheFilesState(t *testing.T) {
	s, _ := newService(t)
	ctx := context.Background()
	want := []slots.Declared{
		{ID: "standard", Label: "Everyday", DefaultMovies: "any-primary", DefaultSeries: "hd-primary", OnForNew: true},
		declared("Remux", false),
	}
	if err := s.CheckDeclared(ctx, want); err != nil {
		t.Fatal(err)
	}
	if err := s.Declare(ctx, want); err != nil {
		t.Fatal(err)
	}
	got := list(t, s)
	if ids(got) != "standard,remux" || got[0].Label != "Everyday" || got[0].DefaultMovies != "any-primary" || got[1].Position != 1 || got[1].OnForNew {
		t.Errorf("slots = %+v", got)
	}
	// 4K was empty and left the file, so it is gone; declaring the same state again changes nothing.
	if err := s.Declare(ctx, want); err != nil {
		t.Fatal(err)
	}
	if again := list(t, s); len(again) != 2 || again[0] != got[0] || again[1] != got[1] {
		t.Errorf("a second Declare changed the Slots: %+v", again)
	}
}

func TestADeclaredEntryWithoutAnIdFindsASlotByItsLabel(t *testing.T) {
	s, _ := newService(t)
	ctx := context.Background()
	if err := s.Declare(ctx, []slots.Declared{declared("standard", true), declared("4K", false)}); err != nil {
		t.Fatal(err)
	}
	if ids(list(t, s)) != "standard,4k" {
		t.Errorf("slots = %s", ids(list(t, s)))
	}
}

func TestDroppingANonEmptySlotFromTheFileFailsNamingItAndItsVersions(t *testing.T) {
	s, st := newService(t)
	ctx := context.Background()
	addVersion(t, st, 1, "4k")
	addVersion(t, st, 2, "4k")
	err := s.CheckDeclared(ctx, []slots.Declared{{ID: "standard", Label: "Standard", OnForNew: true}})
	if err == nil || !strings.Contains(err.Error(), `"4k"`) || !strings.Contains(err.Error(), "2 Versions") {
		t.Errorf("err = %v, want it to name the Slot 4k and its 2 Versions", err)
	}
	if err := s.Declare(ctx, []slots.Declared{{ID: "standard", Label: "Standard", OnForNew: true}}); err == nil {
		t.Error("Declare dropped a non-empty Slot")
	}
	if ids(list(t, s)) != "standard,4k" {
		t.Errorf("a refused Declare changed the Slots: %s", ids(list(t, s)))
	}
}

func TestADeclaredSetObeysTheSameRules(t *testing.T) {
	s, _ := newService(t)
	ctx := context.Background()
	for name, want := range map[string][]slots.Declared{
		"none on for new Titles": {declared("A", false)},
		"a duplicate label":      {declared("A", true), declared("a", false)},
		"a bad label":            {declared("A[", true)},
		"five Slots":             {declared("A", true), declared("B", false), declared("C", false), declared("D", false), declared("E", false)},
		"an unknown Profile":     {{Label: "A", OnForNew: true, DefaultSeries: "nope"}},
		"a bad id":               {{ID: "Not An Id", Label: "A", OnForNew: true}},
		"the same id twice":      {{ID: "a", Label: "A", OnForNew: true}, {ID: "a", Label: "B"}},
	} {
		if err := s.CheckDeclared(ctx, want); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}
