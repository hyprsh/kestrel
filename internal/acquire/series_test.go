package acquire_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/library"
	indexer "github.com/hyprsh/kestrel/internal/plugin/indexer/v1"
)

const (
	nightEp1  = "Night.Show.S01E01.1080p.WEB-DL.H264-GRP"
	nightEp2  = "Night.Show.S01E02.1080p.WEB-DL.H264-GRP"
	nightPack = "Night.Show.S01.1080p.WEB-DL.H264-GRP"
	nightS2   = "Night.Show.S02E01.1080p.WEB-DL.H264-GRP"
)

// publishShow posts a release of Night Show the way an indexer tags it.
func (r *rig) publishShow(t *testing.T, name, season, episode string) {
	t.Helper()
	err := r.idx.Publish(indexer.Release{
		Title: name, TVDBID: 5001, Season: season, Episode: episode, Size: 2 << 30,
		PublishDate: r.clock.now.Add(-time.Hour), Categories: []int{5040},
	}, []byte("<nzb>"+name+"</nzb>"))
	if err != nil {
		t.Fatal(err)
	}
}

func (r *rig) nightShow(t *testing.T, mode library.Monitor) (titleID, versionID int64) {
	t.Helper()
	d, v := nightShow()
	id := r.addSeries(t, d, v, mode)
	det, err := r.lib.Get(context.Background(), id, library.View{Country: "US", Now: r.clock.now})
	if err != nil {
		t.Fatal(err)
	}
	return id, det.Versions[0].ID
}

func TestAManualSearchOfASeriesVersionListsEpisodeAndPackReleasesWithTheirScores(t *testing.T) {
	r := newRig(t)
	_, ver := r.nightShow(t, library.MonitorAll)
	r.publishShow(t, nightEp1, "1", "1")
	r.publishShow(t, nightPack, "1", "")

	res, err := r.svc.Search(context.Background(), ver)
	if err != nil {
		t.Fatal(err)
	}

	if len(res.Items) != 2 {
		t.Fatalf("items = %+v", res.Items)
	}
	ep := r.found(t, res, nightEp1)
	if ep.Pack || ep.Season != 1 || len(ep.Episodes) != 1 || ep.Episodes[0] != 1 || ep.Fits != acquire.FitsThisSlot || len(ep.Rejections) != 0 {
		t.Errorf("episode release = %+v", ep)
	}
	pack := r.found(t, res, nightPack)
	if !pack.Pack || pack.Season != 1 || len(pack.Episodes) != 0 {
		t.Errorf("pack release = %+v", pack)
	}
}

func TestASeriesSearchCanBeNarrowedToASeasonOrAnEpisode(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	id, ver := r.nightShow(t, library.MonitorAll)
	r.publishShow(t, nightEp1, "1", "1")
	r.publishShow(t, nightEp2, "1", "2")
	r.publishShow(t, nightPack, "1", "")
	r.publishShow(t, nightS2, "2", "1")
	eps, _ := r.lib.Episodes(ctx, id, library.View{Country: "US", Now: r.clock.now})

	season := 1
	res, err := r.svc.SearchScope(ctx, ver, library.Scope{Season: &season})
	if err != nil || len(res.Items) != 3 {
		t.Fatalf("season search = %+v, %v", res.Items, err)
	}
	res, err = r.svc.SearchScope(ctx, ver, library.Scope{Season: &season, EpisodeIDs: []int64{eps[1].ID}})
	if err != nil {
		t.Fatal(err)
	}
	r.found(t, res, nightEp2)
	if len(res.Items) != 1 {
		t.Errorf("episode search = %+v", res.Items)
	}
}

func TestAManualGrabOfASeasonPackCoversTheSeasonsEpisodes(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	_, ver := r.nightShow(t, library.MonitorAll)
	r.publishShow(t, nightPack, "1", "")
	res, err := r.svc.Search(ctx, ver)
	if err != nil {
		t.Fatal(err)
	}

	g, err := r.svc.Grab(ctx, ver, r.found(t, res, nightPack).ID, false)
	if err != nil {
		t.Fatal(err)
	}

	if got, _ := r.svc.GrabEpisodes(ctx, g.ID); len(got) != 2 {
		t.Errorf("Grab covers %d episodes, want the 2 of season 1", len(got))
	}
	if items, _ := r.sab.List(ctx, r.sab.Conn(0), "tv"); len(items) != 1 {
		t.Errorf("client holds %d jobs in the tv category", len(items))
	}
}

