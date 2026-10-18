package api_test

import (
	"path/filepath"
	"testing"
)

func TestTwoFilesForOneSlotGoToTheHigherScoreThenTheLargerAndTheRestAreLeftUntouched(t *testing.T) {
	a := newAdopting(t)
	name := "Paddington.2014.1080p.BluRay.x264-GRP.mkv"
	big := a.put(t, "Paddington (2014)/"+name, "big copy")
	small := a.put(t, "Paddington (2014) small/"+name, "small copy")

	plan := a.scan(t)

	if plan.Summary.Matched != 2 || plan.Summary.Duplicate != 1 {
		t.Fatalf("summary = %+v", plan.Summary)
	}
	dups := a.rows(t, "duplicate")
	if len(dups) != 1 || filepath.Dir(dups[0].Files[0].Path) != filepath.Dir(small) {
		t.Fatalf("duplicate rows = %+v", dups)
	}
	if got := dups[0].Files[0]; got.Left == nil || *got.Left != "duplicate" {
		t.Errorf("loser = %+v", got)
	}
	winner := a.rowOf(t, "Paddington (2014)").Files[0]
	if winner.Left != nil || winner.Score < dups[0].Files[0].Score {
		t.Errorf("winner = %+v, loser score %d", winner, dups[0].Files[0].Score)
	}

	a.commit(t, plan.Revision)

	files := a.titleFiles(t, a.titleIDOf(t, 116149))
	if filepath.Dir(files["hd"]) != filepath.Join(a.movies, "Paddington (2014) {tmdb-116149}") || exists(t, big) {
		t.Errorf("winner not adopted: %v", files)
	}
	if !exists(t, small) {
		t.Error("the duplicate was moved or deleted")
	}
}
