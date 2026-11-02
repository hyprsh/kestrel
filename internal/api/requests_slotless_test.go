package api_test

import "testing"

const slotlessBody = `{"source":"plex","source_request_id":"w-1","requester":{"id":"u-1","name":"Anna"},"title":{"kind":"movie","tmdb_id":116149}}`

func TestARequestNamingNoSlotFillsTheSlotsOnForNewTitlesWithTheirDefaults(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	s.publish(t, goodRelease)
	s.publish(t, uhdRelease)
	if r := s.valid("PATCH", "/slots/4k", `{"on_for_new_titles":true,"default_movies":"4k-original"}`); r.Status != 200 {
		t.Fatalf("PATCH /slots/4k = %d %s", r.Status, r.Body)
	}

	r := s.valid("POST", "/requests", slotlessBody)

	if r.Status != 201 {
		t.Fatalf("POST /requests = %d %s", r.Status, r.Body)
	}
	req := decode[requestJSON](t, r)
	if len(req.Slots) != 2 {
		t.Fatalf("slots = %+v, want standard and 4k", req.Slots)
	}
	if _, _, profile, v := req.slot(t, "standard"); profile != "hd-primary" || v == 0 {
		t.Errorf("standard = %s version %d", profile, v)
	}
	if _, _, profile, v := req.slot(t, "4k"); profile != "4k-original" || v == 0 {
		t.Errorf("4k = %s version %d", profile, v)
	}
}

func TestARequestNamingNoSlotGetsOnlyStandardWhileOnlyStandardIsOnForNewTitles(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)

	req := decode[requestJSON](t, s.valid("POST", "/requests", slotlessBody))

	if len(req.Slots) != 1 || req.Slots[0].Slot != "standard" {
		t.Fatalf("slots = %+v, want standard only", req.Slots)
	}
}

func TestARequestNamingNoSlotReadsTheDefaultFromTheSlotRecord(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	if r := s.valid("PATCH", "/slots/standard", `{"default_movies":"any-primary"}`); r.Status != 200 {
		t.Fatalf("PATCH /slots/standard = %d %s", r.Status, r.Body)
	}

	req := decode[requestJSON](t, s.valid("POST", "/requests", slotlessBody))

	if _, _, profile, _ := req.slot(t, "standard"); profile != "any-primary" {
		t.Errorf("profile = %q, want the Slot's default", profile)
	}
}
