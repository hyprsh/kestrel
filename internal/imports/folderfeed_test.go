package imports_test

import (
	"context"
	"slices"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/imports"
	"github.com/hyprsh/kestrel/internal/store"
	"github.com/hyprsh/kestrel/internal/store/storetest"
)

type feedClock struct{ now time.Time }

func (c *feedClock) Now() time.Time { return c.now }

func openFeed(t *testing.T, dir string, clk *feedClock) (*imports.FolderFeed, *store.Store) {
	t.Helper()
	st, err := store.Open(context.Background(), store.Options{Dir: dir})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return imports.NewFolderFeed(st, clk.Now), st
}

func mustRecord(t *testing.T, f *imports.FolderFeed, folder string, exists bool) {
	t.Helper()
	if err := f.Record(context.Background(), folder, exists); err != nil {
		t.Fatal(err)
	}
}

func mustChanges(t *testing.T, f *imports.FolderFeed, marker string, limit int) imports.FolderChanges {
	t.Helper()
	got, err := f.Changes(context.Background(), marker, limit)
	if err != nil {
		t.Fatal(err)
	}
	return got
}

func kinds(c imports.FolderChanges) []string {
	var out []string
	for _, ch := range c.Changes {
		out = append(out, ch.Path+":"+ch.Kind)
	}
	return out
}

func TestFolderFeedNoMarkerStartsNow(t *testing.T) {
	clk := &feedClock{time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC)}
	f, _ := openFeed(t, storetest.Dir(t), clk)
	got := mustChanges(t, f, "", 10)
	if got.NextMarker != "fc1:0" || got.Expired || got.More || len(got.Changes) != 0 {
		t.Fatalf("empty feed: %+v", got)
	}
	mustRecord(t, f, "/a", true)
	mustRecord(t, f, "/b", true)
	got = mustChanges(t, f, "", 10)
	if got.NextMarker != "fc1:2" || len(got.Changes) != 0 || got.Expired {
		t.Fatalf("no marker replays history: %+v", got)
	}
}

func TestFolderFeedKinds(t *testing.T) {
	clk := &feedClock{time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC)}
	f, _ := openFeed(t, storetest.Dir(t), clk)
	mustRecord(t, f, "/a", true)  // created
	mustRecord(t, f, "/a", true)  // modified
	mustRecord(t, f, "/a", false) // deleted
	mustRecord(t, f, "/a", true)  // created again
	mustRecord(t, f, "/b", false) // deleted though never reported
	got := mustChanges(t, f, "fc1:0", 10)
	want := []string{"/a:created", "/a:modified", "/a:deleted", "/a:created", "/b:deleted"}
	if !slices.Equal(kinds(got), want) {
		t.Fatalf("kinds %v, want %v", kinds(got), want)
	}
	if got.Changes[0].At != "2026-10-31T12:00:00Z" {
		t.Fatalf("at %q", got.Changes[0].At)
	}
}

func TestFolderFeedPagingAndRepeat(t *testing.T) {
	clk := &feedClock{time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC)}
	f, _ := openFeed(t, storetest.Dir(t), clk)
	for _, p := range []string{"/a", "/b", "/c"} {
		mustRecord(t, f, p, true)
	}
	p1 := mustChanges(t, f, "fc1:0", 2)
	if !slices.Equal(kinds(p1), []string{"/a:created", "/b:created"}) || !p1.More || p1.NextMarker != "fc1:2" {
		t.Fatalf("page 1: %+v", p1)
	}
	p2 := mustChanges(t, f, p1.NextMarker, 2)
	if !slices.Equal(kinds(p2), []string{"/c:created"}) || p2.More || p2.NextMarker != "fc1:3" {
		t.Fatalf("page 2: %+v", p2)
	}
	p3 := mustChanges(t, f, p2.NextMarker, 2)
	if len(p3.Changes) != 0 || p3.NextMarker != "fc1:3" || p3.Expired {
		t.Fatalf("page 3: %+v", p3)
	}
	again := mustChanges(t, f, "fc1:0", 2)
	if !slices.Equal(kinds(again), kinds(p1)) || again.NextMarker != p1.NextMarker {
		t.Fatalf("same marker, different answer: %+v", again)
	}
}

