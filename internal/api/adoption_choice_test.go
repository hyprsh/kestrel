package api_test

import (
	"fmt"
	"path/filepath"
	"testing"
)

func TestANeedsChoiceRowIsSettledFromItsCandidatesAndAdoptedWhileUnsettledOnesAreLeftOut(t *testing.T) {
	a := newAdopting(t)
	pick := a.put(t, "Paddington/pad.mkv", "ambiguous")
	left := a.put(t, "Unknown Thing/thing.mkv", "nobody knows")
	plan := a.scan(t)

	row := a.rowOf(t, "Paddington")
	if row.Status != "needs_choice" || len(row.Candidates) == 0 || row.Candidates[0].TMDBID != 116149 {
		t.Fatalf("row = %+v", row)
	}
	if other := a.rowOf(t, "Unknown Thing"); other.Status != "needs_choice" || len(other.Candidates) != 0 {
		t.Fatalf("a title nothing matches = %+v", other)
	}
	r := a.valid("PATCH", fmt.Sprintf("/adoption/rows/%d", row.ID), fmt.Sprintf(`{"tmdb_id":%d}`, row.Candidates[0].TMDBID))
	if r.Status != 200 {
		t.Fatalf("PATCH = %d %s", r.Status, r.Body)
	}
	settled := decode[adoptionRowJSON](t, r)
	if settled.Status != "matched" || settled.Match == nil || settled.Match.TMDBID != 116149 || settled.Match.Source != "chosen" ||
		!settled.Ticked || len(settled.Files) != 1 {
		t.Fatalf("settled = %+v", settled)
	}
	if now := decode[adoptionJSON](t, a.valid("GET", "/adoption", "")); now.Revision <= plan.Revision || now.Summary.NeedsChoice != 1 || now.Summary.Matched != 1 {
		t.Errorf("after settling = %+v", now)
	}

	a.commit(t, decode[adoptionJSON](t, a.valid("GET", "/adoption", "")).Revision)

	if files := a.titleFiles(t, a.titleIDOf(t, 116149)); filepath.Dir(files["standard"]) != filepath.Join(a.movies, "Paddington (2014) {tmdb-116149}") || exists(t, pick) {
		t.Errorf("the chosen row was not adopted: %v", files)
	}
	if !exists(t, left) {
		t.Error("an unsettled row was touched")
	}
}

func TestACommitOfAStalePlanIsRefusedAndAnUntickedRowIsNotAdopted(t *testing.T) {
	a := newAdopting(t)
	video := a.put(t, "Paddington.2014.1080p.BluRay.x264-GRP/Paddington.2014.1080p.BluRay.x264-GRP.mkv", "movie")
	plan := a.scan(t)
	row := a.rows(t, "matched")[0]

	if r := a.valid("PATCH", fmt.Sprintf("/adoption/rows/%d", row.ID), `{"ticked":false}`); r.Status != 200 {
		t.Fatalf("untick = %d %s", r.Status, r.Body)
	}
	if r := a.do("POST", "/adoption/commit", fmt.Sprintf(`{"revision":%d}`, plan.Revision)); r.Status != 409 {
		t.Fatalf("commit of the reviewed-before-the-edit plan = %d %s", r.Status, r.Body)
	}
	now := decode[adoptionJSON](t, a.valid("GET", "/adoption", ""))
	done := a.commit(t, now.Revision)

	if done.Result == nil || done.Result.Adopted != 0 || !exists(t, video) {
		t.Errorf("an unticked row was adopted: %+v", done)
	}
}

func TestAnIMDbTagMatchesAndAScanOfAnUnconfiguredRootFolderIsRefused(t *testing.T) {
	a := newAdopting(t)
	a.put(t, "Whatever {imdb-tt1109624}/whatever.mkv", "x")
	if r := a.do("POST", "/adoption/scan", `{"root_folders":["/nowhere"]}`); r.Status != 422 {
		t.Errorf("scan of /nowhere = %d %s", r.Status, r.Body)
	}

	a.scan(t)

	row := a.rowOf(t, "Whatever {imdb-tt1109624}")
	if row.Status != "matched" || row.Match == nil || row.Match.TMDBID != 116149 || row.Match.Source != "tag" {
		t.Errorf("row = %+v", row)
	}
}
