package api_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/jobs"
	downloadclient "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1"
)

type queueItemJSON struct {
	GrabID      int64    `json:"grab_id"`
	TitleID     *int64   `json:"title_id"`
	VersionID   *int64   `json:"version_id"`
	Title       string   `json:"title"`
	Year        *int     `json:"year"`
	Slot        *string  `json:"slot"`
	Episodes    []string `json:"episodes"`
	ReleaseName string   `json:"release_name"`
	Phase       string   `json:"phase"`
	BytesTotal  int64    `json:"bytes_total"`
	BytesLeft   int64    `json:"bytes_left"`
	ETA         *int     `json:"eta"`
	IsUpgrade   bool     `json:"is_upgrade"`
	ScoreDelta  *int     `json:"score_delta"`
}

func (s search) pass(t *testing.T, loop string) {
	t.Helper()
	if err := s.in.app.Jobs.Pass(context.Background(), loop); err != nil {
		t.Fatalf("%s pass: %v", loop, err)
	}
}

func (s search) queue(t *testing.T) []queueItemJSON {
	t.Helper()
	r := s.valid("GET", "/queue", "")
	if r.Status != 200 {
		t.Fatalf("GET /queue = %d %s", r.Status, r.Body)
	}
	return decode[struct {
		Items []queueItemJSON `json:"items"`
	}](t, r).Items
}

func (s search) jobs(t *testing.T) []downloadclient.Item {
	t.Helper()
	items, err := s.sab.List(context.Background(), s.sab.Conn(0), "")
	if err != nil {
		t.Fatal(err)
	}
	return items
}

func (s search) grabState(t *testing.T, id int64) string {
	t.Helper()
	return decode[grabJSON](t, s.valid("GET", fmt.Sprintf("/grabs/%d", id), "")).State
}

func TestAddingAMovieGrabsTheBestReleaseAndFollowsItToCompleted(t *testing.T) {
	s := newSearch(t)
	s.publish(t, goodRelease)
	s.publish(t, uhdRelease)

	s.pass(t, jobs.Search)

	q := s.queue(t)
	if len(q) != 2 {
		t.Fatalf("queue = %+v, want one Grab per Version", q)
	}
	var hd queueItemJSON
	for _, it := range q {
		if it.VersionID != nil && *it.VersionID == s.hd {
			hd = it
		}
	}
	if hd.ReleaseName != goodRelease || hd.Phase != "queued" || hd.Title != "Paddington" || hd.Slot == nil || *hd.Slot != "hd" ||
		hd.IsUpgrade || hd.ScoreDelta != nil || hd.Year == nil || *hd.Year != 2014 || len(hd.Episodes) != 0 {
		t.Errorf("HD queue item = %+v", hd)
	}
	if got := s.grabState(t, hd.GrabID); got != "sent" {
		t.Errorf("state = %s, want sent", got)
	}

	jobList := s.jobs(t)
	var id string
	for _, j := range jobList {
		if j.Name == goodRelease {
			id = j.ClientID
		}
	}
	if err := s.sab.SetPhase(id, downloadclient.PhaseDownloading, 250); err != nil {
		t.Fatal(err)
	}
	s.pass(t, jobs.Poll)

	var now queueItemJSON
	for _, it := range s.queue(t) {
		if it.GrabID == hd.GrabID {
			now = it
		}
	}
	if now.Phase != "downloading" || now.BytesTotal != 1000 || now.BytesLeft != 250 {
		t.Errorf("after progress: %+v", now)
	}
	if got := s.grabState(t, hd.GrabID); got != "downloading" {
		t.Errorf("state = %s, want downloading", got)
	}

	if err := s.sab.Complete(id, "/data/usenet/movies/Paddington"); err != nil {
		t.Fatal(err)
	}
	s.pass(t, jobs.Poll)

	if got := s.grabState(t, hd.GrabID); got != "completed" {
		t.Errorf("state = %s, want completed", got)
	}
}

func TestRunningALoopPassAgainChangesNothing(t *testing.T) {
	s := newSearch(t)
	s.publish(t, goodRelease)
	s.pass(t, jobs.Search)
	s.pass(t, jobs.Poll)
	before := s.queue(t)

	s.pass(t, jobs.Search)
	s.pass(t, jobs.Poll)
	s.pass(t, jobs.Poll)

	after := s.queue(t)
	if len(after) != len(before) || len(s.jobs(t)) != len(before) {
		t.Errorf("queue %d -> %d, client jobs %d", len(before), len(after), len(s.jobs(t)))
	}
	if a, b := after[0], before[0]; a.GrabID != b.GrabID || a.Phase != b.Phase || a.BytesLeft != b.BytesLeft || a.BytesTotal != b.BytesTotal {
		t.Errorf("queue item changed: %+v -> %+v", before[0], after[0])
	}
}

