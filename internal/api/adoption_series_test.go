package api_test

import (
	"fmt"
	"path/filepath"
	"strings"
	"testing"
)

const bbFolder = "Breaking Bad (2008) {tvdb-81189}"

func (a adopting) cellsOf(t *testing.T, id int64) map[string]string {
	t.Helper()
	out := map[string]string{}
	for _, e := range episodesOf(t, a.library, id) {
		for slot, c := range map[string]*cellJSON{"sd": e.Cells.SD, "hd": e.Cells.HD, "uhd": e.Cells.UHD} {
			if c != nil && c.State == "filled" {
				out[fmt.Sprintf("S%02dE%02d", e.Season, e.Number)+"/"+slot] = "filled"
			}
		}
	}
	return out
}

func TestASeriesFolderIsAdoptedWithSeveralVersionsPerEpisodeByLabelAndResolution(t *testing.T) {
	a := newAdopting(t)
	a.putTV(t, bbFolder+"/Season 01/Breaking Bad - S01E01 - [HD][WEBDL-1080p][English][h264]-GRP.mkv", "hd")
	a.putTV(t, bbFolder+"/Season 01/Breaking Bad - S01E01 - [SD][WEBDL-480p][English][h264]-GRP.mkv", "sd")
	a.putTV(t, bbFolder+"/Season 01/Breaking.Bad.S01E02-E03.1080p.WEB-DL.x264-GRP.mkv", "pack")
	a.putTV(t, bbFolder+"/Season 02/Breaking.Bad.S02E01.2160p.WEB-DL.x265-uhd.mkv", "uhd")
	a.putTV(t, bbFolder+"/Season 01/Breaking.Bad.S01E09.1080p.WEB-DL.x264-GRP.mkv", "nope")

	plan := a.scan(t)

	if plan.Summary.Matched != 1 || plan.Summary.Skipped != 0 {
		t.Fatalf("plan = %+v", plan)
	}
	row := a.rowOf(t, bbFolder)
	if row.Kind != "series" || row.Match == nil || row.Match.Source != "tag" || row.Match.TMDBID != 1396 {
		t.Fatalf("row = %+v", row)
	}
	slots := map[string]int{}
	for _, f := range row.Files {
		if f.Left == nil {
			slots[f.Slot]++
		} else if *f.Left != "unmatched" {
			t.Errorf("left %q for %s", *f.Left, f.Path)
		}
	}
	if slots["hd"] != 2 || slots["sd"] != 1 || slots["uhd"] != 1 {
		t.Fatalf("files per Slot = %v", slots)
	}

	a.commit(t, plan.Revision)

	id := a.titleIDOf(t, 1396)
	got := a.cellsOf(t, id)
	for _, want := range []string{"S01E01/hd", "S01E01/sd", "S01E02/hd", "S01E03/hd", "S02E01/uhd"} {
		if got[want] == "" {
			t.Errorf("missing %s in %v", want, got)
		}
	}
	if len(got) != 5 {
		t.Errorf("cells = %v", got)
	}
	// Renamed in place into the scheme; the pack keeps one file for two episodes.
	if pack := a.heldFile(t, "S01E02-E03"); !strings.HasPrefix(filepath.Base(pack), "Breaking Bad (2008) - S01E02-E03 - [HD]") {
		t.Errorf("pack = %q", pack)
	}
	if exists(t, filepath.Join(a.tv, bbFolder, "Season 01", "Breaking.Bad.S01E02-E03.1080p.WEB-DL.x264-GRP.mkv")) {
		t.Error("the pack was not renamed")
	}
	if !exists(t, filepath.Join(a.tv, bbFolder, "Season 01", "Breaking.Bad.S01E09.1080p.WEB-DL.x264-GRP.mkv")) {
		t.Error("the unmatched file was touched")
	}
}

func TestASeriesNotOnTheTVDBIsSkippedWithTheReason(t *testing.T) {
	a := newAdopting(t)
	a.putTV(t, "Orphan Show (2019) {tmdb-9001}/Season 01/Orphan.Show.S01E01.1080p.WEB-DL-GRP.mkv", "x")

	plan := a.scan(t)

	row := a.rowOf(t, "Orphan Show (2019) {tmdb-9001}")
	if plan.Summary.Skipped != 1 || row.Status != "skipped" || row.SkipReason == nil || *row.SkipReason != "not_on_tvdb" {
		t.Fatalf("plan = %+v, row = %+v", plan.Summary, row)
	}
}

