package api_test

import (
	"fmt"
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
