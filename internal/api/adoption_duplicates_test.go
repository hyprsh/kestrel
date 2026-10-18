package api_test

import (
	"os"
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

func TestADuplicateIsPromotedWhenItsRivalCannotBeAdopted(t *testing.T) {
	a := newAdopting(t)
	a.put(t, "Paddington (2014) a/Paddington.2014.1080p.BluRay.x264-GRP.mkv", "copy a")
	a.put(t, "Paddington (2014) b/Paddington.2014.720p.BluRay.x264-GRP.mkv", "copy b")
	first := a.scan(t)
	if first.Summary.Duplicate != 1 {
		t.Fatalf("summary = %+v", first.Summary)
	}
	entries := []string{"Paddington (2014) a", "Paddington (2014) b"}
	var winner, loser string
	var target string
	for _, e := range entries {
		if f := a.rowOf(t, e).Files[0]; f.Left == nil {
			winner, target = e, f.To
		} else {
			loser = e
		}
	}
	if r := a.valid("DELETE", "/adoption", ""); r.Status != 204 {
		t.Fatalf("discard = %d %s", r.Status, r.Body)
	}
	// Something that is not tracked sits where the winner would go.
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, []byte("in the way"), 0o644); err != nil {
		t.Fatal(err)
	}

	a.scan(t)

	w, l := a.rowOf(t, winner).Files[0], a.rowOf(t, loser).Files[0]
	if w.Left == nil || *w.Left != "path_occupied" || l.Left != nil {
		t.Fatalf("former winner left %v, former loser left %v; the loser should take over", w.Left, l.Left)
	}
}
