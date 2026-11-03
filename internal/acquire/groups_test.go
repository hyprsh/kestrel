package acquire_test

import (
	"context"
	"fmt"
	"slices"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/plugin"
	indexer "github.com/hyprsh/kestrel/internal/plugin/indexer/v1"
	ixfake "github.com/hyprsh/kestrel/internal/plugin/indexer/v1/fake"
	"github.com/hyprsh/kestrel/internal/plugin/instances"
	"github.com/hyprsh/kestrel/internal/slot"
)

// withBetaAt adds the second indexer, Beta, at the Indexer Priority given (Alpha's is 1).
func (r *rig) withBetaAt(t *testing.T, priority int) {
	t.Helper()
	if _, err := r.inst.Create(context.Background(), instances.New{PluginID: "fake_indexer_2", Name: "Beta", Priority: priority, Config: map[string]any{"api_key": "k"}}); err != nil {
		t.Fatal(err)
	}
}

// publishMovie posts a release of Paddington to the indexer.
func (r *rig) publishMovie(t *testing.T, ix *ixfake.Indexer, name string, ago time.Duration) {
	t.Helper()
	err := ix.Publish(indexer.Release{
		Title: name, IMDBID: "tt1109624", TMDBID: 116149, Size: 8 << 30, PublishDate: r.clock.now.Add(-ago), Categories: []int{2040},
	}, []byte("<nzb>"+name+"</nzb>"))
	if err != nil {
		t.Fatal(err)
	}
}

func TestAnAutomaticSearchLeavesTheNextGroupUnaskedWhenTheFirstHasAReleaseToGrab(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.withBetaAt(t, 2)
	r.publishMovie(t, r.idx, hd1080, time.Hour)
	r.publishMovie(t, r.idx2, uhd, time.Hour)

	out, err := r.svc.SearchWanted(ctx, r.titleID, r.wanted(t, slot.Standard))
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Grabbed) != 1 || out.Grabbed[0].IndexerName != "Alpha" {
		t.Fatalf("grabbed = %+v, want Alpha's Release", out.Grabbed)
	}
	if n := r.asked2.Load(); n != 0 {
		t.Errorf("Beta was asked %d times; the first group had a Release to grab", n)
	}

	res, err := r.svc.Search(ctx, r.versions[slot.Standard])
	if err != nil {
		t.Fatal(err)
	}
	if r.asked2.Load() == 0 || r.found(t, res, uhd).Indexer != "Beta" {
		t.Errorf("a manual search did not ask Beta: %+v", res.Items)
	}
}

func TestIndexersOfTheSamePriorityAreAskedTogether(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.withBetaAt(t, 1)
	r.publishMovie(t, r.idx, hd1080, time.Hour)

	out, err := r.svc.SearchWanted(ctx, r.titleID, r.wanted(t, slot.Standard))
	if err != nil || len(out.Grabbed) != 1 {
		t.Fatalf("outcome = %+v, %v", out, err)
	}
	if r.asked2.Load() == 0 {
		t.Error("Beta, at Alpha's priority, was not asked")
	}
}

func TestTheNextGroupIsAskedWhenTheFirstHasNothingToGrab(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.withBetaAt(t, 2)
	r.publishMovie(t, r.idx, uhd, time.Hour) // another Slot's: nothing for the Standard Version
	r.publishMovie(t, r.idx2, hd1080, time.Hour)

	out, err := r.svc.SearchWanted(ctx, r.titleID, r.wanted(t, slot.Standard))
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Grabbed) != 1 || out.Grabbed[0].IndexerName != "Beta" {
		t.Fatalf("grabbed = %+v, want Beta's Release", out.Grabbed)
	}
	if out.Releases != 2 {
		t.Errorf("releases = %d, want both groups' finds", out.Releases)
	}
}

