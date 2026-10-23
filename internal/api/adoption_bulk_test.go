package api_test

import (
	"fmt"
	"strings"
	"testing"
)

type adoptionBulkJSON struct {
	Revision int64 `json:"revision"`
	Items    []struct {
		RowID      int64   `json:"row_id"`
		Result     string  `json:"result"`
		Reason     *string `json:"reason"`
		Status     *string `json:"status"`
		SkipReason *string `json:"skip_reason"`
	} `json:"items"`
}

// outcomes maps a row id to "result" or "result:reason".
func (b adoptionBulkJSON) outcomes() map[int64]string {
	out := map[int64]string{}
	for _, it := range b.Items {
		out[it.RowID] = it.Result
		if it.Reason != nil {
			out[it.RowID] += ":" + *it.Reason
		}
	}
	return out
}

func (a adopting) bulk(t *testing.T, body string) adoptionBulkJSON {
	t.Helper()
	r := a.valid("POST", "/adoption/rows/bulk", body)
	if r.Status != 200 {
		t.Fatalf("bulk %s = %d %s", body, r.Status, r.Body)
	}
	return decode[adoptionBulkJSON](t, r)
}

func rowIDs(rows ...adoptionRowJSON) string {
	var s []string
	for _, r := range rows {
		s = append(s, fmt.Sprint(r.ID))
	}
	return "[" + strings.Join(s, ",") + "]"
}

func TestUntickingAndTickingASelectionMovesTheRevisionOnceAndSaysWhatHappenedToEachRow(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	a.put(t, "The Lost Film (2020) [tmdbid-77]/lost.film.mkv", "lost")
	a.put(t, "Paddington.2014.1080p.BluRay.x264-GRP/Paddington.2014.1080p.BluRay.x264-GRP.mkv", "pad")
	a.put(t, "Unknown Thing/thing.mkv", "x")
	plan := a.scan(t)
	lost, pad, unknown := a.rowOf(t, "The Lost Film (2020) [tmdbid-77]"), a.rowOf(t, "Paddington.2014.1080p.BluRay.x264-GRP"), a.rowOf(t, "Unknown Thing")

	got := a.bulk(t, fmt.Sprintf(`{"action":"untick","row_ids":[%d,%d,%d,999]}`, lost.ID, pad.ID, unknown.ID))

	want := map[int64]string{lost.ID: "changed", pad.ID: "changed", unknown.ID: "left:not_matched", 999: "left:no_such_row"}
	if fmt.Sprint(got.outcomes()) != fmt.Sprint(want) || got.Revision != plan.Revision+1 {
		t.Fatalf("untick = %+v (revision %d -> %d), want %v", got, plan.Revision, got.Revision, want)
	}
	now := decode[adoptionJSON](t, a.valid("GET", "/adoption", ""))
	if now.Revision != got.Revision || a.page(t, "limit=1").Counts.Adopting != 0 {
		t.Errorf("after unticking: revision %d, plan %+v", now.Revision, now)
	}

	again := a.bulk(t, fmt.Sprintf(`{"action":"untick","row_ids":%s}`, rowIDs(lost)))
	if again.outcomes()[lost.ID] != "left:already" || again.Revision != got.Revision {
		t.Errorf("unticking an unticked row = %+v", again)
	}
	a.bulk(t, fmt.Sprintf(`{"action":"tick","row_ids":%s}`, rowIDs(lost, pad)))
	if a.page(t, "limit=1").Counts.Adopting != 2 {
		t.Errorf("ticking left %+v", a.page(t, "limit=1").Counts)
	}
}

func TestUntickingEveryRowOfAFilterNeedsNoIds(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	a.put(t, "The Lost Film (2020) [tmdbid-77]/lost.film.mkv", "lost")
	a.put(t, "Paddington.2014.1080p.BluRay.x264-GRP/Paddington.2014.1080p.BluRay.x264-GRP.mkv", "pad")
	a.put(t, "Unknown Thing/thing.mkv", "x")
	a.scan(t)

	got := a.bulk(t, `{"action":"untick","filter":"matched"}`)

	if len(got.Items) != 2 || a.page(t, "limit=1").Counts.Adopting != 0 {
		t.Errorf("untick of the filter = %+v", got)
	}

	every := a.bulk(t, `{"action":"tick","filter":"all"}`)

	if len(every.Items) != 3 || a.page(t, "limit=1").Counts.Adopting != 2 {
		t.Errorf("tick of every row = %+v", every)
	}
}

