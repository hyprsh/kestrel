package imports_test

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/imports"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/slot"
)

// eventLog is the Log: it keeps every event recorded.
type eventLog struct {
	mu     sync.Mutex
	events []history.Event
}

func (l *eventLog) Record(_ context.Context, ev history.Event) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.events = append(l.events, ev)
}

func (l *eventLog) of(kind history.Kind) []history.Event {
	l.mu.Lock()
	defer l.mu.Unlock()
	var out []history.Event
	for _, ev := range l.events {
		if ev.Kind == kind {
			out = append(out, ev)
		}
	}
	return out
}

// blocklist is the Blocklist; err makes every BlockGrab fail.
type blocklist struct {
	mu    sync.Mutex
	err   error
	grabs []int64
}

func (b *blocklist) BlockGrab(_ context.Context, grabID int64, _ string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.err != nil {
		return b.err
	}
	b.grabs = append(b.grabs, grabID)
	return nil
}

func deleteData(t *testing.T, ev history.Event) (out struct {
	Paths       []string `json:"paths"`
	Blocklisted []string `json:"blocklisted"`
}) {
	t.Helper()
	if err := json.Unmarshal(ev.Data, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestDeletingAndBlocklistingAMoviesFileSaysWhatWasBlocklisted(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	f := r.importPaddington(t)

	d, err := r.svc.DeleteFiles(ctx, r.versions[slot.Standard], library.Scope{}, true)

	if err != nil || len(d.Files) != 1 || !d.Files[0].Blocklisted {
		t.Fatalf("delete = %+v, %v; want the file deleted and blocklisted", d, err)
	}
	if len(r.blocks.grabs) != 1 || r.blocks.grabs[0] != 1 {
		t.Errorf("blocklisted Grabs %v, want the one the file came from", r.blocks.grabs)
	}
	evs := r.log.of(history.FilesDeleted)
	if len(evs) != 1 || !strings.Contains(evs[0].Message, "blocklisted "+hdName) {
		t.Fatalf("delete events = %+v, want one saying the Release was blocklisted", evs)
	}
	if data := deleteData(t, evs[0]); len(data.Paths) != 1 || data.Paths[0] != f.Path || len(data.Blocklisted) != 1 || data.Blocklisted[0] != hdName {
		t.Errorf("event data = %+v", data)
	}
}

func TestADeleteWhoseBlocklistingFailsStillDeletesTheFile(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	f := r.importPaddington(t)
	r.blocks.err = errors.New("database is locked")

	d, err := r.svc.DeleteFiles(ctx, r.versions[slot.Standard], library.Scope{}, true)

	if err != nil {
		t.Fatalf("delete failed: %v; the file is gone, so the delete succeeded", err)
	}
	if len(d.Files) != 1 || d.Files[0].Blocklisted {
		t.Errorf("deleted = %+v, want the file, not blocklisted", d.Files)
	}
	if _, err := os.Stat(f.Path); !os.IsNotExist(err) {
		t.Errorf("the file is still on disk: %v", err)
	}
	if v := r.version(t); v.File != nil {
		t.Errorf("Version = %+v, want it without a file", v)
	}
	evs := r.log.of(history.FilesDeleted)
	if len(evs) != 1 || strings.Contains(evs[0].Message, "; blocklisted") || !strings.Contains(evs[0].Message, "not blocklisted "+hdName) {
		t.Fatalf("delete events = %+v, want one saying the Release was not blocklisted", evs)
	}
	if data := deleteData(t, evs[0]); len(data.Blocklisted) != 0 {
		t.Errorf("event data = %+v, want nothing blocklisted", data)
	}
}

func TestAFileThatCannotBeDeletedStaysTheVersionsFile(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	f := r.importPaddington(t)
	r.undeletable = map[string]bool{f.Path: true}

	d, err := r.svc.DeleteFiles(ctx, r.versions[slot.Standard], library.Scope{}, true)

	if err != nil {
		t.Fatal(err)
	}
	if len(d.Files) != 0 || len(d.NotDeleted) != 1 || d.NotDeleted[0].Path != f.Path || !strings.Contains(d.NotDeleted[0].Reason, "read-only") {
		t.Errorf("delete = %+v, want the file reported as not deleted, with why", d)
	}
	if _, err := os.Stat(f.Path); err != nil {
		t.Errorf("the file is not on disk: %v", err)
	}
	if v := r.version(t); v.File == nil || v.File.Path != f.Path {
		t.Errorf("Version = %+v, want it to keep the file that is still on disk", v)
	}
	if len(r.blocks.grabs) != 0 {
		t.Errorf("blocklisted %v, want nothing for a file that stays", r.blocks.grabs)
	}
	if evs := r.log.of(history.FilesDeleted); len(evs) != 1 || !strings.Contains(evs[0].Message, "Could not delete") {
		t.Errorf("delete events = %+v, want one saying the file could not be deleted", evs)
	}
}

func TestDeletingASeasonKeepsOnlyTheFilesThatCouldNotBeDeleted(t *testing.T) {
	ctx := context.Background()
	s := newSeriesRig(t)
	for i, e := range []string{"Night.Show.S01E01.1080p.WEB-DL.H264-GRP", "Night.Show.S01E02.1080p.WEB-DL.H264-GRP"} {
		if res := s.svc.Import(ctx, s.download(t, e, int64(i+1), []string{strings.ToLower(e) + ".mkv"})); res.Status != imports.Imported {
			t.Fatalf("import = %+v", res)
		}
	}
	eps := s.episodes(t)
	stuck := eps[1].Cells[slot.Standard].File.Path
	s.undeletable = map[string]bool{stuck: true}
	season := 1

	d, err := s.svc.DeleteFiles(ctx, s.version, library.Scope{Season: &season}, false)

	if err != nil || len(d.Files) != 1 || len(d.NotDeleted) != 1 || d.NotDeleted[0].Path != stuck {
		t.Fatalf("delete = %+v, %v; want S01E01's file deleted and S01E02's kept", d, err)
	}
	eps = s.episodes(t)
	if eps[0].Cells[slot.Standard].File != nil || eps[1].Cells[slot.Standard].File == nil {
		t.Errorf("cells = %+v / %+v, want S01E01 without a file and S01E02 with it", eps[0].Cells[slot.Standard], eps[1].Cells[slot.Standard])
	}
}