func TestTheNextGroupIsAskedWhenTheFirstGroupsIndexerIsPaused(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.withBetaAt(t, 2)
	r.publishMovie(t, r.idx, hd1080, time.Hour)
	r.publishMovie(t, r.idx2, hd1080, 2*time.Hour)
	r.idx.Exhaust(plugin.LimitSearch, time.Hour)

	out, err := r.svc.SearchNew(ctx, r.titleID, r.wanted(t, slot.Standard))
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Grabbed) != 1 || out.Grabbed[0].IndexerName != "Beta" {
		t.Fatalf("grabbed = %+v, want Beta's Release while Alpha is out of budget", out.Grabbed)
	}

	// Alpha is paused now, not only failing: the next search skips it and still asks Beta.
	if _, err := r.svc.Cancel(ctx, out.Grabbed[0].ID, false); err != nil {
		t.Fatal(err)
	}
	r.clock.now = r.clock.now.Add(31 * time.Minute) // the earlier answer is too old to reuse
	before := r.asked2.Load()
	if out, err = r.svc.SearchNew(ctx, r.titleID, r.wanted(t, slot.Standard)); err != nil || len(out.Grabbed) != 1 || out.Grabbed[0].IndexerName != "Beta" {
		t.Fatalf("second search = %+v, %v", out, err)
	}
	if r.asked2.Load() == before {
		t.Error("Beta was not asked while Alpha is paused")
	}
}

func TestTheNextGroupIsAskedWhenTheFirstFoundOnlyAnOriginalOffer(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.offering(t)
	r.withBetaAt(t, 2)
	r.publishMovie(t, r.idx, hd1080, time.Hour) // English only: an Original Offer for a German household
	r.publishMovie(t, r.idx2, german, time.Hour)

	out, err := r.svc.SearchNew(ctx, r.titleID, r.wanted(t, slot.Standard))
	if err != nil {
		t.Fatal(err)
	}
	if r.asked2.Load() == 0 {
		t.Fatal("Beta was not asked though Alpha found only an Original Offer")
	}
	if len(out.Grabbed) != 1 || out.Grabbed[0].ReleaseName != german || out.Grabbed[0].IndexerName != "Beta" {
		t.Errorf("grabbed = %+v, want Beta's German Release", out.Grabbed)
	}
	if offers := r.offers(t); len(offers) != 0 {
		t.Errorf("offers = %+v, want none once Beta's Release is grabbed", offers)
	}
}