func TestAcceptingSuggestionsSettlesOnlyTheConfidentRowsAndSaysWhyTheOthersWereLeft(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	a.put(t, "Paddington (2014)/paddington.short.mkv", "short but right")
	a.put(t, "Dune (2020)/dune.mkv", "confident, but the fake TMDB has no such Movie")
	a.put(t, "Dune/dune.mkv", "not confident")
	a.put(t, "Unknown Thing/thing.mkv", "no candidates")
	a.put(t, "The Lost Film (2020) [tmdbid-77]/lost.film.mkv", "already matched")
	plan := a.scan(t)
	pad, duneYear, dune, unknown, lost := a.rowOf(t, "Paddington (2014)"), a.rowOf(t, "Dune (2020)"), a.rowOf(t, "Dune"), a.rowOf(t, "Unknown Thing"), a.rowOf(t, "The Lost Film (2020) [tmdbid-77]")

	got := a.bulk(t, `{"action":"accept_suggested","filter":"needs_choice"}`)
	byRow := got.outcomes()
	if len(got.Items) != 4 || byRow[pad.ID] != "changed" || byRow[duneYear.ID] != "left:not_settleable" || byRow[dune.ID] != "left:not_confident" || byRow[unknown.ID] != "left:no_suggestion" {
		t.Fatalf("accept over the filter = %v", byRow)
	}
	if got.Revision != plan.Revision+1 {
		t.Errorf("revision %d -> %d, want one bump", plan.Revision, got.Revision)
	}
	for _, it := range got.Items {
		if it.RowID == pad.ID && (it.Status == nil || *it.Status != "matched") {
			t.Errorf("the accepted row = %+v", it)
		}
	}
	settled := a.rowOf(t, "Paddington (2014)")
	if settled.Status != "matched" || settled.Match == nil || settled.Match.TMDBID != 116149 || settled.Match.Source != "chosen" || !settled.Ticked {
		t.Errorf("settled = %+v", settled)
	}
	if left := a.rowOf(t, "Dune (2020)"); left.Status != "needs_choice" {
		t.Errorf("a row that could not be settled changed: %+v", left)
	}

	byIDs := a.bulk(t, fmt.Sprintf(`{"action":"accept_suggested","row_ids":%s}`, rowIDs(lost)))
	if byIDs.outcomes()[lost.ID] != "left:not_needs_choice" || byIDs.Revision != got.Revision {
		t.Errorf("accepting a Matched row = %+v", byIDs)
	}
	a.commit(t, got.Revision)
	if files := a.titleFiles(t, a.titleIDOf(t, 116149)); files["standard"] == "" {
		t.Errorf("the accepted row was not adopted: %v", files)
	}
}

func TestAcceptingASuggestionThatPlansToSkippedStoresTheRowSkippedWithItsReason(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	a.put(t, "Paddington (2014)/paddington.uhd.short.mkv", "x")
	a.put(t, "Paddington/pad.uhd.mkv", "chosen by hand")
	a.scan(t)
	// The Standard Slot always keeps a default, so the 4K files lose their Profiles.
	for _, key := range []string{"4k-primary", "4k-original"} {
		if r := a.valid("PATCH", "/profiles/"+key, `{"enabled":false}`); r.Status != 200 {
			t.Fatalf("disable %s = %d %s", key, r.Status, r.Body)
		}
	}
	pad, hand := a.rowOf(t, "Paddington (2014)"), a.rowOf(t, "Paddington")

	got := a.bulk(t, fmt.Sprintf(`{"action":"accept_suggested","row_ids":%s}`, rowIDs(pad)))

	if it := got.Items[0]; it.Result != "changed" || it.Status == nil || *it.Status != "skipped" || it.SkipReason == nil || *it.SkipReason != "no_enabled_profile" {
		t.Errorf("accept = %+v", it)
	}
	if row := a.rowOf(t, "Paddington (2014)"); row.Status != "skipped" || row.SkipReason == nil || *row.SkipReason != "no_enabled_profile" {
		t.Errorf("stored row = %+v", row)
	}
	r := a.valid("PATCH", fmt.Sprintf("/adoption/rows/%d", hand.ID), `{"tmdb_id":116149}`)
	if row := decode[adoptionRowJSON](t, r); r.Status != 200 || row.Status != "skipped" || row.SkipReason == nil || *row.SkipReason != "no_enabled_profile" {
		t.Errorf("choosing by hand = %d %s", r.Status, r.Body)
	}
}

func TestABulkCallNamesOneActionAndEitherRowsOrAFilter(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	a.put(t, "Paddington.2014.1080p.BluRay.x264-GRP/Paddington.2014.1080p.BluRay.x264-GRP.mkv", "pad")
	a.scan(t)

	for _, body := range []string{
		`{}`,
		`{"action":"explode","row_ids":[1]}`,
		`{"action":"tick"}`,
		`{"action":"tick","row_ids":[]}`,
		`{"action":"tick","row_ids":[1],"filter":"matched"}`,
		`{"action":"tick","filter":"nonsense"}`,
	} {
		if r := a.do("POST", "/adoption/rows/bulk", body); r.Status != 422 {
			t.Errorf("%s = %d %s", body, r.Status, r.Body)
		}
	}
}

func TestABulkEditOfAPlanThatIsNotWaitingIsRefused(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)

	if r := a.do("POST", "/adoption/rows/bulk", `{"action":"tick","row_ids":[1]}`); r.Status != 404 {
		t.Errorf("bulk with no plan = %d %s", r.Status, r.Body)
	}
}
