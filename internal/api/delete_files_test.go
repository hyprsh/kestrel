package api_test

import (
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/jobs"
)

type deletedJSON struct {
	Files []struct {
		Path        string  `json:"path"`
		Size        int64   `json:"size"`
		ReleaseName string  `json:"release_name"`
		EpisodeIDs  []int64 `json:"episode_ids"`
		Blocklisted bool    `json:"blocklisted"`
	} `json:"files"`
}

func TestDeletingAMoviesFileKeepsTheVersionMonitoredAndWanted(t *testing.T) {
	t.Parallel()
	s, file := importPaddington(t)
	sub := strings.TrimSuffix(file, ".mkv") + ".en.srt"
	if err := os.WriteFile(sub, []byte("1"), 0o644); err != nil {
		t.Fatal(err)
	}

	r := s.valid("DELETE", fmt.Sprintf("/versions/%d/files", s.hd), "")

	if r.Status != 200 {
		t.Fatalf("DELETE files = %d %s", r.Status, r.Body)
	}
	got := decode[deletedJSON](t, r)
	if len(got.Files) != 1 || got.Files[0].Path != file || got.Files[0].Size == 0 || got.Files[0].Blocklisted || len(got.Files[0].EpisodeIDs) != 0 {
		t.Errorf("deleted = %+v, want the one file, not blocklisted", got)
	}
	for _, p := range []string{file, sub} {
		if _, err := os.Stat(p); !os.IsNotExist(err) {
			t.Errorf("%s still on disk: %v", p, err)
		}
	}
	if v := s.version(t, s.hd); v.File != nil || v.State != "wanted" {
		t.Errorf("Version = %+v, want it kept, without a file and Wanted", v)
	}
	if title := decode[titleJSON](t, s.valid("GET", fmt.Sprintf("/titles/%d", s.title), "")); !title.Monitored {
		t.Errorf("Title = %+v, want it still monitored", title)
	}
	ev := s.events(t, "?kind=delete")
	if len(ev.Items) != 1 || !strings.Contains(ev.Items[0].Message, "Paddington (2014)") {
		t.Errorf("delete events = %+v, want one naming the file", ev.Items)
	}
	if bl := decode[blocklistJSON](t, s.valid("GET", "/blocklist", "")); len(bl.Items) != 0 {
		t.Errorf("blocklist = %+v, want nothing unless asked", bl.Items)
	}
}

func TestDeletingAMoviesFileCanBlocklistItsRelease(t *testing.T) {
	t.Parallel()
	s, _ := importPaddington(t)

	r := s.valid("DELETE", fmt.Sprintf("/versions/%d/files?blocklist=true", s.hd), "")

	if r.Status != 200 {
		t.Fatalf("DELETE files = %d %s", r.Status, r.Body)
	}
	if got := decode[deletedJSON](t, r); len(got.Files) != 1 || !got.Files[0].Blocklisted {
		t.Errorf("deleted = %+v, want the file blocklisted", got)
	}
	bl := decode[blocklistJSON](t, s.valid("GET", "/blocklist", ""))
	if len(bl.Items) != 1 || bl.Items[0].ReleaseName != goodRelease || bl.Items[0].TitleID == nil || *bl.Items[0].TitleID != s.title {
		t.Errorf("blocklist = %+v, want the imported Release for Paddington", bl.Items)
	}
}

func TestDeletingFilesAnswers404And422ForWhatIsNotThere(t *testing.T) {
	t.Parallel()
	s, file := importPaddington(t)
	for _, tc := range []struct {
		query  string
		status int
		field  string
	}{
		{"/versions/9999/files", 404, ""},
		{fmt.Sprintf("/versions/%d/files?season=1", s.hd), 422, "season"},
		{fmt.Sprintf("/versions/%d/files?episode_ids=1", s.hd), 422, "episode_ids"},
	} {
		r := s.valid("DELETE", tc.query, "")
		if r.Status != tc.status || !strings.Contains(string(r.Body), tc.field) {
			t.Errorf("DELETE %s = %d %s, want %d naming %q", tc.query, r.Status, r.Body, tc.status, tc.field)
		}
	}
	if _, err := os.Stat(file); err != nil {
		t.Errorf("the file went: %v", err)
	}
}

