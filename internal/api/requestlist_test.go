package api_test

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

// listedJSON is a Request as the Overview and the Requests screen read it.
type listedJSON struct {
	ID        int64   `json:"id"`
	Title     *string `json:"title"`
	HasPoster bool    `json:"has_poster"`
	TitleID   *int64  `json:"title_id"`
	Outcome   string  `json:"outcome"`
}

type listedPage struct {
	Items      []listedJSON `json:"items"`
	NextCursor *string      `json:"next_cursor"`
	Total      int          `json:"total"`
}

func TestListedRequestsNameTheirTitleEvenWhenRejectedBeforeOneExisted(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	accepted := decode[requestJSON](t, s.valid("POST", "/requests", requestBody("r-1", "movie", 116149, `[{"slot":"standard"}]`, "null")))
	for _, k := range []string{"4k-primary", "4k-original"} {
		s.valid("PATCH", "/profiles/"+k, `{"enabled":false}`)
	}
	if r := s.valid("DELETE", fmt.Sprintf("/titles/%d", *accepted.TitleID), ""); r.Status != 204 {
		t.Fatalf("delete = %d %s", r.Status, r.Body)
	}
	rejected := decode[requestJSON](t, s.valid("POST", "/requests", requestBody("r-2", "movie", 116149, `[{"slot":"4k"}]`, "null")))
	unknown := decode[requestJSON](t, s.valid("POST", "/requests", requestBody("r-3", "movie", 999999999, `[{"slot":"standard"}]`, "null")))

	list := decode[listedPage](t, s.valid("GET", "/requests", "")).Items

	if len(list) != 3 || list[0].ID != unknown.ID || list[1].ID != rejected.ID || list[2].ID != accepted.ID {
		t.Fatalf("list = %+v, want newest first", list)
	}
	if list[0].Title != nil {
		t.Errorf("unknown title = %q, want null: Kestrel never learnt a name", *list[0].Title)
	}
	for _, r := range list[1:] {
		if r.Title == nil || *r.Title != "Paddington" || r.HasPoster {
			t.Errorf("request %d = %+v, want the asked-for name and no poster (no Title in the Library)", r.ID, r)
		}
	}
}

func TestAListedRequestForATitleInTheLibraryHasItsPoster(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	s.valid("POST", "/requests", requestBody("r-1", "movie", 116149, `[{"slot":"standard"}]`, "null"))

	list := decode[listedPage](t, s.valid("GET", "/requests", "")).Items

	if len(list) != 1 || list[0].Title == nil || *list[0].Title != "Paddington" || !list[0].HasPoster {
		t.Errorf("list = %+v, want Paddington with its poster", list)
	}
}

func askedBy(sourceID, source, requester string, tmdb int, slot string) string {
	return fmt.Sprintf(`{"source":%q,"source_request_id":%q,"requester":{"id":"u-%s","name":%q},"title":{"kind":"movie","tmdb_id":%d},"slots":[{"slot":%q}]}`,
		source, sourceID, strings.ToLower(requester), requester, tmdb, slot)
}

// ids lists a page's Request ids, in order.
func (p listedPage) ids() []int64 {
	out := []int64{}
	for _, r := range p.Items {
		out = append(out, r.ID)
	}
	return out
}

// fill gives a Version a file, which completes the Requests for it.
func (s search) fill(t *testing.T, version int64) {
	t.Helper()
	if _, err := s.in.st.Write().Exec(`INSERT INTO files (version_id, path, size, release_name, imported_at) VALUES (?, '/x.mkv', 1, 'x', '2026-10-17T12:00:00Z')`, version); err != nil {
		t.Fatal(err)
	}
}

func TestRequestsFilterByStatusOutcomeRequesterAndSource(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	hd := decode[requestJSON](t, s.valid("POST", "/requests", askedBy("r-1", "silo", "Anna", 116149, "standard")))
	uhd := decode[requestJSON](t, s.valid("POST", "/requests", askedBy("r-2", "jellyseerr", "Ben", 116149, "4k")))
	unknown := decode[requestJSON](t, s.valid("POST", "/requests", askedBy("r-3", "silo", "Ben", 999999999, "standard")))
	_, _, _, version := hd.slot(t, "standard")
	s.fill(t, version)

	for query, want := range map[string][]int64{
		"":                                {unknown.ID, uhd.ID, hd.ID},
		"status=open":                     {uhd.ID},
		"status=completed":                {hd.ID},
		"status=rejected":                 {unknown.ID},
		"status=open&status=rejected":     {unknown.ID, uhd.ID},
		"outcome=accepted":                {uhd.ID, hd.ID},
		"outcome=rejected":                {unknown.ID},
		"requester=ben":                   {unknown.ID, uhd.ID},
		"requester=u-anna":                {hd.ID},
		"source=jellyseerr":               {uhd.ID},
		"source=silo&source=jellyseerr":   {unknown.ID, uhd.ID, hd.ID},
		"requester=Ben&status=open":       {uhd.ID},
		"outcome=rejected&status=open":    {},
		"requester=Ben&source=jellyseerr": {uhd.ID},
	} {
		page := decode[listedPage](t, s.valid("GET", "/requests?"+query, ""))
		if got := page.ids(); !slices.Equal(got, want) || page.Total != len(want) {
			t.Errorf("?%s = %v (total %d), want %v", query, got, page.Total, want)
		}
	}
	for _, query := range []string{"status=pending", "outcome=maybe"} {
		if r := s.valid("GET", "/requests?"+query, ""); r.Status != 422 {
			t.Errorf("?%s = %d, want 422", query, r.Status)
		}
	}
}

func TestAStatusFilterPagesThroughTheMatchingRequestsOnly(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	done := decode[requestJSON](t, s.valid("POST", "/requests", askedBy("r-1", "silo", "Anna", 116149, "standard")))
	var open []int64
	for i := range 3 {
		r := decode[requestJSON](t, s.valid("POST", "/requests", askedBy(fmt.Sprintf("o-%d", i), "silo", "Anna", 116149, "4k")))
		open = append([]int64{r.ID}, open...)
	}
	_, _, _, version := done.slot(t, "standard")
	s.fill(t, version)

	first := decode[listedPage](t, s.valid("GET", "/requests?status=open&limit=2", ""))
	if !slices.Equal(first.ids(), open[:2]) || first.NextCursor == nil || first.Total != 3 {
		t.Fatalf("first page = %v cursor %v total %d, want %v and a cursor", first.ids(), first.NextCursor, first.Total, open[:2])
	}
	next := decode[listedPage](t, s.valid("GET", "/requests?status=open&limit=2&cursor="+*first.NextCursor, ""))
	if !slices.Equal(next.ids(), open[2:]) || next.NextCursor != nil || next.Total != 3 {
		t.Errorf("next page = %v cursor %v total %d, want %v and no cursor", next.ids(), next.NextCursor, next.Total, open[2:])
	}
}
