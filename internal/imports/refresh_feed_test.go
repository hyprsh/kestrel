package imports_test

import (
	"context"
	"errors"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/imports"
	"github.com/hyprsh/kestrel/internal/plugin/mediaserver/v1/fake"
)

type recordedChange struct {
	folder string
	exists bool
}

type stubFeed struct {
	mu   sync.Mutex
	got  []recordedChange
	fail error
}

func (s *stubFeed) Record(_ context.Context, folder string, exists bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.got = append(s.got, recordedChange{folder, exists})
	return s.fail
}

func (s *stubFeed) recorded() []recordedChange {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]recordedChange(nil), s.got...)
}

type failingServers struct{}

func (failingServers) MediaServers(context.Context) ([]imports.MediaServer, error) {
	return nil, errors.New("store closed")
}

func byFolder(a, b recordedChange) int { return strings.Compare(a.folder, b.folder) }

func TestASettledChangeIsRecordedInTheFeedWhetherTheFolderExistsOrNot(t *testing.T) {
	feed := &stubFeed{}
	r := imports.NewRefresher(imports.RefresherDeps{Servers: stubServers(nil), Feed: feed, Delay: time.Hour})
	t.Cleanup(r.Close)
	present := t.TempDir()
	gone := filepath.Join(present, "gone")
	r.FolderChanged(context.Background(), present)
	r.FolderChanged(context.Background(), gone)
	r.FolderChanged(context.Background(), present)
	if got := feed.recorded(); len(got) != 0 {
		t.Fatalf("recorded before the delay ended: %v", got)
	}
	r.Flush(context.Background())
	got := feed.recorded()
	slices.SortFunc(got, byFolder)
	want := []recordedChange{{present, true}, {gone, false}}
	slices.SortFunc(want, byFolder)
	if !slices.Equal(got, want) {
		t.Fatalf("recorded %v, want %v", got, want)
	}
}

func TestTheFeedIsWrittenWhenListingTheMediaServersFails(t *testing.T) {
	feed := &stubFeed{}
	r := imports.NewRefresher(imports.RefresherDeps{Servers: failingServers{}, Feed: feed, Delay: time.Hour})
	t.Cleanup(r.Close)
	r.FolderChanged(context.Background(), "/x")
	r.Flush(context.Background())
	if got := feed.recorded(); len(got) != 1 {
		t.Fatalf("recorded %v", got)
	}
}

func TestAFeedFailureDoesNotStopTheMediaServersBeingTold(t *testing.T) {
	f := fake.New("k")
	feed := &stubFeed{fail: errors.New("disk full")}
	r := imports.NewRefresher(imports.RefresherDeps{Servers: stubServers{fakeServer(f, 1, "Plex")}, Feed: feed, Delay: time.Hour})
	t.Cleanup(r.Close)
	r.FolderChanged(context.Background(), "/x")
	r.Flush(context.Background())
	if len(f.Refreshed()) != 1 {
		t.Fatal("the media server was not told after the feed failed")
	}
}