func TestDeletingOneEpisodeOfADoubleEpisodeFileDeletesTheFileForBoth(t *testing.T) {
	t.Parallel()
	s := newSeriesSearch(t)
	s.prober.set(goodProbe(), nil)
	const double = "Breaking.Bad.S01E02-E03.1080p.WEB-DL.H264-GRP"
	s.publishEpisode(t, double, "1", "2")
	s.pass(t, jobs.Search)
	s.finish(t, double, "breaking.bad.s01e02-e03.mkv")
	s.pass(t, jobs.Poll)
	s.pass(t, jobs.Import)
	eps := s.heat(t)
	two, three := eps[2], eps[3]
	path := two.Cells.Standard.File.Path

	r := s.valid("DELETE", fmt.Sprintf("/versions/%d/files?episode_ids=%d", s.hdVersion, two.ID), "")

	if r.Status != 200 {
		t.Fatalf("DELETE files = %d %s", r.Status, r.Body)
	}
	got := decode[deletedJSON](t, r)
	if len(got.Files) != 1 || got.Files[0].Path != path || !slices.Equal(got.Files[0].EpisodeIDs, []int64{two.ID, three.ID}) {
		t.Errorf("deleted = %+v, want the one file naming both episodes", got)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Errorf("the file is still on disk: %v", err)
	}
	for _, ep := range s.heat(t)[2:4] {
		if c := ep.Cells.Standard; c.State != "wanted" || c.File != nil || !ep.Monitored {
			t.Errorf("S01E%02d = %+v monitored %v, want it monitored and Wanted again", ep.Number, c, ep.Monitored)
		}
	}
	if ev := s.events(t, "?kind=delete"); len(ev.Items) != 1 || !strings.Contains(ev.Items[0].Message, "S01E02, S01E03") {
		t.Errorf("delete events = %+v, want one naming both episodes", ev.Items)
	}
}

func TestDeletingASeasonsFilesDeletesEveryFileOfItAndCanBlocklistTheirRelease(t *testing.T) {
	t.Parallel()
	s := newSeriesSearch(t)
	s.prober.set(goodProbe(), nil)
	s.publishEpisode(t, badPack, "1", "")
	s.pass(t, jobs.Search)
	s.finish(t, badPack, "Breaking.Bad.S01E01.1080p.WEB-DL.H264-GRP.mkv", "Breaking.Bad.S01E02.1080p.WEB-DL.H264-GRP.mkv", "Breaking.Bad.S01E03.1080p.WEB-DL.H264-GRP.mkv")
	s.pass(t, jobs.Poll)
	s.pass(t, jobs.Import)

	if r := s.valid("DELETE", fmt.Sprintf("/versions/%d/files?season=7", s.hdVersion), ""); r.Status != 422 || !strings.Contains(string(r.Body), "season") {
		t.Errorf("a season the Series lacks = %d %s, want 422 naming season", r.Status, r.Body)
	}
	r := s.valid("DELETE", fmt.Sprintf("/versions/%d/files?season=1&blocklist=true", s.hdVersion), "")

	if r.Status != 200 {
		t.Fatalf("DELETE files = %d %s", r.Status, r.Body)
	}
	got := decode[deletedJSON](t, r)
	if len(got.Files) != 3 {
		t.Fatalf("deleted = %+v, want the season's three files", got)
	}
	for _, f := range got.Files {
		if !f.Blocklisted || len(f.EpisodeIDs) != 1 {
			t.Errorf("file = %+v, want it blocklisted, holding one episode", f)
		}
	}
	for _, ep := range s.heat(t)[1:4] {
		if ep.Cells.Standard.State != "wanted" {
			t.Errorf("S01E%02d = %+v, want Wanted", ep.Number, ep.Cells.Standard)
		}
	}
	if bl := decode[blocklistJSON](t, s.valid("GET", "/blocklist", "")); len(bl.Items) != 1 || bl.Items[0].ReleaseName != badPack {
		t.Errorf("blocklist = %+v, want the pack once", bl.Items)
	}
}
