package indexers_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/indexers"
	"github.com/hyprsh/kestrel/internal/plugin"
	"github.com/hyprsh/kestrel/internal/plugin/instances"
	indexer "github.com/hyprsh/kestrel/internal/plugin/indexer/v1"
	"github.com/hyprsh/kestrel/internal/plugin/indexer/v1/fake"
	"github.com/hyprsh/kestrel/internal/store"
)

type rig struct {
	svc  *indexers.Service
	inst *instances.Service
	reg  *plugin.Registry
}

func newRig(t *testing.T, plugins ...plugin.Plugin) rig {
	t.Helper()
	st, err := store.Open(context.Background(), store.Options{Dir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	reg := plugin.NewRegistry()
	for _, p := range plugins {
		if err := reg.Register(indexer.Contract, p); err != nil {
			t.Fatal(err)
		}
	}
	inst := instances.NewService(st, reg)
	return rig{svc: indexers.New(inst, time.Now), inst: inst, reg: reg}
}

func (r rig) add(t *testing.T, pluginID, name string, priority int) int64 {
	t.Helper()
	i, err := r.inst.Create(context.Background(), instances.New{PluginID: pluginID, Name: name, Priority: priority, Config: map[string]any{"api_key": "k"}})
	if err != nil {
		t.Fatal(err)
	}
	return i.ID
}

func publish(t *testing.T, f *fake.Indexer, title string, imdb string, at time.Time) {
	t.Helper()
	err := f.Publish(indexer.Release{Title: title, IMDBID: imdb, Size: 1 << 30, PublishDate: at, Categories: []int{2040}}, []byte("<nzb/>"))
	if err != nil {
		t.Fatal(err)
	}
}

// namedFake is a fake indexer under another plugin id, so two can be registered.
type namedFake struct {
	*fake.Indexer
	id string
}

func (n namedFake) Describe() plugin.Manifest {
	m := n.Indexer.Describe()
	m.ID = n.id
	return m
}

func TestASearchAsksEveryEnabledIndexerAndTagsEachReleaseWithItsSource(t *testing.T) {
	a, b := fake.New("k"), fake.New("k")
	r := newRig(t, namedFake{a, "idx_a"}, namedFake{b, "idx_b"})
	idA := r.add(t, "idx_a", "Alpha", 1)
	idB := r.add(t, "idx_b", "Beta", 2)
	now := time.Now()
	publish(t, a, "Paddington.2014.1080p.BluRay.x264-GRP", "tt1109624", now)
	publish(t, b, "Paddington.2014.2160p.WEB-DL.x265-OTHER", "tt1109624", now)
	publish(t, b, "Something.Else.2014.1080p.BluRay.x264-GRP", "tt0000001", now)

	res := r.svc.Search(context.Background(), indexers.Query{Media: indexer.MediaMovie, IMDBID: "tt1109624", Titles: []string{"Paddington"}, Year: 2014})

	if len(res.Failures) != 0 || len(res.Releases) != 2 {
		t.Fatalf("result = %+v", res)
	}
	got := map[string]indexers.Release{}
	for _, rel := range res.Releases {
		got[rel.Title] = rel
	}
	if x := got["Paddington.2014.1080p.BluRay.x264-GRP"]; x.IndexerID != idA || x.IndexerName != "Alpha" || x.IndexerPriority != 1 || !x.ByID {
		t.Errorf("release from Alpha = %+v", x)
	}
	if x := got["Paddington.2014.2160p.WEB-DL.x265-OTHER"]; x.IndexerID != idB || x.IndexerName != "Beta" {
		t.Errorf("release from Beta = %+v", x)
	}
}

// slow blocks every search until released, to prove the lanes run side by side.
type slow struct {
	*fake.Indexer
	id      string
	started chan struct{}
	release chan struct{}
}

func (s slow) Describe() plugin.Manifest { m := s.Indexer.Describe(); m.ID = s.id; return m }

func (s slow) Search(ctx context.Context, c plugin.Connection, q indexer.SearchQuery) (indexer.SearchResult, error) {
	s.started <- struct{}{}
	<-s.release
	return s.Indexer.Search(ctx, c, q)
}

func TestIndexersAreSearchedInParallelOneLaneEach(t *testing.T) {
	started, release := make(chan struct{}, 2), make(chan struct{})
	r := newRig(t, slow{fake.New("k"), "idx_a", started, release}, slow{fake.New("k"), "idx_b", started, release})
	r.add(t, "idx_a", "Alpha", 1)
	r.add(t, "idx_b", "Beta", 2)

	done := make(chan indexers.Result)
	go func() {
		done <- r.svc.Search(context.Background(), indexers.Query{Media: indexer.MediaMovie, IMDBID: "tt1"})
	}()
	for range 2 {
		select {
		case <-started:
		case <-time.After(5 * time.Second):
			t.Fatal("the second indexer was not asked while the first was still busy")
		}
	}
	close(release)
	<-done
}

func TestAFailingIndexerIsReportedAndTheOthersStillAnswer(t *testing.T) {
	good, bad := fake.New("k"), fake.New("k")
	r := newRig(t, namedFake{good, "idx_good"}, namedFake{bad, "idx_bad"})
	r.add(t, "idx_good", "Good", 1)
	badID := r.add(t, "idx_bad", "Bad", 2)
	publish(t, good, "Paddington.2014.1080p.BluRay.x264-GRP", "tt1109624", time.Now())
	bad.Exhaust(plugin.LimitSearch, 90*time.Second)

	res := r.svc.Search(context.Background(), indexers.Query{Media: indexer.MediaMovie, IMDBID: "tt1109624"})

	if len(res.Releases) != 1 {
		t.Errorf("releases = %d, want the good indexer's one", len(res.Releases))
	}
	if len(res.Failures) != 1 {
		t.Fatalf("failures = %+v", res.Failures)
	}
	f := res.Failures[0]
	if f.IndexerID != badID || f.IndexerName != "Bad" || f.Code != plugin.CodeRateLimited || f.RetryAfter != 90*time.Second {
		t.Errorf("failure = %+v", f)
	}
}

func TestWhenAnIDSearchFindsNothingTheTitlesAreSearchedAsText(t *testing.T) {
	f := fake.New("k")
	r := newRig(t, f)
	r.add(t, fake.ID, "Alpha", 1)
	// The indexer lists the release without IDs, so only the text index finds it.
	publish(t, f, "Paddington.2014.1080p.BluRay.x264-GRP", "", time.Now())

	res := r.svc.Search(context.Background(), indexers.Query{Media: indexer.MediaMovie, IMDBID: "tt1109624", TMDBID: 116149, Titles: []string{"Paddington"}, Year: 2014})

	if len(res.Releases) != 1 || res.Releases[0].ByID {
		t.Fatalf("releases = %+v, want the one text hit, not marked as an ID hit", res.Releases)
	}
}

func TestAReleaseTwoQueriesBothFindIsReportedOnce(t *testing.T) {
	f := fake.New("k")
	r := newRig(t, f)
	r.add(t, fake.ID, "Alpha", 1)
	publish(t, f, "Paddington.2014.1080p.BluRay.x264-GRP", "", time.Now())

	res := r.svc.Search(context.Background(), indexers.Query{Media: indexer.MediaMovie, Titles: []string{"Paddington", "Paddington", "Paddington 2014"}})

	if len(res.Releases) != 1 {
		t.Errorf("releases = %d, want 1", len(res.Releases))
	}
}

func TestSearchPagesThroughAnIndexersResults(t *testing.T) {
	f := fake.New("k")
	r := newRig(t, f)
	r.add(t, fake.ID, "Alpha", 1)
	for i := range 250 { // the fake serves 100 a page
		publish(t, f, "Paddington.2014.1080p.BluRay.x264-GRP"+string(rune('A'+i%26))+string(rune('a'+i/26)), "tt1109624", time.Now().Add(-time.Duration(i)*time.Minute))
	}

	res := r.svc.Search(context.Background(), indexers.Query{Media: indexer.MediaMovie, IMDBID: "tt1109624"})

	if len(res.Releases) != 250 {
		t.Errorf("releases = %d, want all 250", len(res.Releases))
	}
}

// counting counts Caps calls.
type counting struct {
	*fake.Indexer
	caps *int
}

func (c counting) Caps(ctx context.Context, conn plugin.Connection) (indexer.Caps, error) {
	*c.caps++
	return c.Indexer.Caps(ctx, conn)
}

func TestCapsAreCachedAcrossSearches(t *testing.T) {
	calls := 0
	r := newRig(t, counting{fake.New("k"), &calls})
	r.add(t, fake.ID, "Alpha", 1)

	for range 3 {
		r.svc.Search(context.Background(), indexers.Query{Media: indexer.MediaMovie, IMDBID: "tt1"})
	}

	if calls != 1 {
		t.Errorf("Caps called %d times, want once", calls)
	}
}

func TestFetchReturnsTheNZBFromTheNamedIndexer(t *testing.T) {
	f := fake.New("k")
	r := newRig(t, f)
	id := r.add(t, fake.ID, "Alpha", 1)
	publish(t, f, "Paddington.2014.1080p.BluRay.x264-GRP", "tt1109624", time.Now())
	res := r.svc.Search(context.Background(), indexers.Query{Media: indexer.MediaMovie, IMDBID: "tt1109624"})

	nzb, err := r.svc.Fetch(context.Background(), id, res.Releases[0].DownloadURL)
	if err != nil || string(nzb) != "<nzb/>" {
		t.Fatalf("Fetch = %q, %v", nzb, err)
	}
	if _, err := r.svc.Fetch(context.Background(), 999, "x"); !errors.Is(err, indexers.ErrNoSuchIndexer) {
		t.Errorf("Fetch from an unknown indexer = %v, want ErrNoSuchIndexer", err)
	}
}
