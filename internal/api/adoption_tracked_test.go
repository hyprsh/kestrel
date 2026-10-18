package api_test

import (
	"fmt"
	"path/filepath"
	"testing"
)

func TestFilesOfATrackedTitleFillItsEmptyVersionAndCreateAMissingOneWithoutAddingATitleOrSearching(t *testing.T) {
	a := newAdopting(t)
	added := decode[titleJSON](t, a.valid("POST", "/titles", `{"kind":"movie","tmdb_id":116149,"versions":[{"slot":"standard","profile":"hd-primary"}]}`))
	a.put(t, "Paddington (2014)/Paddington.2014.1080p.BluRay.x264-GRP.mkv", "standard")
	a.put(t, "Paddington (2014) uhd/Paddington.2014.2160p.BluRay.x265-GRP.mkv", "4k")

	plan := a.scan(t)
	hd := a.rowOf(t, "Paddington (2014)").Files[0]
	uhd := a.rowOf(t, "Paddington (2014) uhd").Files[0]
	if hd.Action != "fill" || hd.Profile != "hd-primary" || !hd.Ticked || uhd.Action != "create" || uhd.Slot != "4k" || !uhd.Ticked {
		t.Fatalf("hd = %+v, uhd = %+v", hd, uhd)
	}
	if got := a.rowOf(t, "Paddington (2014)").Match; got == nil || got.TitleID == nil || *got.TitleID != added.ID {
		t.Errorf("match = %+v, want the tracked Title %d", got, added.ID)
	}

	a.commit(t, plan.Revision)

	files := a.titleFiles(t, added.ID)
	if len(files) != 2 || files["standard"] == "" || files["4k"] == "" {
		t.Fatalf("files = %v", files)
	}
	d := decode[titleJSON](t, a.valid("GET", fmt.Sprintf("/titles/%d", added.ID), ""))
	var sawUHD bool
	for _, v := range d.Versions {
		if v.Slot == "4k" {
			sawUHD = v.State == "filled"
		}
	}
	if !sawUHD {
		t.Errorf("versions = %+v", d.Versions)
	}
	list := decode[struct {
		Items []rowJSON `json:"items"`
	}](t, a.valid("GET", "/titles?limit=10000", ""))
	if len(list.Items) != 1 {
		t.Errorf("%d Titles after adopting into a tracked one", len(list.Items))
	}
}

func TestAFileInATrackedFolderThatWouldReplaceTheHeldOneIsUntickedUntilTheAdminTicksIt(t *testing.T) {
	a := newAdopting(t)
	a.put(t, "Paddington.2014.1080p.BluRay.x264-GRP/Paddington.2014.1080p.BluRay.x264-GRP.mkv", "first")
	a.commit(t, a.scan(t).Revision)
	id := a.titleIDOf(t, 116149)
	held := a.titleFiles(t, id)["standard"]
	rival := a.put(t, "Paddington (2014) {tmdb-116149}/Paddington.2014.1080p.BluRay.x264-OTHER.mkv", "second")

	plan := a.scan(t)

	rows := a.rows(t, "replacement")
	if len(rows) != 1 || plan.Summary.Replacement != 1 {
		t.Fatalf("replacement rows = %+v, summary %+v", rows, plan.Summary)
	}
	f := rows[0].Files[0]
	if f.Path != rival || f.Action != "replace" || f.Ticked || f.HeldScore == nil {
		t.Fatalf("file = %+v", f)
	}
	if done := a.commit(t, plan.Revision); done.Result == nil || done.Result.Adopted != 0 || !exists(t, held) || !exists(t, rival) {
		t.Fatalf("an unticked replacement happened: %+v", done)
	}

	plan = a.scan(t)
	row := a.rows(t, "replacement")[0]
	if r := a.valid("PATCH", fmt.Sprintf("/adoption/rows/%d", row.ID), fmt.Sprintf(`{"files":[{"path":%q,"ticked":true}]}`, rival)); r.Status != 200 {
		t.Fatalf("tick = %d %s", r.Status, r.Body)
	}
	a.commit(t, decode[adoptionJSON](t, a.valid("GET", "/adoption", "")).Revision)

	now := a.titleFiles(t, id)["standard"]
	if now == held || filepath.Dir(now) != filepath.Dir(held) || !exists(t, now) || exists(t, held) || exists(t, rival) {
		t.Errorf("held %q -> %q; old still there %v, rival still there %v", held, now, exists(t, held), exists(t, rival))
	}
}
