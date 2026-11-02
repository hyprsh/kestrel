package api_test

import (
	"fmt"
	"testing"

	"github.com/hyprsh/kestrel/internal/metadata/metadatatest"
)

func TestEpisodeCellsHaveAKeyForEverySlotIncludingAdminDefinedOnes(t *testing.T) {
	t.Parallel()
	l := newLibraryInstance(t, metadatatest.Key)
	if r := l.valid("POST", "/slots", `{"label":"Archive"}`); r.Status != 201 {
		t.Fatalf("POST /slots = %d %s", r.Status, r.Body)
	}
	created := decode[seriesTitleJSON](t, l.valid("POST", "/titles", addBreakingBad+`}`))
	eps := decode[struct {
		Items []struct {
			Cells map[string]*cellJSON `json:"cells"`
		} `json:"items"`
	}](t, l.valid("GET", fmt.Sprintf("/titles/%d/episodes", created.ID), "")).Items
	cells := eps[0].Cells
	if len(cells) != 3 || cells["standard"] == nil {
		t.Fatalf("cells = %+v, want standard filled in and 4k and archive present as null", cells)
	}
	for _, k := range []string{"4k", "archive"} {
		if v, ok := cells[k]; !ok || v != nil {
			t.Errorf("cells[%q] = %v, %v, want a null cell", k, v, ok)
		}
	}
}