func TestARetryFromTheCacheAsksTheNextGroupWhenTheFirstsReleasesAreUsedUp(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.withBetaAt(t, 2)
	r.publishMovie(t, r.idx, hd1080, time.Hour)
	r.publishMovie(t, r.idx2, hd1080, 2*time.Hour)

	out, err := r.svc.SearchWanted(ctx, r.titleID, r.wanted(t, slot.Standard))
	if err != nil || len(out.Grabbed) != 1 || out.Grabbed[0].IndexerName != "Alpha" || r.asked2.Load() != 0 {
		t.Fatalf("first search = %+v, %v (Beta asked %d times)", out, err, r.asked2.Load())
	}

	// Cancelled and blocklisted: the retry finds Alpha's Release used up and asks Beta.
	if _, err := r.svc.Cancel(ctx, out.Grabbed[0].ID, true); err != nil {
		t.Fatal(err)
	}
	if r.asked2.Load() == 0 {
		t.Fatal("the retry did not ask Beta")
	}
	active, err := r.svc.Active(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(active) != 1 || active[0].IndexerName != "Beta" {
		t.Errorf("active = %+v, want the retry's Grab from Beta", active)
	}
}

func TestRSSAsksEveryIndexerWhateverItsPriority(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.withBetaAt(t, 2)
	r.publishPlain(t, hd1080)

	if _, err := r.svc.SyncRSS(ctx); err != nil {
		t.Fatal(err)
	}
	if r.asked2.Load() == 0 {
		t.Error("RSS did not read Beta's feed")
	}
}

// tenEpisodes is a finished season of ten aired episodes.
func tenEpisodes() (metadata.SeriesDetails, metadata.TVDBSeries) {
	d, v := nightShow()
	v.Episodes = nil
	for n := 1; n <= 10; n++ {
		v.Episodes = append(v.Episodes, metadata.Episode{ID: n, Season: 1, Number: n, Name: fmt.Sprintf("Part %d", n), Aired: day(2026, 1, n)})
	}
	return d, v
}

func TestTheNextGroupIsAskedOnlyForTheEpisodesTheFirstLeft(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.withBetaAt(t, 2)
	d, v := tenEpisodes()
	id := r.addSeries(t, d, v, library.MonitorAll)
	det, err := r.lib.Get(ctx, id, library.View{Country: "US", Now: r.clock.now})
	if err != nil {
		t.Fatal(err)
	}
	show := func(ix *ixfake.Indexer, n int, ago time.Duration) string {
		name := fmt.Sprintf("Night.Show.S01E%02d.1080p.WEB-DL.H264-GRP", n)
		err := ix.Publish(indexer.Release{
			Title: name, TVDBID: 5001, Season: "1", Episode: fmt.Sprint(n), Size: 2 << 30,
			PublishDate: r.clock.now.Add(-ago), Categories: []int{5040},
		}, []byte("<nzb>"+name+"</nzb>"))
		if err != nil {
			t.Fatal(err)
		}
		return name
	}
	want := map[string]string{}
	for n := 1; n <= 10; n++ {
		name := show(r.idx2, n, time.Hour) // newer than Alpha's: it would win if both groups were asked at once
		if n <= 6 {
			show(r.idx, n, 2*time.Hour)
			want[name] = "Alpha"
		} else {
			want[name] = "Beta"
		}
	}

	out, err := r.svc.SearchNew(ctx, id, []int64{det.Versions[0].ID})
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, g := range out.Grabbed {
		got[g.ReleaseName] = g.IndexerName
	}
	if len(out.Grabbed) != 10 || len(got) != 10 {
		t.Fatalf("grabbed %d: %v, want the ten episodes once each", len(out.Grabbed), got)
	}
	for name, from := range want {
		if got[name] != from {
			t.Errorf("%s grabbed from %q, want %s", name, got[name], from)
		}
	}
	if r.asked2.Load() == 0 {
		t.Error("Beta was not asked")
	}
	var names []string
	for name, from := range got {
		if from == "Beta" {
			names = append(names, name)
		}
	}
	slices.Sort(names)
	if len(names) != 4 || names[0] != "Night.Show.S01E07.1080p.WEB-DL.H264-GRP" {
		t.Errorf("from Beta: %v, want episodes 7 to 10", names)
	}
}

func TestEpisodesWhoseGrabsFailAreGrabbedFromTheNextGroup(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.withBetaAt(t, 2)
	d, v := tenEpisodes()
	id := r.addSeries(t, d, v, library.MonitorAll)
	det, err := r.lib.Get(ctx, id, library.View{Country: "US", Now: r.clock.now})
	if err != nil {
		t.Fatal(err)
	}
	for n := 1; n <= 10; n++ {
		name := fmt.Sprintf("Night.Show.S01E%02d.1080p.WEB-DL.H264-GRP", n)
		for _, ix := range []*ixfake.Indexer{r.idx, r.idx2} {
			err := ix.Publish(indexer.Release{
				Title: name, TVDBID: 5001, Season: "1", Episode: fmt.Sprint(n), Size: 2 << 30,
				PublishDate: r.clock.now.Add(-time.Hour), Categories: []int{5040},
			}, []byte("<nzb>"+name+"</nzb>"))
			if err != nil {
				t.Fatal(err)
			}
		}
	}
	r.idx.Exhaust(plugin.LimitGrab, time.Minute) // Alpha finds the episodes but cannot hand over their NZBs

	out, err := r.svc.SearchNew(ctx, id, []int64{det.Versions[0].ID})
	if err != nil {
		t.Fatalf("err = %v, want none once Beta filled every episode", err)
	}
	if r.asked2.Load() == 0 {
		t.Fatal("Beta was not asked for the episodes Alpha's Grabs left")
	}
	got := map[string]string{}
	for _, g := range out.Grabbed {
		got[g.ReleaseName] = g.IndexerName
	}
	if len(out.Grabbed) != 10 || len(got) != 10 {
		t.Fatalf("grabbed %d: %v, want the ten episodes once each", len(out.Grabbed), got)
	}
	for name, from := range got {
		if from != "Beta" {
			t.Errorf("%s grabbed from %s, want Beta", name, from)
		}
	}
}
