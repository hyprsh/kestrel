package acquire_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/plugin"
	indexer "github.com/hyprsh/kestrel/internal/plugin/indexer/v1"
	"github.com/hyprsh/kestrel/internal/plugin/instances"
	"github.com/hyprsh/kestrel/internal/slot"
)

// addBeta adds an Indexer backed by the second fake, at the given priority.
func (r *rig) addBeta(t *testing.T, name string, priority int) int64 {
	t.Helper()
	inst, err := r.inst.Create(context.Background(), instances.New{PluginID: "fake_indexer_2", Name: name, Priority: priority, Config: map[string]any{"api_key": "k"}})
	if err != nil {
		t.Fatal(err)
	}
	return inst.ID
}

// publishBeta posts hd1080 on the second fake, offset from Alpha's copy, which is posted an hour ago.
func (r *rig) publishBeta(t *testing.T, offset time.Duration, size int64) {
	t.Helper()
	err := r.idx2.Publish(indexer.Release{
		Title: hd1080, IMDBID: "tt1109624", TMDBID: 116149, Size: size, PublishDate: r.clock.now.Add(-time.Hour + offset), Categories: []int{2040},
	}, []byte("<nzb>beta</nzb>"))
	if err != nil {
		t.Fatal(err)
	}
}

// foundOn is the search result for hd1080 that the named Indexer returned.
func foundOn(t *testing.T, res acquire.SearchResult, indexerName string) acquire.Found {
	t.Helper()
	for _, f := range res.Items {
		if f.Name == hd1080 && f.Indexer == indexerName {
			return f
		}
	}
	t.Fatalf("no %s copy from %s", hd1080, indexerName)
	return acquire.Found{}
}

func (r *rig) grabRows(t *testing.T) []acquire.Record {
	t.Helper()
	rows, err := r.svc.Grabs(context.Background(), acquire.GrabFilter{Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	return rows
}

func TestASweepGrabFetchesTheSameReleaseFromTheNextIndexerWhenTheFirstFails(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.addBeta(t, "Beta", 2)
	r.publish(t, hd1080, time.Hour)
	r.publishBeta(t, 0, 8<<30)
	r.idx.Exhaust(plugin.LimitGrab, time.Minute)

	out, err := r.svc.SearchWanted(ctx, r.titleID, []int64{r.versions[slot.Standard]})
	if err != nil || len(out.Grabbed) != 1 {
		t.Fatalf("grabbed = %+v, %v", out.Grabbed, err)
	}
	g := out.Grabbed[0]
	if g.IndexerName != "Beta" {
		t.Errorf("grab names %s, want Beta", g.IndexerName)
	}
	if rows := r.grabRows(t); len(rows) != 1 {
		t.Errorf("grab rows = %d, want 1", len(rows))
	}
}

func TestAManualGrabOfAFailingCopyFetchesTheSameReleaseFromAnotherIndexer(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.addBeta(t, "Beta", 2)
	r.publish(t, hd1080, time.Hour)
	r.publishBeta(t, 90*time.Second, 8<<30+1<<20)
	r.idx.Exhaust(plugin.LimitGrab, time.Minute)
	res, _ := r.svc.Search(ctx, r.versions[slot.Standard])
	alpha := foundOn(t, res, "Alpha")

	g, err := r.svc.Grab(ctx, r.versions[slot.Standard], alpha.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	if g.IndexerName != "Beta" {
		t.Errorf("grab = %+v, want Beta's copy", g)
	}
	items, _ := r.sab.List(ctx, r.sab.Conn(0), "films")
	if len(items) != 1 {
		t.Errorf("client holds %d jobs, want 1", len(items))
	}
}

func TestACopyOutsideTheSameReleaseWindowIsNotUsedAsAFallback(t *testing.T) {
	for _, tc := range []struct {
		name   string
		offset time.Duration
		size   int64
	}{
		{"posted too far apart", 3 * time.Minute, 8 << 30},
		{"sizes too far apart", 0, 8<<30 + 3<<20},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			r := newRig(t)
			r.addBeta(t, "Beta", 2)
			r.publish(t, hd1080, time.Hour)
			r.publishBeta(t, tc.offset, tc.size)
			r.idx.Exhaust(plugin.LimitGrab, time.Minute)
			res, _ := r.svc.Search(ctx, r.versions[slot.Standard])

			_, err := r.svc.Grab(ctx, r.versions[slot.Standard], foundOn(t, res, "Alpha").ID, false)
			if pe := plugin.AsError(err); pe.Code != plugin.CodeRateLimited {
				t.Errorf("err = %v, want Alpha's rate limit", err)
			}
			if rows := r.grabRows(t); len(rows) != 0 {
				t.Errorf("grab rows = %d, want none", len(rows))
			}
		})
	}
}

func TestWhenEveryCopyFailsTheGrabFailsWithTheFirstCopysErrorAndWritesNoGrab(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.addBeta(t, "Beta", 2)
	r.publish(t, hd1080, time.Hour)
	r.publishBeta(t, 0, 8<<30)
	res, _ := r.svc.Search(ctx, r.versions[slot.Standard])
	alpha := foundOn(t, res, "Alpha")
	r.idx.Exhaust(plugin.LimitGrab, time.Minute)
	r.idx2.Remove(hd1080)

	_, err := r.svc.Grab(ctx, r.versions[slot.Standard], alpha.ID, false)
	if pe := plugin.AsError(err); pe.Code != plugin.CodeRateLimited || pe.Limit != plugin.LimitGrab {
		t.Errorf("err = %v, want Alpha's spent Grab budget", err)
	}

	if rows := r.grabRows(t); len(rows) != 0 {
		t.Errorf("grab rows = %d, want none", len(rows))
	}
}

func TestWhenNoCopyIsOnAnyIndexerAnymoreTheReleaseIsGone(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.addBeta(t, "Beta", 2)
	r.publish(t, hd1080, time.Hour)
	r.publishBeta(t, 0, 8<<30)
	res, _ := r.svc.Search(ctx, r.versions[slot.Standard])
	alpha := foundOn(t, res, "Alpha")
	r.idx.Remove(hd1080)
	r.idx2.Remove(hd1080)

	_, err := r.svc.Grab(ctx, r.versions[slot.Standard], alpha.ID, false)
	if !errors.Is(err, acquire.ErrReleaseGone) {
		t.Errorf("err = %v, want ErrReleaseGone", err)
	}
	if rows := r.grabRows(t); len(rows) != 0 {
		t.Errorf("grab rows = %d, want none", len(rows))
	}
	if items, _ := r.sab.List(ctx, r.sab.Conn(0), "films"); len(items) != 0 {
		t.Errorf("client holds %d jobs, want none", len(items))
	}
}

func TestIndexerPriorityDecidesTheOrderTheCopiesAreTried(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.addBeta(t, "Beta", 3) // made first, so an id order would try it first
	r.addBeta(t, "Gamma", 2)
	r.publish(t, hd1080, time.Hour)
	r.publishBeta(t, 0, 8<<30)
	r.idx.Exhaust(plugin.LimitGrab, time.Minute)
	res, _ := r.svc.Search(ctx, r.versions[slot.Standard])

	g, err := r.svc.Grab(ctx, r.versions[slot.Standard], foundOn(t, res, "Alpha").ID, false)
	if err != nil {
		t.Fatal(err)
	}
	if g.IndexerName != "Gamma" {
		t.Errorf("delivered by %s, want Gamma (priority 2)", g.IndexerName)
	}
}
