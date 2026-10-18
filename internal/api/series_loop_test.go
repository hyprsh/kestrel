package api_test

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/app"
	"github.com/hyprsh/kestrel/internal/jobs"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/metadata/metadatatest"
	indexer "github.com/hyprsh/kestrel/internal/plugin/indexer/v1"
)

const (
	badEp1  = "Breaking.Bad.S01E01.1080p.WEB-DL.H264-GRP"
	badPack = "Breaking.Bad.S01.1080p.WEB-DL.H264-GRP"
)

// seriesSearch is Kestrel with the fake TMDB, TheTVDB, an indexer and a download client, and Breaking Bad added in Standard.
type seriesSearch struct {
	search
	hdVersion int64
}

func newSeriesSearch(t *testing.T) seriesSearch {
	t.Helper()
	tvdb := metadatatest.NewTVDB(t)
	s := newSearchBare(t, func(o *app.Options) {
		o.TVDB = metadata.NewTVDB(metadata.TVDBOptions{BaseURL: tvdb.APIBase(), Keys: metadata.StaticTVDBKey(metadatatest.TVDBKey)})
	})
	r := s.valid("POST", "/titles", addBreakingBad+`,"series_monitor":"all"}`)
	if r.Status != 201 {
		t.Fatalf("POST /titles = %d %s", r.Status, r.Body)
	}
	created := decode[struct {
		ID       int64 `json:"id"`
		Versions []struct {
			ID int64 `json:"id"`
		} `json:"versions"`
	}](t, r)
	s.title = created.ID
	return seriesSearch{search: s, hdVersion: created.Versions[0].ID}
}

func (s seriesSearch) publishEpisode(t *testing.T, name, season, episode string) {
	t.Helper()
	err := s.idx.Publish(indexer.Release{
		Title: name, TVDBID: 81189, Season: season, Episode: episode, Size: 2 << 30, PublishDate: time.Now().Add(-time.Hour), Categories: []int{5040},
	}, []byte("<nzb>"+name+"</nzb>"))
	if err != nil {
		t.Fatal(err)
	}
}

// finish completes the client's only job with the named files and returns the files' folder.
func (s seriesSearch) finish(t *testing.T, release string, files ...string) {
	t.Helper()
	var jobID string
	for _, j := range s.jobs(t) {
		jobID = j.ClientID
	}
	dir := filepath.Join(t.TempDir(), release)
	for _, f := range files {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, f), []byte("video "+f), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.sab.Complete(jobID, dir); err != nil {
		t.Fatal(err)
	}
}

func (s seriesSearch) heat(t *testing.T) []episodeJSON {
	t.Helper()
	return episodesOf(t, s.library, s.title)
}

func TestTheSeriesLoopAddsAGrabsASingleEpisodeImportsItAndFillsTheHeatMap(t *testing.T) {
	s := newSeriesSearch(t)
	s.prober.set(goodProbe(), nil)
	s.publishEpisode(t, badEp1, "1", "1")

	s.pass(t, jobs.Search)

	q := s.queue(t)
	if len(q) != 1 || q[0].ReleaseName != badEp1 || len(q[0].Episodes) != 1 || q[0].Episodes[0] != "S01E01" {
		t.Fatalf("queue = %+v", q)
	}
	if got := s.jobs(t); len(got) != 1 || got[0].Category != "tv" {
		t.Fatalf("client jobs = %+v, want one in the tv category", got)
	}
	s.finish(t, badEp1, "breaking.bad.s01e01.mkv", "breaking.bad.s01e01.nfo")
	s.pass(t, jobs.Poll)
	s.pass(t, jobs.Import)

	eps := s.heat(t)
	pilot := eps[1]
	if pilot.Cells.Standard == nil || pilot.Cells.Standard.State != "filled" || pilot.Cells.Standard.Score == nil {
		t.Fatalf("pilot cells = %+v", pilot.Cells)
	}
	if eps[2].Cells.Standard.State != "wanted" {
		t.Errorf("episode 2 = %+v, want it still wanted", eps[2].Cells.Standard)
	}
	season := filepath.Join(s.data, "media", "tv", "Breaking Bad (2008) {tvdb-81189}", "Season 01")
	entries, err := os.ReadDir(season)
	if err != nil || len(entries) != 1 || !strings.HasPrefix(entries[0].Name(), "Breaking Bad (2008) - S01E01 - [Standard]") {
		t.Errorf("season folder = %v, %v", entries, err)
	}
	if q := s.queue(t); len(q) != 0 {
		t.Errorf("queue after the Import = %+v", q)
	}
}

func TestASeasonPackIsGrabbedAndImportedForEveryEpisodeItHolds(t *testing.T) {
	s := newSeriesSearch(t)
	s.prober.set(goodProbe(), nil)
	s.publishEpisode(t, badPack, "1", "")

	s.pass(t, jobs.Search)

	q := s.queue(t)
	if len(q) != 1 || q[0].ReleaseName != badPack || len(q[0].Episodes) != 1 || q[0].Episodes[0] != "S01E01-E03" {
		t.Fatalf("queue = %+v", q)
	}
	s.finish(t, badPack, "Breaking.Bad.S01E01.1080p.WEB-DL.H264-GRP.mkv", "Breaking.Bad.S01E02.1080p.WEB-DL.H264-GRP.mkv", "Breaking.Bad.S01E03.1080p.WEB-DL.H264-GRP.mkv")
	s.pass(t, jobs.Poll)
	s.pass(t, jobs.Import)

	for i, ep := range s.heat(t)[1:4] {
		if ep.Cells.Standard.State != "filled" {
			t.Errorf("episode %d = %+v", i+1, ep.Cells.Standard)
		}
	}
	entries, _ := os.ReadDir(filepath.Join(s.data, "media", "tv", "Breaking Bad (2008) {tvdb-81189}", "Season 01"))
	if len(entries) != 3 {
		t.Errorf("season folder holds %d files", len(entries))
	}
}

func TestAManualSearchOfASeriesVersionListsEpisodeAndPackReleases(t *testing.T) {
	s := newSeriesSearch(t)
	s.publishEpisode(t, badEp1, "1", "1")
	s.publishEpisode(t, badPack, "1", "")

	r := s.valid("POST", fmt.Sprintf("/versions/%d/releases", s.hdVersion), `{"season":1}`)
	if r.Status != 200 {
		t.Fatalf("search = %d %s", r.Status, r.Body)
	}
	list := decode[struct {
		Items []struct {
			Name     string `json:"name"`
			Score    int    `json:"score"`
			Fits     string `json:"fits"`
			Season   *int   `json:"season"`
			Episodes []int  `json:"episodes"`
			Pack     *bool  `json:"pack"`
		} `json:"items"`
	}](t, r)

	if len(list.Items) != 2 {
		t.Fatalf("items = %+v", list.Items)
	}
	for _, it := range list.Items {
		switch it.Name {
		case badEp1:
			if it.Season == nil || *it.Season != 1 || len(it.Episodes) != 1 || it.Pack == nil || *it.Pack || it.Fits != "this_slot" {
				t.Errorf("episode release = %+v", it)
			}
		case badPack:
			if it.Pack == nil || !*it.Pack || it.Season == nil || *it.Season != 1 || len(it.Episodes) != 0 {
				t.Errorf("pack release = %+v", it)
			}
		default:
			t.Errorf("unexpected release %q", it.Name)
		}
	}
}