func TestASeriesIsMatchedByNameWithinAYearAndOtherwiseNeedsAChoice(t *testing.T) {
	a := newAdopting(t)
	a.putTV(t, "Breaking Bad (2009)/Season 01/Breaking.Bad.S01E01.1080p.WEB-DL-GRP.mkv", "x")
	a.putTV(t, "Breaking Bad (2012)/Season 01/Breaking.Bad.S01E01.1080p.WEB-DL-GRP.mkv", "y")

	a.scan(t)

	if r := a.rowOf(t, "Breaking Bad (2009)"); r.Status != "matched" || r.Match.Source != "name" {
		t.Errorf("±1 year = %+v", r)
	}
	if r := a.rowOf(t, "Breaking Bad (2012)"); r.Status != "needs_choice" || len(r.Candidates) == 0 {
		t.Errorf("4 years off = %+v", r)
	}
}

func TestAnEpisodeFileThatWouldReplaceAHeldOneIsUntickedAndReplacesOnlyWhenTicked(t *testing.T) {
	a := newAdopting(t)
	a.putTV(t, bbFolder+"/Season 01/Breaking.Bad.S01E01.1080p.WEB-DL.x264-GRP.mkv", "first")
	a.commit(t, a.scan(t).Revision)
	id := a.titleIDOf(t, 1396)
	held := a.heldFile(t, "S01E01")
	rival := a.putTV(t, bbFolder+"/Season 01/Breaking.Bad.S01E01.1080p.WEB-DL.x264-OTHER.mkv", "second")
	a.putTV(t, bbFolder+"/Season 01/Breaking.Bad.S01E02.1080p.WEB-DL.x264-GRP.mkv", "fills a gap")

	plan := a.scan(t)

	rows := a.rows(t, "replacement")
	if len(rows) != 1 || plan.Summary.Replacement != 1 {
		t.Fatalf("replacement rows = %+v, summary %+v", rows, plan.Summary)
	}
	var f adoptionFileJSON
	var gap adoptionFileJSON
	for _, x := range rows[0].Files {
		if x.Path == rival {
			f = x
		} else {
			gap = x
		}
	}
	if f.Action != "replace" || f.Ticked || f.HeldScore == nil || gap.Action != "fill" || !gap.Ticked {
		t.Fatalf("replace = %+v, gap = %+v", f, gap)
	}

	done := a.commit(t, plan.Revision)
	if done.Result == nil || !exists(t, held) || !exists(t, rival) {
		t.Fatalf("an unticked replacement happened: %+v (held %v, rival %v) result %+v", done, exists(t, held), exists(t, rival), done.Result)
	}
	if got := a.cellsOf(t, id); got["S01E02/hd"] == "" {
		t.Errorf("the gap was not filled: %v", got)
	}

	a.scan(t)
	row := a.rows(t, "replacement")[0]
	if r := a.valid("PATCH", fmt.Sprintf("/adoption/rows/%d", row.ID), fmt.Sprintf(`{"files":[{"path":%q,"ticked":true}]}`, rival)); r.Status != 200 {
		t.Fatalf("tick = %d %s", r.Status, r.Body)
	}
	a.commit(t, decode[adoptionJSON](t, a.valid("GET", "/adoption", "")).Revision)

	if exists(t, held) || exists(t, rival) {
		t.Errorf("held %v, rival %v still there", exists(t, held), exists(t, rival))
	}
	if got := a.cellsOf(t, id); got["S01E01/hd"] == "" {
		t.Errorf("S01E01 lost its file: %v", got)
	}
}

// heldFile is the one file in the Series' first season folder named for an episode.
func (a adopting) heldFile(t *testing.T, ep string) string {
	t.Helper()
	m, _ := filepath.Glob(filepath.Join(a.tv, bbFolder, "Season 01", "*"+ep+"*"))
	if len(m) != 1 {
		t.Fatalf("files for %s: %v", ep, m)
	}
	return m[0]
}

func TestTwoFilesForOneEpisodeAndSlotGoToTheHigherScoreAndTheOtherStaysAsADuplicate(t *testing.T) {
	a := newAdopting(t)
	a.putTV(t, bbFolder+"/Season 01/Breaking.Bad.S01E01.1080p.WEB-DL.x264-GRP.mkv", "a")
	a.putTV(t, bbFolder+"/Season 01/Breaking.Bad.S01E01.small.1080p.WEB-DL.x264-GRP.mkv", "b")

	plan := a.scan(t)

	if plan.Summary.Duplicate != 1 {
		t.Fatalf("summary = %+v", plan.Summary)
	}
	lefts := 0
	for _, f := range a.rowOf(t, bbFolder).Files {
		if f.Left != nil && *f.Left == "duplicate" {
			lefts++
		}
	}
	if lefts != 1 {
		t.Errorf("%d duplicates", lefts)
	}
}
