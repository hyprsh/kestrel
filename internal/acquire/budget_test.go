package acquire_test

import (
	"context"
	"github.com/hyprsh/kestrel/internal/slot"
	"testing"
	"time"

	indexer "github.com/hyprsh/kestrel/internal/plugin/indexer/v1"
	"github.com/hyprsh/kestrel/internal/plugin/instances"
)

func TestDecideSkipsAnIndexerWhoseGrabQuotaIsSpent(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	if _, err := r.inst.Create(ctx, instances.New{PluginID: "fake_indexer_2", Name: "Beta", Priority: 2, Config: map[string]any{"api_key": "k"}}); err != nil {
		t.Fatal(err)
	}
	r.publish(t, hd1080, time.Hour) // Alpha's is newer and wins on its own
	err := r.idx2.Publish(indexer.Release{
		Title: hd1080, IMDBID: "tt1109624", TMDBID: 116149, Size: 8 << 30, PublishDate: r.clock.now.Add(-10 * time.Hour), Categories: []int{2040},
	}, []byte("<nzb/>"))
	if err != nil {
		t.Fatal(err)
	}
	r.idx.Report(indexer.Limits{Reported: true, APICurrent: 1, APIMax: 100, GrabCurrent: 5, GrabMax: 5})

	out, err := r.svc.SearchWanted(ctx, r.titleID, []int64{r.versions[slot.Standard]})
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Grabbed) != 1 || out.Grabbed[0].IndexerName != "Beta" {
		t.Fatalf("grabbed = %+v, want the Release from Beta", out.Grabbed)
	}
}

func TestSweepsStopAt80PercentOfTheBudgetButManualSearchRuns(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.publish(t, hd1080, time.Hour)
	r.idx.Report(indexer.Limits{Reported: true, APICurrent: 80, APIMax: 100, GrabCurrent: 0, GrabMax: 0})
	if res, err := r.svc.Search(ctx, r.versions[slot.Standard]); err != nil || len(res.Items) == 0 {
		t.Fatalf("manual search = %+v, %v", res, err)
	}

	out, err := r.svc.SearchWanted(ctx, r.titleID, []int64{r.versions[slot.Standard]})
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Searched) != 0 || len(out.Grabbed) != 0 {
		t.Errorf("the sweep went ahead: %+v", out)
	}
	if out, _ := r.svc.SearchUpgrades(ctx, r.titleID, []int64{r.versions[slot.Standard]}); len(out.Searched) != 0 {
		t.Errorf("the Upgrade sweep went ahead: %+v", out)
	}
	if res, err := r.svc.Search(ctx, r.versions[slot.Standard]); err != nil || len(res.Items) == 0 {
		t.Errorf("manual search after the stop = %+v, %v", res, err)
	}
}

func TestSearchOnAddIsNotASweepSoTheBudgetStopDoesNotApply(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.publish(t, hd1080, time.Hour)
	r.idx.Report(indexer.Limits{Reported: true, APICurrent: 80, APIMax: 100})

	out, err := r.svc.SearchNew(ctx, r.titleID, []int64{r.versions[slot.Standard]})

	if err != nil || len(out.Searched) != 1 || len(out.Grabbed) != 1 {
		t.Fatalf("search on add at 80%% = %+v, %v; only sweeps stop there", out, err)
	}
}
