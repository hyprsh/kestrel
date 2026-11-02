package slots_test

import (
	"context"
	"testing"

	"github.com/hyprsh/kestrel/internal/slot"
	"github.com/hyprsh/kestrel/internal/slot/slots"
)

func aliasesOf(t *testing.T, s *slots.Service, id slot.Slot) []string {
	t.Helper()
	m, err := s.Aliases(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return m[id]
}

func TestRenamingALabelKeepsTheOldOneAsAnAlias(t *testing.T) {
	s, _ := newService(t)
	ctx := context.Background()
	orig := "Original"
	if _, err := change(s, ctx, "standard", slots.Patch{Label: &orig}); err != nil {
		t.Fatal(err)
	}
	if got := aliasesOf(t, s, "standard"); len(got) != 1 || got[0] != "Standard" {
		t.Errorf("aliases = %v", got)
	}
	// Taking the old label back drops it from the aliases.
	back := "Standard"
	if _, err := change(s, ctx, "standard", slots.Patch{Label: &back}); err != nil {
		t.Fatal(err)
	}
	if got := aliasesOf(t, s, "standard"); len(got) != 1 || got[0] != "Original" {
		t.Errorf("aliases after renaming back = %v", got)
	}
	// A change that leaves the label alone adds none.
	on := true
	if _, err := change(s, ctx, "4k", slots.Patch{OnForNew: &on}); err != nil {
		t.Fatal(err)
	}
	if got := aliasesOf(t, s, "4k"); len(got) != 0 {
		t.Errorf("4k aliases = %v", got)
	}
}

func TestACaseOnlyRenameAddsNoAlias(t *testing.T) {
	s, _ := newService(t)
	l := "STANDARD"
	if _, err := change(s, context.Background(), "standard", slots.Patch{Label: &l}); err != nil {
		t.Fatal(err)
	}
	if got := aliasesOf(t, s, "standard"); len(got) != 0 {
		t.Errorf("aliases = %v", got)
	}
}

func TestACheckedPatchWritesNothingAndCountsTheFiles(t *testing.T) {
	s, st := newService(t)
	ctx := context.Background()
	addVersion(t, st, 1, "standard")
	if _, err := st.Write().Exec(`INSERT INTO files (version_id, path, size, release_name, imported_at) SELECT id, '/m/a.mkv', 1, 'a', 'x' FROM versions`); err != nil {
		t.Fatal(err)
	}
	l := "Original"
	got, err := checked(s, ctx, "standard", slots.Patch{Label: &l})
	if err != nil {
		t.Fatal(err)
	}
	if got.Label != "Original" {
		t.Errorf("checked = %+v", got)
	}
	if cur := list(t, s)[0]; cur.Label != "Standard" {
		t.Errorf("Check saved: %+v", cur)
	}
	if n, err := s.Files(ctx, "standard"); err != nil || n != 1 {
		t.Errorf("Files = %d, %v", n, err)
	}
	bad := "4K"
	if _, err := checked(s, ctx, "standard", slots.Patch{Label: &bad}); err == nil {
		t.Error("Check accepted a taken label")
	}
}

func TestARelabelCallsTheHookOnceSaved(t *testing.T) {
	s, _ := newService(t)
	ctx := context.Background()
	var got []slot.Slot
	s.OnRelabel(func(_ context.Context, id slot.Slot) { got = append(got, id) })
	l := "Original"
	if _, err := change(s, ctx, "standard", slots.Patch{Label: &l}); err != nil {
		t.Fatal(err)
	}
	on := true
	if _, err := change(s, ctx, "4k", slots.Patch{OnForNew: &on}); err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0] != "standard" {
		t.Errorf("hook calls = %v", got)
	}
	// A Config File that renames a Slot by id does too.
	got = nil
	err := s.Declare(ctx, []slots.Declared{{ID: "standard", Label: "Everyday", DefaultMovies: "hd-primary", OnForNew: true}, {ID: "4k", Label: "4K", OnForNew: true}})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0] != "standard" {
		t.Errorf("hook calls after Declare = %v", got)
	}
	if a := aliasesOf(t, s, "standard"); len(a) != 2 {
		t.Errorf("aliases = %v", a)
	}
}

func TestEverySavedChangeToTheSlotsCallsTheChangeHookAndADryRunDoesNot(t *testing.T) {
	s, _ := newService(t)
	ctx := context.Background()
	n := 0
	s.OnChange(func() { n++ })
	l := "Original"
	if _, _, err := s.Change(ctx, "standard", slots.Patch{Label: &l}, true); err != nil || n != 0 {
		t.Fatalf("a dry run: calls = %d, %v", n, err)
	}
	if _, err := s.Create(ctx, slots.Create{Label: "Remux"}); err != nil {
		t.Fatal(err)
	}
	pos := 0
	if _, err := change(s, ctx, "remux", slots.Patch{Position: &pos}); err != nil {
		t.Fatal(err)
	}
	if err := s.Delete(ctx, "remux"); err != nil {
		t.Fatal(err)
	}
	if n != 3 {
		t.Errorf("create, reorder and delete called the hook %d times, want 3", n)
	}
	// A Config File's Slots count too.
	if err := s.Declare(ctx, []slots.Declared{{ID: "standard", Label: "Everyday", OnForNew: true}}); err != nil {
		t.Fatal(err)
	}
	if n != 4 {
		t.Errorf("Declare called the hook %d times in all, want 4", n)
	}
}

func TestAChangeSaysHowManyFilesANewLabelRenames(t *testing.T) {
	s, st := newService(t)
	ctx := context.Background()
	addVersion(t, st, 1, "standard")
	if _, err := st.Write().Exec(`INSERT INTO files (version_id, path, size, release_name, imported_at) SELECT id, '/m/a.mkv', 1, 'a', 'x' FROM versions`); err != nil {
		t.Fatal(err)
	}
	l := "Original"
	_, n, err := s.Change(ctx, "standard", slots.Patch{Label: &l}, true)
	if err != nil || n == nil || *n != 1 {
		t.Fatalf("dry run: renames = %v, %v", n, err)
	}
	if cur := list(t, s)[0]; cur.Label != "Standard" {
		t.Errorf("a dry run saved: %+v", cur)
	}
	same := "Standard"
	if _, n, err = s.Change(ctx, "standard", slots.Patch{Label: &same}, false); err != nil || n != nil {
		t.Errorf("the stored label: renames = %v, %v", n, err)
	}
	if _, n, err = s.Change(ctx, "standard", slots.Patch{Label: &l}, false); err != nil || n == nil || *n != 1 {
		t.Errorf("saved: renames = %v, %v", n, err)
	}
}