func TestFolderFeedSurvivesRestart(t *testing.T) {
	clk := &feedClock{time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC)}
	dir := storetest.Dir(t)
	f, st := openFeed(t, dir, clk)
	mustRecord(t, f, "/a", true)
	marker := mustChanges(t, f, "", 1).NextMarker
	mustRecord(t, f, "/b", true)
	if err := st.Close(); err != nil {
		t.Fatal(err)
	}
	f2, _ := openFeed(t, dir, clk)
	got := mustChanges(t, f2, marker, 10)
	if !slices.Equal(kinds(got), []string{"/b:created"}) || got.Expired || got.NextMarker != "fc1:2" {
		t.Fatalf("after restart: %+v", got)
	}
	// The kind decision reads the stored feed too.
	mustRecord(t, f2, "/b", true)
	if got := mustChanges(t, f2, "fc1:2", 10); !slices.Equal(kinds(got), []string{"/b:modified"}) {
		t.Fatalf("kind after restart: %v", kinds(got))
	}
}

func TestFolderFeedExpiredMarkers(t *testing.T) {
	clk := &feedClock{time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC)}
	f, _ := openFeed(t, storetest.Dir(t), clk)
	for _, m := range []string{"fc1:1", "fc1:5"} {
		got := mustChanges(t, f, m, 10)
		if !got.Expired || got.NextMarker != "fc1:0" || len(got.Changes) != 0 {
			t.Fatalf("empty table, marker %s: %+v", m, got)
		}
	}
	if got := mustChanges(t, f, "fc1:0", 10); got.Expired {
		t.Fatalf("empty table, marker fc1:0 must answer: %+v", got)
	}

	// Rows 1..3 are 40 days old, 4..5 are fresh.
	clk.now = clk.now.AddDate(0, 0, -40)
	for _, p := range []string{"/a", "/b", "/c"} {
		mustRecord(t, f, p, true)
	}
	clk.now = clk.now.AddDate(0, 0, 40)
	mustRecord(t, f, "/d", true)
	mustRecord(t, f, "/e", true)
	if err := f.Prune(context.Background()); err != nil {
		t.Fatal(err)
	}
	// Rows 1..3 are gone; MIN(id)=4, so fc1:3 is the boundary and still answers.
	for _, m := range []string{"fc1:0", "fc1:1", "fc1:2"} {
		got := mustChanges(t, f, m, 10)
		if !got.Expired || got.NextMarker != "fc1:5" || len(got.Changes) != 0 {
			t.Fatalf("pruned marker %s: %+v", m, got)
		}
	}
	got := mustChanges(t, f, "fc1:3", 10)
	if got.Expired || !slices.Equal(kinds(got), []string{"/d:created", "/e:created"}) {
		t.Fatalf("boundary marker: %+v", got)
	}
	// Ahead of the feed, and unparseable or foreign markers.
	for _, m := range []string{"fc1:6", "fc1:999", "fc1:-1", "fc1:", "fc1:x", "fc2:3", "garbage", "3", "fc1:3 "} {
		got := mustChanges(t, f, m, 10)
		if !got.Expired || got.NextMarker != "fc1:5" || len(got.Changes) != 0 {
			t.Fatalf("bad marker %q: %+v", m, got)
		}
	}
	if got := mustChanges(t, f, "fc1:5", 10); got.Expired || got.NextMarker != "fc1:5" {
		t.Fatalf("marker at the head: %+v", got)
	}
}

func TestFolderFeedPruneKeepsNewestRow(t *testing.T) {
	clk := &feedClock{time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC)}
	f, _ := openFeed(t, storetest.Dir(t), clk)
	clk.now = clk.now.AddDate(0, 0, -90)
	mustRecord(t, f, "/a", true)
	mustRecord(t, f, "/b", true)
	clk.now = clk.now.AddDate(0, 0, 90)
	if err := f.Prune(context.Background()); err != nil {
		t.Fatal(err)
	}
	// Only the newest row is kept, so MIN=MAX=2 and fc1:1 still answers.
	got := mustChanges(t, f, "fc1:1", 10)
	if got.Expired || !slices.Equal(kinds(got), []string{"/b:created"}) {
		t.Fatalf("after pruning everything old: %+v", got)
	}
	if got := mustChanges(t, f, "fc1:0", 10); !got.Expired || got.NextMarker != "fc1:2" {
		t.Fatalf("fc1:0: %+v", got)
	}
	// A second prune changes nothing.
	if err := f.Prune(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := mustChanges(t, f, "fc1:1", 10); got.Expired {
		t.Fatalf("second prune: %+v", got)
	}
}

func TestFolderFeedPruneKeepsRecent(t *testing.T) {
	clk := &feedClock{time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC)}
	f, _ := openFeed(t, storetest.Dir(t), clk)
	clk.now = clk.now.AddDate(0, 0, -29)
	mustRecord(t, f, "/a", true)
	clk.now = clk.now.AddDate(0, 0, 29)
	if err := f.Prune(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := mustChanges(t, f, "fc1:0", 10); got.Expired || len(got.Changes) != 1 {
		t.Fatalf("29-day-old row pruned: %+v", got)
	}
}