func TestSearchOnAddGrabsASeriesFinishedSeasonAsOnePackAndLeavesTheUnairedSeasonAlone(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	id, ver := r.nightShow(t, library.MonitorAll)
	r.publishShow(t, nightEp1, "1", "1")
	r.publishShow(t, nightEp2, "1", "2")
	r.publishShow(t, nightPack, "1", "")

	out, err := r.svc.SearchWanted(ctx, id, []int64{ver})
	if err != nil {
		t.Fatal(err)
	}

	if len(out.Grabbed) != 1 || out.Grabbed[0].ReleaseName != nightPack || len(out.Searched) != 1 {
		t.Fatalf("outcome = %+v", out)
	}
	if got, _ := r.svc.GrabEpisodes(ctx, out.Grabbed[0].ID); len(got) != 2 {
		t.Errorf("pack covers %d episodes", len(got))
	}
	again, err := r.svc.SearchWanted(ctx, id, []int64{ver})
	if err != nil || len(again.Grabbed) != 0 {
		t.Errorf("a second search grabbed %+v, %v", again.Grabbed, err)
	}
}

func TestSearchOnAddGrabsSingleEpisodesWhenNoPackExists(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	id, ver := r.nightShow(t, library.MonitorAll)
	r.publishShow(t, nightEp1, "1", "1")

	out, err := r.svc.SearchWanted(ctx, id, []int64{ver})
	if err != nil || len(out.Grabbed) != 1 || out.Grabbed[0].ReleaseName != nightEp1 {
		t.Fatalf("outcome = %+v, %v", out, err)
	}
	if got, _ := r.svc.GrabEpisodes(ctx, out.Grabbed[0].ID); len(got) != 1 {
		t.Errorf("covers %d episodes", len(got))
	}
}

func TestAPackImportRecordsOneLogEventPerEpisode(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	hist := history.New(r.deps.Store, r.clock.Now, nil)
	r.deps.History = hist
	svc, err := acquire.New(r.deps)
	if err != nil {
		t.Fatal(err)
	}
	r.svc = svc
	id, ver := r.nightShow(t, library.MonitorAll)
	r.publishShow(t, nightPack, "1", "")
	res, _ := svc.Search(ctx, ver)
	g, err := svc.Grab(ctx, ver, r.found(t, res, nightPack).ID, false)
	if err != nil {
		t.Fatal(err)
	}
	eps, _ := svc.GrabEpisodes(ctx, g.ID)

	err = svc.RecordImport(ctx, g.ID, false, acquire.ImportOutcome{
		Status: acquire.ImportDone, Path: "/tv/a.mkv",
		Episodes: []acquire.EpisodeOutcome{
			{EpisodeID: eps[0], Season: 1, Number: 1, Status: acquire.ImportDone, Path: "/tv/a.mkv"},
			{EpisodeID: eps[1], Season: 1, Number: 2, Status: acquire.ImportRejected, Reason: "not_upgrade"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	events, _ := hist.After(ctx, 0, 100)
	var per []history.Event
	for _, e := range events {
		if e.Kind == history.ImportEpisode {
			per = append(per, e)
		}
	}
	if len(per) != 2 || per[0].EpisodeID != eps[0] || per[0].TitleID != id || per[0].GrabID != g.ID || per[1].EpisodeID != eps[1] {
		t.Fatalf("episode events = %+v", per)
	}
	var data struct{ Status, Reason string }
	_ = json.Unmarshal(per[1].Data, &data)
	if data.Status != "rejected" || data.Reason != "not_upgrade" {
		t.Errorf("data = %s", per[1].Data)
	}
}

func TestAnInconclusiveProbeIsNotedOnTheImportLogEvent(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	hist := history.New(r.deps.Store, r.clock.Now, nil)
	r.deps.History = hist
	svc, err := acquire.New(r.deps)
	if err != nil {
		t.Fatal(err)
	}
	_, ver := r.nightShow(t, library.MonitorAll)
	r.publishShow(t, nightEp1, "1", "1")
	res, _ := svc.Search(ctx, ver)
	g, err := svc.Grab(ctx, ver, r.found(t, res, nightEp1).ID, false)
	if err != nil {
		t.Fatal(err)
	}

	if err := svc.RecordImport(ctx, g.ID, false, acquire.ImportOutcome{Status: acquire.ImportDone, Path: "/tv/a.mkv", Inconclusive: true}); err != nil {
		t.Fatal(err)
	}

	events, _ := hist.After(ctx, 0, 100)
	for _, e := range events {
		if e.Kind == history.ImportDone {
			if !strings.Contains(e.Message, "probe inconclusive") || !strings.Contains(string(e.Data), `"probe_inconclusive":true`) {
				t.Errorf("event = %+v / %s", e, e.Data)
			}
			return
		}
	}
	t.Fatal("no import event")
}