func TestAfterARestartStartupReconciliationPicksUpTheGrabsInFlight(t *testing.T) {
	s := newSearch(t)
	s.publish(t, goodRelease)
	s.pass(t, jobs.Search)
	for _, j := range s.jobs(t) {
		if err := s.sab.SetPhase(j.ClientID, downloadclient.PhaseDownloading, 100); err != nil {
			t.Fatal(err)
		}
	}

	s.in.restart()

	if q := s.queue(t); len(q) != 1 || q[0].Phase != "queued" || q[0].BytesLeft != 0 {
		t.Fatalf("before reconciliation: %+v, want the Grab from its row", q)
	}
	s.in.app.Jobs.Reconcile(context.Background())
	q := s.queue(t)
	if len(q) != 1 || q[0].Phase != "downloading" || q[0].BytesLeft != 100 {
		t.Errorf("after reconciliation: %+v", q)
	}
	s.pass(t, jobs.Search)
	if len(s.queue(t)) != 1 || len(s.jobs(t)) != 1 {
		t.Errorf("the search after a restart grabbed again")
	}
}

func TestAddingAMovieThroughTheUIKicksTheSearchLoop(t *testing.T) {
	s := newSearchBare(t)
	s.publish(t, goodRelease)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go s.in.app.Jobs.Run(ctx)
	time.Sleep(50 * time.Millisecond) // the startup pass finds nothing due

	s.addPaddington(t)

	deadline := time.Now().Add(5 * time.Second)
	for len(s.queue(t)) == 0 {
		if time.Now().After(deadline) {
			t.Fatal("no Grab appeared after the add")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestAnUnmonitoredTitleGetsNoAutomaticGrab(t *testing.T) {
	s := newSearch(t)
	s.publish(t, goodRelease)
	if _, err := s.in.st.Write().Exec(`UPDATE titles SET monitored = 0`); err != nil {
		t.Fatal(err)
	}

	s.pass(t, jobs.Search)

	if q := s.queue(t); len(q) != 0 {
		t.Errorf("queue = %+v", q)
	}
}

func TestCancelRemovesTheJobFromTheClientAndTheQueue(t *testing.T) {
	s := newSearch(t)
	s.publish(t, goodRelease)
	s.pass(t, jobs.Search)
	grab := s.queue(t)[0].GrabID

	r := s.valid("POST", fmt.Sprintf("/grabs/%d/cancel", grab), "")

	if r.Status != 204 {
		t.Fatalf("cancel = %d %s", r.Status, r.Body)
	}
	if len(s.queue(t)) != 0 || len(s.jobs(t)) != 0 {
		t.Errorf("queue %+v, client %+v, want both empty", s.queue(t), s.jobs(t))
	}
	if r := s.valid("GET", fmt.Sprintf("/grabs/%d", grab), ""); r.Status != 404 {
		t.Errorf("GET canceled Grab = %d", r.Status)
	}
	if r := s.valid("POST", fmt.Sprintf("/grabs/%d/cancel", grab), ""); r.Status != 404 {
		t.Errorf("canceling twice = %d, want 404", r.Status)
	}
	s.pass(t, jobs.Search)
	if len(s.queue(t)) != 0 {
		t.Errorf("a plain cancel must not trigger an immediate re-grab")
	}
}

func TestCancelAndBlocklistBlocklistsTheReleaseAndSearchesForTheNextBest(t *testing.T) {
	s := newSearch(t)
	s.publish(t, goodRelease)
	s.publish(t, "Paddington.2014.1080p.WEBDL.x264-OTHER")
	s.pass(t, jobs.Search)
	first := s.queue(t)[0]

	r := s.valid("POST", fmt.Sprintf("/grabs/%d/cancel", first.GrabID), `{"blocklist":true}`)

	if r.Status != 204 {
		t.Fatalf("cancel = %d %s", r.Status, r.Body)
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
}

func TestAnUpgradeGrabShowsTheBadgeAndHowMuchBetterItScores(t *testing.T) {
	s := newSearch(t)
	s.publish(t, goodRelease)
	if _, err := s.in.st.Write().Exec(
		`INSERT INTO files (version_id, path, size, release_name, score, imported_at)
		 VALUES (?, '/data/media/movies/Paddington/p.mkv', 1, 'Paddington.2014.720p.HDTV.x264-OLD', -50, '2026-10-01T00:00:00Z')`, s.hd); err != nil {
		t.Fatal(err)
	}
	list := s.releases(t, s.hd)
	if r := s.grab(s.hd, list.find(t, goodRelease).ReleaseID, false); r.Status != 201 {
		t.Fatalf("grab = %d %s", r.Status, r.Body)
	}

	q := s.queue(t)

	if len(q) != 1 || !q[0].IsUpgrade || q[0].ScoreDelta == nil {
		t.Fatalf("queue = %+v, want an Upgrade with a score delta", q)
	}
	if want := list.find(t, goodRelease).Score + 50; *q[0].ScoreDelta != want {
		t.Errorf("score delta = %d, want %d", *q[0].ScoreDelta, want)
	}
}

func TestQueueAndCancelNeedALogin(t *testing.T) {
	s := newSearch(t)
	anon := s.in.browser()
	for _, p := range []struct{ method, path string }{{"GET", "/queue"}, {"POST", "/grabs/1/cancel"}} {
		if r := anon.do(p.method, p.path, "{}"); r.Status != 401 {
			t.Errorf("%s %s = %d, want 401", p.method, p.path, r.Status)
		}
	}
}
