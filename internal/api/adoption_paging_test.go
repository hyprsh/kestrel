package api_test

import (
	"fmt"
	"testing"
)

type adoptionPageJSON struct {
	Items      []adoptionRowJSON `json:"items"`
	NextCursor *string           `json:"next_cursor"`
	Total      int               `json:"total"`
	Counts     struct {
		Matched     int `json:"matched"`
		NeedsChoice int `json:"needs_choice"`
		Skipped     int `json:"skipped"`
		Duplicate   int `json:"duplicate"`
		Replacement int `json:"replacement"`
		Adopting    int `json:"adopting"`
	} `json:"counts"`
}

func (a adopting) page(t *testing.T, query string) adoptionPageJSON {
	t.Helper()
	return decode[adoptionPageJSON](t, a.valid("GET", "/adoption/rows?"+query, ""))
}

// planOfRows scans a plan with one Matched row, one Skipped row and needChoice
// Needs choice rows nothing matches.
func (a adopting) planOfRows(t *testing.T, needChoice int) adoptionJSON {
	t.Helper()
	a.put(t, "Paddington.2014.1080p.BluRay.x264-GRP/Paddington.2014.1080p.BluRay.x264-GRP.mkv", "pad")
	a.put(t, "Broken Thing (2001)/broken.mkv", "x")
	for i := 1; i <= needChoice; i++ {
		a.put(t, fmt.Sprintf("Unknown Thing %d/thing.mkv", i), "nobody knows")
	}
	return a.scan(t)
}

func TestRowsComeInPagesWithTheFilterTotalAndTheCountsOfThePlan(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	a.planOfRows(t, 5)

	first := a.page(t, "limit=3")
	second := a.page(t, "limit=3&cursor="+*first.NextCursor)
	third := a.page(t, "limit=3&cursor="+*second.NextCursor)

	if len(first.Items) != 3 || len(second.Items) != 3 || len(third.Items) != 1 || third.NextCursor != nil {
		t.Fatalf("pages = %d, %d, %d rows; last cursor %v", len(first.Items), len(second.Items), len(third.Items), third.NextCursor)
	}
	seen := map[int64]bool{}
	for _, p := range []adoptionPageJSON{first, second, third} {
		for _, r := range p.Items {
			if seen[r.ID] {
				t.Errorf("row %d is on two pages", r.ID)
			}
			seen[r.ID] = true
		}
		if p.Total != 7 || p.Counts.Matched != 1 || p.Counts.NeedsChoice != 5 || p.Counts.Skipped != 1 || p.Counts.Adopting != 1 {
			t.Errorf("total %d, counts %+v", p.Total, p.Counts)
		}
	}
	if first.Items[0].Status != "matched" || third.Items[0].Status != "skipped" {
		t.Errorf("rows are grouped Matched, Needs choice, Skipped: %q first, %q last", first.Items[0].Status, third.Items[0].Status)
	}
}

func TestAFilteredPageTotalsTheFilterButCountsTheWholePlan(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	a.planOfRows(t, 5)

	p := a.page(t, "filter=needs_choice&limit=2")

	if p.Total != 5 || len(p.Items) != 2 || p.NextCursor == nil || p.Counts.Matched != 1 || p.Counts.NeedsChoice != 5 {
		t.Errorf("page = total %d, %d items, counts %+v", p.Total, len(p.Items), p.Counts)
	}
	for _, r := range p.Items {
		if r.Status != "needs_choice" {
			t.Errorf("row = %+v", r)
		}
	}
}

func TestWithoutALimitEveryRowComesSoAClientThatIgnoresPagingLosesNoneAndABadLimitOrCursorIsRefused(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	a.planOfRows(t, 120)

	if p := a.page(t, ""); len(p.Items) != 122 || p.NextCursor != nil || p.Total != 122 {
		t.Errorf("page without a limit = %d items, cursor %v, total %d; want every row", len(p.Items), p.NextCursor, p.Total)
	}
	if p := a.page(t, "limit=100"); len(p.Items) != 100 || p.NextCursor == nil {
		t.Errorf("page = %d items, cursor %v", len(p.Items), p.NextCursor)
	}
	for _, q := range []string{"limit=0", "limit=100001", "cursor=nonsense"} {
		if r := a.do("GET", "/adoption/rows?"+q, ""); r.Status != 422 {
			t.Errorf("%s = %d %s", q, r.Status, r.Body)
		}
	}
}
