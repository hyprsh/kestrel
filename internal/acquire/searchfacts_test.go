package acquire_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/library"
	downloadclient "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1"
	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/slot"
)

func (r *rig) lastSearch(t *testing.T, ver int64) acquire.LastSearch {
	t.Helper()
	got, err := r.svc.LastSearches(context.Background(), []int64{ver})
	if err != nil {
		t.Fatal(err)
	}
	ls, ok := got[ver]
	if !ok {
		t.Fatalf("Version %d has no last search", ver)
	}
	return ls
}

func TestASearchRecordsWhatItFoundAndThatItGrabbed(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.publish(t, hd1080, time.Hour)
	r.publish(t, german, 2*time.Hour)

	if _, err := r.svc.SearchWanted(ctx, r.titleID, r.wanted(t, slot.Standard)); err != nil {
		t.Fatal(err)
	}

	ls := r.lastSearch(t, r.versions[slot.Standard])
	if ls.Outcome != acquire.SearchGrabbed || ls.Releases != 2 || ls.Upgrade || !ls.At.Equal(r.clock.now) {
		t.Errorf("last search = %+v, want grabbed, 2 releases, at the search time", ls)
	}
}

func TestASearchThatFindsNothingFitCountsTheRejectionReasons(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.publish(t, german, time.Hour)
	r.publish(t, uhd, 2*time.Hour)

	out, err := r.svc.SearchWanted(ctx, r.titleID, r.wanted(t, slot.Standard))
	if err != nil || len(out.Grabbed) != 0 {
		t.Fatalf("SearchWanted = %+v, %v; nothing should be grabbed", out, err)
	}

	ls := r.lastSearch(t, r.versions[slot.Standard])
	if ls.Outcome != acquire.SearchNothingFit || ls.Releases != 2 {
		t.Fatalf("last search = %+v, want nothing_fit over 2 releases", ls)
	}
	counted := map[scoring.Rejection]int{}
	for _, rc := range ls.Reasons {
		counted[rc.Code] = rc.Count
	}
	if counted[acquire.RejectOtherSlot] != 1 || len(ls.Reasons) < 2 {
		t.Errorf("reasons = %+v, want the 2160p counted as other_slot and the German one with its own reason", ls.Reasons)
	}
	german := false
	for _, rc := range ls.Reasons {
		german = german || (rc.Code == scoring.RejectLanguage && rc.Detail == "German" && rc.Count == 1)
	}
	if !german {
		t.Errorf("reasons = %+v, want the German release counted as a language rejection of German", ls.Reasons)
	}
	if ls.Reasons[0].Count < ls.Reasons[len(ls.Reasons)-1].Count {
		t.Errorf("reasons = %+v, want the most common first", ls.Reasons)
	}
}

func TestASearchWithNoIndexerEnabledSaysSo(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	if err := r.inst.Delete(ctx, r.idxID); err != nil {
		t.Fatal(err)
	}

	if _, err := r.svc.SearchWanted(ctx, r.titleID, r.wanted(t, slot.Standard)); err != nil {
		t.Fatal(err)
	}

	if ls := r.lastSearch(t, r.versions[slot.Standard]); ls.Outcome != acquire.SearchNoIndexer || ls.Releases != 0 {
		t.Errorf("last search = %+v, want no_indexer", ls)
	}
}

func TestTheNextSearchReplacesTheLastOne(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	if _, err := r.svc.SearchNew(ctx, r.titleID, r.wanted(t, slot.Standard)); err != nil {
		t.Fatal(err)
	}
	if ls := r.lastSearch(t, r.versions[slot.Standard]); ls.Outcome != acquire.SearchNothingFit || ls.Releases != 0 {
		t.Fatalf("first search = %+v", ls)
	}
	r.clock.now = r.clock.now.Add(time.Hour)
	r.publish(t, hd1080, time.Minute)

	if _, err := r.svc.SearchNew(ctx, r.titleID, r.wanted(t, slot.Standard)); err != nil {
		t.Fatal(err)
	}

	if ls := r.lastSearch(t, r.versions[slot.Standard]); ls.Outcome != acquire.SearchGrabbed || ls.Releases != 1 || !ls.At.Equal(r.clock.now) {
		t.Errorf("second search = %+v, want it to replace the first", ls)
	}
}

func TestAnUpgradeSearchIsRecordedAsOne(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.fill(t, 100000)
	r.publish(t, hd1080, time.Hour)

	if _, err := r.svc.SearchUpgrades(ctx, r.titleID, r.wanted(t, slot.Standard)); err != nil {
		t.Fatal(err)
	}

	if ls := r.lastSearch(t, r.versions[slot.Standard]); !ls.Upgrade || ls.Outcome != acquire.SearchNothingFit || ls.Releases != 1 {
		t.Errorf("last search = %+v, want an Upgrade search that found nothing better", ls)
	}
}

func TestASeriesSearchRecordsItsFindingsForTheVersion(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	id, ver := r.nightShow(t, library.MonitorAll)
	r.publishShow(t, nightEp1, "1", "1")

	if _, err := r.svc.SearchWanted(ctx, id, []int64{ver}); err != nil {
		t.Fatal(err)
	}

	if ls := r.lastSearch(t, ver); ls.Outcome != acquire.SearchGrabbed || ls.Releases != 1 {
		t.Errorf("last search = %+v, want grabbed over 1 release", ls)
	}
}

func TestAGrabRecordsHowManyWantedItCoversAndHowManyFilesItReplaces(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	g := r.grabOne(t)
	if w := g.Why; w == nil || w.CoversWanted != 1 || w.ReplacesFiles != 0 || w.ScoreDelta != 0 {
		t.Errorf("a first Grab's Why = %+v, want 1 Wanted covered and nothing replaced", w)
	}
	got, _ := r.svc.GetGrab(ctx, g.ID)
	if got.Why == nil || *got.Why != *g.Why {
		t.Errorf("the stored Why = %+v, want %+v", got.Why, g.Why)
	}
}

