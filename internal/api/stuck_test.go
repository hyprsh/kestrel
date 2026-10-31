package api_test

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/jobs"
	downloadclient "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1"
)

type stuckJSON struct {
	Reason string    `json:"reason"`
	Since  time.Time `json:"since"`
}

func (s search) stuckItem(t *testing.T) *stuckJSON {
	t.Helper()
	r := s.valid("GET", "/queue", "")
	items := decode[struct {
		Items []struct {
			Stuck *stuckJSON `json:"stuck"`
		} `json:"items"`
	}](t, r).Items
	if len(items) != 1 {
		t.Fatalf("queue = %s, want one item", r.Body)
	}
	return items[0].Stuck
}

func (s search) stuckRows(t *testing.T) []attentionRowJSON {
	t.Helper()
	var out []attentionRowJSON
	for _, r := range s.attention(t).Rows {
		if r.Kind == "stuck_download" {
			out = append(out, r)
		}
	}
	return out
}

func TestAPausedDownloadIsStuckInTheQueueAndNeedsAttentionWithinOnePoll(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	s.publish(t, goodRelease)
	s.pass(t, jobs.Search)
	clientID := s.jobs(t)[0].ClientID
	_ = s.sab.SetPhase(clientID, downloadclient.PhaseDownloading, 250)
	s.pass(t, jobs.Poll)
	if s.stuckItem(t) != nil || len(s.stuckRows(t)) != 0 {
		t.Fatal("a moving download must not be stuck")
	}

	now := s.in.clock.Now()
	_ = s.sab.SetPhase(clientID, downloadclient.PhasePaused, 250)
	s.pass(t, jobs.Poll)

	st := s.stuckItem(t)
	if st == nil || st.Reason != "paused" || !st.Since.Equal(now) {
		t.Fatalf("stuck = %+v, want paused since %v", st, now)
	}
	rows := s.stuckRows(t)
	if len(rows) != 1 || rows[0].Severity != "warning" || !strings.HasPrefix(rows[0].ID, "stuck-") ||
		!strings.Contains(rows[0].Message, "Paused") || strings.Contains(strings.ToLower(rows[0].Message), "stalled") {
		t.Fatalf("rows = %+v, want one Warning that says paused and never stalled", rows)
	}
	if rows[0].Subject.GrabID == nil {
		t.Error("row has no Grab")
	}

	_ = s.sab.SetPhase(clientID, downloadclient.PhaseDownloading, 200)
	s.pass(t, jobs.Poll)
	if s.stuckItem(t) != nil || len(s.stuckRows(t)) != 0 {
		t.Error("the row must go once the download moves again")
	}
}

func TestADownloadWithNoProgressForAnHourIsStuckAndClearsWhenItGrows(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	s.publish(t, goodRelease)
	s.pass(t, jobs.Search)
	clientID := s.jobs(t)[0].ClientID
	_ = s.sab.SetPhase(clientID, downloadclient.PhaseDownloading, 250)
	s.pass(t, jobs.Poll)
	since := s.in.clock.Now()

	s.in.clock.Advance(acquire.StalledDownloadAfter - time.Minute)
	s.pass(t, jobs.Poll)
	if s.stuckItem(t) != nil {
		t.Fatal("stuck just under the threshold")
	}

	s.in.clock.Advance(2 * time.Minute)
	s.pass(t, jobs.Poll)
	st := s.stuckItem(t)
	if st == nil || st.Reason != "no_progress" || !st.Since.Equal(since) {
		t.Fatalf("stuck = %+v, want no_progress since %v", st, since)
	}
	rows := s.stuckRows(t)
	if len(rows) != 1 || !strings.Contains(rows[0].Message, "No progress for 1 h 1 min") {
		t.Fatalf("rows = %+v, want the wait spelled out", rows)
	}

	_ = s.sab.SetPhase(clientID, downloadclient.PhaseDownloading, 100)
	s.pass(t, jobs.Poll)
	if s.stuckItem(t) != nil || len(s.stuckRows(t)) != 0 {
		t.Error("stuck although the downloaded amount grew")
	}
}

func (s search) pausedGrab(t *testing.T) (grab int64) {
	t.Helper()
	s.publish(t, goodRelease)
	s.publish(t, "Paddington.2014.1080p.WEBDL.x264-OTHER")
	s.pass(t, jobs.Search)
	grab = s.queue(t)[0].GrabID
	for _, j := range s.jobs(t) {
		_ = s.sab.SetPhase(j.ClientID, downloadclient.PhasePaused, 250)
	}
	s.pass(t, jobs.Poll)
	return grab
}

func TestCancelOnAStuckRowCancelsTheGrabWithoutBlocklisting(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	s.pausedGrab(t)
	row := s.stuckRows(t)[0]
	cancel := row.action(t, "cancel")

	r := s.valid(cancel.Method, cancel.Path, bodyOf(cancel.Body))

	if r.Status != 204 {
		t.Fatalf("cancel = %d %s", r.Status, r.Body)
	}
	if got := s.stuckRowsFor(t, *row.Subject.GrabID); got != 0 {
		t.Error("the row must go once the Grab is cancelled")
	}
	s.pass(t, jobs.Search)
	for _, it := range s.queue(t) {
		if it.GrabID == *row.Subject.GrabID {
			t.Errorf("the Grab is still queued: %+v", it)
		}
	}
}

func TestSearchAgainOnAStuckRowBlocklistsTheReleaseCancelsTheJobAndSearchesTheVersion(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	s.publish(t, goodRelease)
	s.publish(t, "Paddington.2014.1080p.WEBDL.x264-OTHER")
	s.pass(t, jobs.Search)
	first := s.queue(t)[0]
	for _, j := range s.jobs(t) {
		_ = s.sab.SetPhase(j.ClientID, downloadclient.PhasePaused, 250)
	}
	s.pass(t, jobs.Poll)
	row := s.stuckRows(t)[0]
	again := row.action(t, "search_again")

	r := s.valid(again.Method, again.Path, bodyOf(again.Body))

	if r.Status != 204 {
		t.Fatalf("search again = %d %s", r.Status, r.Body)
	}
	blocked := s.releases(t, s.hd).find(t, first.ReleaseName)
	if len(blocked.Rejections) != 1 || blocked.Rejections[0].Code != "blocklisted" {
		t.Errorf("rejections = %+v, want blocklisted", blocked.Rejections)
	}
	s.pass(t, jobs.Search)
	q := s.queue(t)
	if len(q) != 1 || q[0].ReleaseName == first.ReleaseName {
		t.Errorf("queue = %+v, want the next best Release", q)
	}
	if got := fmt.Sprint(len(s.jobs(t))); got != "1" {
		t.Errorf("client jobs = %s, want only the new one", got)
	}
}

func bodyOf(b map[string]any) string {
	if b == nil {
		return ""
	}
	if v, ok := b["blocklist"].(bool); ok && v {
		return `{"blocklist":true}`
	}
	return ""
}

func (s search) stuckRowsFor(t *testing.T, grab int64) int {
	t.Helper()
	n := 0
	for _, r := range s.stuckRows(t) {
		if r.Subject.GrabID != nil && *r.Subject.GrabID == grab {
			n++
		}
	}
	return n
}
