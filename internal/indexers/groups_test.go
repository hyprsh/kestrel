package indexers_test

import (
	"context"
	"slices"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/indexers"
	indexer "github.com/hyprsh/kestrel/internal/plugin/indexer/v1"
	"github.com/hyprsh/kestrel/internal/plugin/indexer/v1/fake"
)

func TestPrioritiesAreTheEnabledIndexersGroupsLowestFirst(t *testing.T) {
	a, b, c := fake.New("k"), fake.New("k"), fake.New("k")
	r := newRig(t, namedFake{a, "idx_a"}, namedFake{b, "idx_b"}, namedFake{c, "idx_c"})
	r.add(t, "idx_a", "Alpha", 5)
	r.add(t, "idx_b", "Beta", 0)
	r.add(t, "idx_c", "Gamma", 5)

	if got := r.svc.Priorities(context.Background()); !slices.Equal(got, []int{0, 5}) {
		t.Errorf("priorities = %v, want [0 5]", got)
	}
}

func TestASearchOfOneGroupAsksOnlyTheIndexersOfThatPriority(t *testing.T) {
	a, b, c := fake.New("k"), fake.New("k"), fake.New("k")
	r := newRig(t, namedFake{a, "idx_a"}, namedFake{b, "idx_b"}, namedFake{c, "idx_c"})
	r.add(t, "idx_a", "Alpha", 1)
	r.add(t, "idx_b", "Beta", 1)
	r.add(t, "idx_c", "Gamma", 2)
	now := time.Now()
	publish(t, a, "Paddington.2014.1080p.BluRay.x264-A", "tt1109624", now)
	publish(t, b, "Paddington.2014.1080p.BluRay.x264-B", "tt1109624", now)
	publish(t, c, "Paddington.2014.1080p.BluRay.x264-C", "tt1109624", now)
	q := indexers.Query{Media: indexer.MediaMovie, IMDBID: "tt1109624"}

	sources := func(res indexers.Result) []string {
		var out []string
		for _, rel := range res.Releases {
			out = append(out, rel.IndexerName)
		}
		slices.Sort(out)
		return out
	}
	if got := sources(r.svc.SearchGroup(context.Background(), q, 1)); !slices.Equal(got, []string{"Alpha", "Beta"}) {
		t.Errorf("group 1 answered from %v, want Alpha and Beta", got)
	}
	if got := sources(r.svc.SearchGroup(context.Background(), q, 2)); !slices.Equal(got, []string{"Gamma"}) {
		t.Errorf("group 2 answered from %v, want Gamma", got)
	}
	if got := r.svc.SearchGroup(context.Background(), q, 3); len(got.Releases) != 0 || len(got.Failures) != 0 {
		t.Errorf("a priority no indexer has = %+v, want an empty result", got)
	}
	if got := sources(r.svc.Search(context.Background(), q)); len(got) != 3 {
		t.Errorf("a search of every indexer answered from %v", got)
	}
}

func TestRSSReadsEveryIndexerWhateverItsPriority(t *testing.T) {
	a, b := fake.New("k"), fake.New("k")
	r := newRig(t, namedFake{a, "idx_a"}, namedFake{b, "idx_b"})
	r.add(t, "idx_a", "Alpha", 0)
	r.add(t, "idx_b", "Beta", 9)
	now := time.Now()
	publish(t, a, "Paddington.2014.1080p.BluRay.x264-A", "tt1109624", now)
	publish(t, b, "Paddington.2014.1080p.BluRay.x264-B", "tt1109624", now)

	res := r.svc.RSS(context.Background())

	names := map[string]bool{}
	for _, rel := range res.Releases {
		names[rel.IndexerName] = true
	}
	if !names["Alpha"] || !names["Beta"] {
		t.Errorf("RSS read %v, want both indexers", names)
	}
}
