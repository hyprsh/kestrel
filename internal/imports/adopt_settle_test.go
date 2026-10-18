package imports

import (
	"testing"

	"github.com/hyprsh/kestrel/internal/resolution"
)

func rowWith(tmdb int, files ...PlanFile) Row {
	return Row{Status: Matched, Ticked: true, Match: &Match{TMDBID: tmdb}, Files: files}
}

func file(path string, score int, size int64) PlanFile {
	return PlanFile{Path: path, Slot: resolution.HD, Score: score, Size: size, Ticked: true}
}

func TestDuplicatesOfOneSlotGoToTheHigherScoreThenTheLargerFile(t *testing.T) {
	rows := []Row{
		rowWith(1, file("big-low", 10, 9<<30)),
		rowWith(1, file("small-high", 50, 1<<30), file("mid-high", 50, 2<<30)),
		rowWith(2, file("other-movie", 0, 1)),
	}

	settle(rows)

	left := map[string]string{}
	for _, r := range rows {
		for _, f := range r.Files {
			left[f.Path] = f.Left
		}
	}
	want := map[string]string{"big-low": LeftDuplicate, "small-high": LeftDuplicate, "mid-high": "", "other-movie": ""}
	for p, w := range want {
		if left[p] != w {
			t.Errorf("%s left = %q, want %q", p, left[p], w)
		}
	}
}

func TestSettlingAgainPromotesADuplicateWhenItsRivalLeavesTheRace(t *testing.T) {
	rows := []Row{rowWith(1, file("a", 5, 1)), rowWith(1, file("b", 9, 1))}
	settle(rows)
	rows[1].Files[0].Left = LeftPathOccupied // b can no longer be adopted

	settle(rows)

	if rows[0].Files[0].Left != "" {
		t.Errorf("a = %q, want it promoted", rows[0].Files[0].Left)
	}
}
