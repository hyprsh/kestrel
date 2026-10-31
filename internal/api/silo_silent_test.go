package api_test

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

// A Silo Request that Silo stopped polling shows in Needs attention once Silo's whole retry span
// (6 hours) and the 10-minute submission lease have passed; the tests move the instance's fake clock.
const siloSpan = 6*time.Hour + 10*time.Minute

func (s *search) silentRow(t *testing.T) (attentionRowJSON, bool) {
	t.Helper()
	for _, r := range s.attention(t).Rows {
		if r.Kind == "silo_silent" {
			return r, true
		}
	}
	return attentionRowJSON{}, false
}

// siloRequest makes an open Silo Request, as Silo's Fulfill does.
func (s *search) siloRequest(t *testing.T, id string) requestJSON {
	t.Helper()
	r := s.valid("POST", "/requests", requestBody(id, "movie", 116149, `[{"slot":"standard"}]`, "null"))
	if r.Status != 201 {
		t.Fatalf("POST /requests = %d %s", r.Status, r.Body)
	}
	return decode[requestJSON](t, r)
}

// poll is what Silo's CheckStatus does: the bulk read of the Requests behind its Targets.
func (s *search) poll(t *testing.T, ids ...int64) {
	t.Helper()
	q := make([]string, len(ids))
	for i, id := range ids {
		q[i] = fmt.Sprintf("id=%d", id)
	}
	if r := s.valid("GET", "/requests?"+strings.Join(q, "&"), ""); r.Status != 200 {
		t.Fatalf("poll = %d %s", r.Status, r.Body)
	}
}

func TestASiloRequestSiloStoppedAskingAboutShowsOnceTheRetrySpanHasPassed(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	req := s.siloRequest(t, "r-1")

	s.in.clock.Advance(siloSpan - time.Minute)
	if _, ok := s.silentRow(t); ok {
		t.Fatal("flagged before the retry span has passed")
	}
	s.in.clock.Advance(2 * time.Minute)

	row, ok := s.silentRow(t)
	if !ok {
		t.Fatalf("no row after the retry span: %v", s.attention(t).kinds())
	}
	if row.Severity != "warning" || row.ID != fmt.Sprintf("silo-silent-%d", req.ID) || !strings.Contains(row.Message, "Silo stopped asking") {
		t.Errorf("row = %+v", row)
	}
	end := row.action(t, "end")
	if end.Method != "POST" || end.Path != fmt.Sprintf("/requests/%d/end", req.ID) || end.Confirm == nil {
		t.Errorf("end = %+v, want a POST behind a confirm", end)
	}
	if open := row.action(t, "open"); open.Method != "GET" || !strings.HasPrefix(open.Path, "/requests?q=") {
		t.Errorf("open = %+v", open)
	}
	row.action(t, "dismiss")
}

func TestASiloRequestSiloKeepsPollingNeverShows(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	req := s.siloRequest(t, "r-1")

	for range 5 {
		s.in.clock.Advance(3 * time.Hour)
		s.poll(t, req.ID)
		if _, ok := s.silentRow(t); ok {
			t.Fatal("a polled Request was flagged")
		}
	}
}

func TestARequestSiloPollsAgainAfterBeingFlaggedDropsOut(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	req := s.siloRequest(t, "r-1")
	s.in.clock.Advance(siloSpan + time.Minute)
	if _, ok := s.silentRow(t); !ok {
		t.Fatal("not flagged")
	}

	s.poll(t, req.ID)

	if _, ok := s.silentRow(t); ok {
		t.Error("still flagged after Silo asked again")
	}
}

func TestOnlySiloRequestsAreFlaggedAndOnlyWhileTheyAreOpen(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	other := strings.Replace(requestBody("r-2", "movie", 116149, `[{"slot":"standard"}]`, "null"), `"silo"`, `"jellyseerr"`, 1)
	if r := s.valid("POST", "/requests", other); r.Status != 201 {
		t.Fatalf("other source = %d %s", r.Status, r.Body)
	}
	rejected := s.valid("POST", "/requests", requestBody("r-3", "movie", 999999999, `[{"slot":"standard"}]`, "null"))
	if got := decode[requestJSON](t, rejected); got.Outcome != "rejected" {
		t.Fatalf("want a rejected Request, got %+v", got)
	}

	s.in.clock.Advance(24 * time.Hour)

	if _, ok := s.silentRow(t); ok {
		t.Errorf("rows = %v, want none for another source or a rejected Request", s.attention(t).kinds())
	}
}

