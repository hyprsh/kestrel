package api_test

import (
	"fmt"
	"testing"
)

type upcomingStateJSON struct {
	Items []struct {
		ReleaseType string `json:"release_type"`
		Overview    string `json:"overview"`
		Searchable  bool   `json:"searchable"`
		HasPoster   bool   `json:"has_poster"`
		Network     string `json:"network"`
		Dates       []struct {
			ReleaseType string `json:"release_type"`
			Date        string `json:"date"`
		} `json:"dates"`
		Slots []struct {
			Slot    string  `json:"slot"`
			State   string  `json:"state"`
			Quality *string `json:"quality"`
		} `json:"slots"`
	} `json:"items"`
	Undated []struct {
		TitleID int64  `json:"title_id"`
		Reason  string `json:"reason"`
		Slots   []struct {
			State string `json:"state"`
		} `json:"slots"`
	} `json:"undated"`
}

// An entry says where each Version stands, with the quality of an imported file, and the
// Titles with nothing dated come back in `undated` whatever the window.
func TestUpcomingSaysWhereEachVersionStandsAndListsTheUndated(t *testing.T) {
	t.Parallel()
	w := newWantedRig(t)
	movie := decode[titleJSON](t, w.valid("POST", "/titles", fmt.Sprintf(addHD, 116149)))
	other := decode[titleJSON](t, w.valid("POST", "/titles", fmt.Sprintf(addHD, 77)))
	w.setDates(t, movie.ID, map[int]string{4: "2026-10-12T00:00:00Z", 5: "2026-12-12T00:00:00Z"}) // digital out, physical to come
	w.setDates(t, other.ID, map[int]string{})                                                     // no date anywhere
	w.exec(t, `UPDATE titles SET network = 'AMC', overview = 'A bear.' WHERE id = ?`, movie.ID)
	w.exec(t, `INSERT INTO files (version_id, path, size, release_name, parsed_release, imported_at) SELECT id, 'x.mkv', 1, 'x', ?, '2026-10-13T00:00:00Z' FROM versions WHERE title_id = ?`,
		`{"quality":{"quality":{"name":"WEBDL-1080p"}}}`, movie.ID)

	got := decode[upcomingStateJSON](t, w.valid("GET", "/upcoming?from=2026-10-01&to=2026-10-31", ""))
	if len(got.Items) != 1 {
		t.Fatalf("items = %+v, want the past digital date of the filled Movie", got.Items)
	}
	it := got.Items[0]
	if it.ReleaseType != "digital" || !it.Searchable || len(it.Dates) != 2 || it.Overview != "A bear." || it.Network != "AMC" {
		t.Errorf("item = %+v", it)
	}
	if len(it.Slots) != 1 || it.Slots[0].Slot != "standard" || it.Slots[0].State != "imported" || it.Slots[0].Quality == nil || *it.Slots[0].Quality != "WEBDL-1080p" {
		t.Errorf("slots = %+v, want Standard imported as WEBDL-1080p", it.Slots)
	}
	if len(got.Undated) != 1 || got.Undated[0].TitleID != other.ID || got.Undated[0].Reason != "no_release_date" || got.Undated[0].Slots[0].State != "not_out" {
		t.Errorf("undated = %+v, want the Movie with no release date, not out until a Release is seen", got.Undated)
	}
}