func TestAnUpgradeGrabRecordsTheFileItReplacesAndTheScoreGain(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.fill(t, -100000)
	r.publish(t, hd1080, time.Hour)

	out, err := r.svc.SearchUpgrades(ctx, r.titleID, r.wanted(t, slot.Standard))
	if err != nil || len(out.Grabbed) != 1 {
		t.Fatalf("SearchUpgrades = %+v, %v", out, err)
	}

	w := out.Grabbed[0].Why
	if w == nil || w.CoversWanted != 0 || w.ReplacesFiles != 1 || w.ScoreDelta != out.Grabbed[0].Score+100000 {
		t.Errorf("Why = %+v for a Release of Score %d replacing a file of -100000", w, out.Grabbed[0].Score)
	}
}

func TestASeriesGrabCountsTheWantedEpisodesItCovers(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	_, ver := r.nightShow(t, library.MonitorAll)
	r.publishShow(t, nightPack, "1", "")
	res, _ := r.svc.Search(ctx, ver)

	g, err := r.svc.Grab(ctx, ver, r.found(t, res, nightPack).ID, false)
	if err != nil {
		t.Fatal(err)
	}

	eps, _ := r.svc.GrabEpisodes(ctx, g.ID)
	if g.Why == nil || g.Why.CoversWanted != len(eps) || len(eps) < 2 || g.Why.ReplacesFiles != 0 {
		t.Errorf("Why = %+v for a pack covering %d episodes", g.Why, len(eps))
	}
}

func TestASearchNowEventCarriesWhatItCheckedAndGrabbed(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	hist := history.New(r.deps.Store, r.clock.Now, nil)
	r.deps.History = hist
	svc, err := acquire.New(r.deps)
	if err != nil {
		t.Fatal(err)
	}
	r.publish(t, hd1080, time.Hour)
	r.publish(t, german, time.Hour)

	if err := svc.StartSearch(ctx, r.versions[slot.Standard], library.Scope{}); err != nil {
		t.Fatal(err)
	}
	var data struct {
		Releases, Grabbed int
		Slot, Result      string
	}
	deadline := time.Now().Add(5 * time.Second)
	for found := false; !found && time.Now().Before(deadline); {
		events, _ := hist.After(ctx, 0, 100)
		for _, e := range events {
			if e.Kind == history.Searched {
				found = true
				if err := json.Unmarshal(e.Data, &data); err != nil {
					t.Fatalf("data %s: %v", e.Data, err)
				}
			}
		}
		time.Sleep(10 * time.Millisecond)
	}

	if data.Releases != 2 || data.Grabbed != 1 || data.Slot != "Standard" || data.Result != "grabbed" {
		t.Errorf("Searched event data = %+v, want 2 releases, 1 Grab in Standard", data)
	}
}

func TestAnImportRecordsTheFilesItChecksAndReplaces(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	g := r.grabOne(t)
	if g.ImportChecking != nil || g.ImportReplaced != nil {
		t.Fatalf("a fresh Grab has import facts %v, %v", g.ImportChecking, g.ImportReplaced)
	}

	if err := r.svc.NoteChecking(ctx, g.ID, 2); err != nil {
		t.Fatal(err)
	}
	got, _ := r.svc.GetGrab(ctx, g.ID)
	if got.ImportChecking == nil || *got.ImportChecking != 2 {
		t.Fatalf("checking = %v, want 2", got.ImportChecking)
	}

	if err := r.svc.RecordImport(ctx, g.ID, false, acquire.ImportOutcome{Status: acquire.ImportDone, Path: "/m/a.mkv", Replaced: 1}); err != nil {
		t.Fatal(err)
	}
	got, _ = r.svc.GetGrab(ctx, g.ID)
	if got.ImportChecking != nil || got.ImportReplaced == nil || *got.ImportReplaced != 1 {
		t.Errorf("after the Import: checking %v, replaced %v; want the count dropped and 1 replaced", got.ImportChecking, got.ImportReplaced)
	}
}

func TestAGrabKeepsWhenItsDownloadStartedAndFinished(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	g := r.grabOne(t)
	_ = r.sab.SetPhase(g.ClientID, downloadclient.PhaseDownloading, 400)
	_, _ = r.svc.Poll(ctx)
	r.clock.now = r.clock.now.Add(9 * time.Minute)
	_ = r.sab.Complete(g.ClientID, "/data/usenet/movies/Paddington")
	_, _ = r.svc.Poll(ctx)

	got, _ := r.svc.GetGrab(ctx, g.ID)

	if got.DownloadStartedAt == nil || got.DownloadDoneAt == nil || got.DownloadDoneAt.Sub(*got.DownloadStartedAt) != 9*time.Minute {
		t.Errorf("download times = %v, %v, want them 9 minutes apart", got.DownloadStartedAt, got.DownloadDoneAt)
	}
}

func TestAnOutageCountsTheGrabsItHeldUp(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.grabOne(t)

	waited, lost, err := r.svc.HeldUp(ctx, 0, r.clock.now.Add(-time.Hour))

	if err != nil || waited != 1 || lost != 0 {
		t.Errorf("HeldUp = %d waited, %d lost, %v; want 1 waiting, none lost", waited, lost, err)
	}
	if waited, _, _ := r.svc.HeldUp(ctx, r.idxID+99, r.clock.now.Add(-time.Hour)); waited != 0 {
		t.Errorf("another indexer's outage holds up %d Grabs, want 0", waited)
	}
}
