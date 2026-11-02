package imports_test

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/slot/slots"
)

func TestRenamingASlotLabelRenamesItsFilesAndLogsIt(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.importPaddington(t)
	if got := tree(t, r.root); !strings.Contains(got[0], " - [Standard]") {
		t.Fatalf("files = %v", got)
	}

	label := "Original"
	if _, err := r.slotSvc.Update(ctx, "standard", slots.Patch{Label: &label}); err != nil {
		t.Fatal(err)
	}
	n, err := r.svc.RenameSlot(ctx, "standard")
	if err != nil || n != 1 {
		t.Fatalf("RenameSlot = %d, %v", n, err)
	}

	files := tree(t, r.root)
	if len(files) != 2 {
		t.Fatalf("files = %v", files)
	}
	for _, f := range files {
		if !strings.HasPrefix(filepath.Base(f), movieFolder+" - [Original]") {
			t.Errorf("%q does not carry the new label", f)
		}
	}
	if p := r.version(t).File.Path; !strings.Contains(filepath.Base(p), " - [Original]") {
		t.Errorf("recorded path = %q", p)
	}
	evs := r.log.of(history.Renamed)
	if len(evs) != 1 || !strings.Contains(evs[0].Message, "1 file") {
		t.Errorf("history = %+v", evs)
	}

	// Nothing is left to rename the second time.
	if n, err := r.svc.RenameSlot(ctx, "standard"); err != nil || n != 0 {
		t.Errorf("second RenameSlot = %d, %v", n, err)
	}
}

func TestANewFileIsNamedFromTheCurrentLabel(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	label := "Original"
	if _, err := r.slotSvc.Update(ctx, "standard", slots.Patch{Label: &label}); err != nil {
		t.Fatal(err)
	}
	f := r.importPaddington(t)
	if !strings.Contains(filepath.Base(f.Path), " - [Original]") {
		t.Errorf("path = %q", f.Path)
	}
}