func TestEndingTheRowEndsTheRequestLikeARejectedOneAndSaysWhyInTheLog(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	req := s.siloRequest(t, "r-1")
	s.in.clock.Advance(siloSpan + time.Minute)
	row, _ := s.silentRow(t)
	end := row.action(t, "end")

	if r := s.valid(end.Method, end.Path, ""); r.Status != 204 {
		t.Fatalf("end = %d %s", r.Status, r.Body)
	}

	got := decode[requestJSON](t, s.valid("GET", fmt.Sprintf("/requests/%d", req.ID), ""))
	if got.Outcome != "rejected" {
		t.Errorf("outcome = %s, want rejected", got.Outcome)
	}
	if _, ok := s.silentRow(t); ok {
		t.Error("the ended Request still shows")
	}
	var found bool
	for _, e := range s.events(t, "?kind=request_ended").Items {
		found = found || strings.Contains(e.Message, "Silo stopped asking")
	}
	if !found {
		t.Errorf("events = %+v, want the reason in the history", s.events(t, "?kind=request_ended").Items)
	}
	if r := s.valid("POST", end.Path, ""); r.Status != 409 {
		t.Errorf("ending an ended Request = %d, want 409", r.Status)
	}
	if r := s.valid("POST", "/requests/99999/end", ""); r.Status != 404 {
		t.Errorf("ending a missing Request = %d, want 404", r.Status)
	}
}

// Ending is not un-wanting: someone else may want the same Title, so its Versions stay Wanted.
func TestEndingTheRowKeepsTheTitleAndItsVersionsWanted(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	req := s.siloRequest(t, "r-1")
	s.in.clock.Advance(siloSpan + time.Minute)
	row, _ := s.silentRow(t)
	end := row.action(t, "end")

	if r := s.valid(end.Method, end.Path, ""); r.Status != 204 {
		t.Fatalf("end = %d %s", r.Status, r.Body)
	}

	if req.TitleID == nil {
		t.Fatal("the Request has no Title")
	}
	got := decode[struct {
		titleJSON
		Versions []versionJSON `json:"versions"`
	}](t, s.valid("GET", fmt.Sprintf("/titles/%d", *req.TitleID), ""))
	if !got.Monitored {
		t.Error("the Title is no longer monitored after End")
	}
	if len(got.Versions) == 0 {
		t.Fatal("the Title lost its Versions")
	}
	for _, v := range got.Versions {
		if v.State != "wanted" {
			t.Errorf("Version %d state = %s after End, want wanted", v.ID, v.State)
		}
	}
}

func TestDismissingTheRowKeepsTheRequestAndStaysGone(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	req := s.siloRequest(t, "r-1")
	s.in.clock.Advance(siloSpan + time.Minute)
	row, _ := s.silentRow(t)
	dismiss := row.action(t, "dismiss")

	if r := s.valid(dismiss.Method, dismiss.Path, ""); r.Status != 204 {
		t.Fatalf("dismiss = %d %s", r.Status, r.Body)
	}

	s.in.clock.Advance(48 * time.Hour)
	if _, ok := s.silentRow(t); ok {
		t.Error("a dismissed row came back")
	}
	if got := decode[requestJSON](t, s.valid("GET", fmt.Sprintf("/requests/%d", req.ID), "")); got.Outcome != "accepted" {
		t.Errorf("outcome = %s, want the Request kept", got.Outcome)
	}
	if r := s.valid("POST", "/attention/silo-silent-99999/dismiss", ""); r.Status != 404 {
		t.Errorf("dismissing an unknown row = %d, want 404", r.Status)
	}
}

func TestADismissedRequestSiloAsksAboutAgainIsFlaggedAgainWhenItGoesQuiet(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	req := s.siloRequest(t, "r-1")
	s.in.clock.Advance(siloSpan + time.Minute)
	row, _ := s.silentRow(t)
	s.valid("POST", row.action(t, "dismiss").Path, "")

	s.poll(t, req.ID)
	s.in.clock.Advance(siloSpan + time.Minute)

	if _, ok := s.silentRow(t); !ok {
		t.Error("a new silence was not flagged")
	}
}

func TestARequestWithNoStampYetFallsBackToItsCreationTime(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	req := s.siloRequest(t, "r-1")
	if _, err := s.in.st.Write().Exec(`UPDATE requests SET last_asked_at = NULL WHERE id = ?`, req.ID); err != nil {
		t.Fatal(err)
	}

	s.in.clock.Advance(siloSpan - time.Minute)
	if _, ok := s.silentRow(t); ok {
		t.Fatal("flagged before the span ran from its creation")
	}
	s.in.clock.Advance(2 * time.Minute)
	if _, ok := s.silentRow(t); !ok {
		t.Error("an unstamped Request was not flagged once its creation was older than the span")
	}
}
