package api_test

import (
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/jobs"
	downloadclient "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1"
	"github.com/hyprsh/kestrel/internal/probe"
)

type grabEntryJSON struct {
	GrabID          int64    `json:"grab_id"`
	TitleID         *int64   `json:"title_id"`
	VersionID       *int64   `json:"version_id"`
	Title           string   `json:"title"`
	Kind            *string  `json:"kind"`
	Slot            *string  `json:"slot"`
	Episodes        []string `json:"episodes"`
	ReleaseName     string   `json:"release_name"`
	Indexer         string   `json:"indexer"`
	Size            int64    `json:"size"`
	Score           int      `json:"score"`
	State           string   `json:"state"`
	Failure         *string  `json:"failure"`
	BlocklistReason *string  `json:"blocklist_reason"`
	Stalled         *struct {
		Reason string    `json:"reason"`
		Since  time.Time `json:"since"`
	} `json:"stalled"`
	GrabbedAt time.Time `json:"grabbed_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type grabListJSON struct {
	Items      []grabEntryJSON `json:"items"`
	NextCursor *string         `json:"next_cursor"`
}

func (s search) grabs(t *testing.T, query string) grabListJSON {
	t.Helper()
	r := s.valid("GET", "/grabs"+query, "")
	if r.Status != 200 {
		t.Fatalf("GET /grabs%s = %d %s", query, r.Status, r.Body)
	}
	return decode[grabListJSON](t, r)
}

func TestAnImportedGrabIsListedWithItsTitleIndexerAndScore(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	s.prober.set(goodProbe(), nil)
	grab, _ := s.download(t, map[string]string{"paddington.mkv": "the movie"})
	s.pass(t, jobs.Poll)
	s.pass(t, jobs.Import)

	l := s.grabs(t, "?state=imported")

	if len(l.Items) != 1 || l.NextCursor != nil {
		t.Fatalf("grabs = %+v, want the one imported Grab", l)
	}
	g := l.Items[0]
	if g.GrabID != grab || g.State != "imported" || g.Title != "Paddington" || g.Kind == nil || *g.Kind != "movie" ||
		g.Slot == nil || *g.Slot != "standard" || g.ReleaseName != goodRelease || g.Indexer != "Alpha" || g.Size != 8<<30 ||
		g.Failure != nil || g.BlocklistReason != nil || g.Stalled != nil || len(g.Episodes) != 0 {
		t.Errorf("imported Grab = %+v", g)
	}
	if !g.GrabbedAt.Equal(s.in.clock.Now()) || g.UpdatedAt.Before(g.GrabbedAt) {
		t.Errorf("grabbed_at = %v, updated_at = %v", g.GrabbedAt, g.UpdatedAt)
	}
}

func TestAQueueItemNamesItsIndexerScoreAndSinceWhenItIsInItsPhase(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	s.publish(t, goodRelease)
	grabbed := s.in.clock.Now()
	s.pass(t, jobs.Search)

	type extra struct {
		GrabID     int64     `json:"grab_id"`
		Kind       *string   `json:"kind"`
		Indexer    string    `json:"indexer"`
		Size       int64     `json:"size"`
		GrabbedAt  time.Time `json:"grabbed_at"`
		PhaseSince time.Time `json:"phase_since"`
		Phase      string    `json:"phase"`
	}
	queue := func() extra {
		t.Helper()
		items := decode[struct {
			Items []extra `json:"items"`
		}](t, s.valid("GET", "/queue", "")).Items
		if len(items) != 1 {
			t.Fatalf("queue = %+v", items)
		}
		return items[0]
	}
	q := queue()
	if q.Indexer != "Alpha" || q.Size != 8<<30 || q.Kind == nil || *q.Kind != "movie" ||
		!q.GrabbedAt.Equal(grabbed) || !q.PhaseSince.Equal(grabbed) {
		t.Errorf("queued item = %+v", q)
	}

	s.in.clock.Advance(5 * time.Minute)
	if err := s.sab.SetPhase(s.jobs(t)[0].ClientID, downloadclient.PhaseDownloading, 250); err != nil {
		t.Fatal(err)
	}
	s.pass(t, jobs.Poll)
	started := s.in.clock.Now()
	s.in.clock.Advance(time.Minute)
	s.pass(t, jobs.Poll)

	if q := queue(); q.Phase != "downloading" || !q.PhaseSince.Equal(started) || !q.GrabbedAt.Equal(grabbed) {
		t.Errorf("downloading item = %+v, want it downloading since %v", q, started)
	}
}

func TestARejectedImportIsListedAsFailedWithWhyAndItsBlocklistEntry(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	short := goodProbe()
	short.Duration = 5 * time.Minute
	s.prober.set(short, nil)
	s.publish(t, secondRelease)
	grab, _ := s.download(t, map[string]string{"paddington.mkv": "the movie"})
	s.pass(t, jobs.Poll)
	s.pass(t, jobs.Import)

	finished := s.grabs(t, "?state=imported&state=failed")

	if len(finished.Items) != 1 {
		t.Fatalf("finished = %+v, want only the rejected Grab, not the next best one it grabbed", finished.Items)
	}
	g := finished.Items[0]
	if g.GrabID != grab || g.State != "failed" || g.Failure == nil || *g.Failure == "" ||
		g.BlocklistReason == nil || *g.BlocklistReason != "import rejected: "+*g.Failure {
		t.Errorf("rejected Grab = %+v", g)
	}
	if all := s.grabs(t, ""); len(all.Items) != 2 || all.Items[0].State != "sent" || all.Items[1].GrabID != grab {
		t.Errorf("all Grabs = %+v, want the next best one first", all.Items)
	}
}

func TestAStalledImportIsListedWithWhatHoldsItUp(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	s.prober.set(probe.Info{}, probe.ErrNotInstalled)
	grab, _ := s.download(t, map[string]string{"paddington.mkv": "the movie"})
	s.pass(t, jobs.Poll)
	s.pass(t, jobs.Import)

	stalled := s.grabs(t, "?stalled=true")

	if len(stalled.Items) != 1 || stalled.Items[0].GrabID != grab || stalled.Items[0].Stalled == nil ||
		stalled.Items[0].Stalled.Reason == "" || !stalled.Items[0].Stalled.Since.Equal(s.in.clock.Now()) {
		t.Fatalf("stalled = %+v", stalled.Items)
	}
	if rest := s.grabs(t, "?stalled=false"); len(rest.Items) != 0 {
		t.Errorf("stalled=false = %+v, want nothing else", rest.Items)
	}
}

func TestGrabsSinceLeavesOutOlderOnesAndPages(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	s.publish(t, goodRelease)
	s.publish(t, uhdRelease)
	s.pass(t, jobs.Search)
	s.in.clock.Advance(8 * 24 * time.Hour)
	since := s.in.clock.Now().Add(-7 * 24 * time.Hour).Format(time.RFC3339)

	if l := s.grabs(t, "?since="+since); len(l.Items) != 0 {
		t.Errorf("since a week ago = %+v, want nothing", l.Items)
	}
	first := s.grabs(t, "?limit=1")
	if len(first.Items) != 1 || first.NextCursor == nil {
		t.Fatalf("first page = %+v", first)
	}
	second := s.grabs(t, "?limit=1&cursor="+*first.NextCursor)
	if len(second.Items) != 1 || second.NextCursor != nil || second.Items[0].GrabID >= first.Items[0].GrabID {
		t.Errorf("second page = %+v after %+v", second, first)
	}
	if r := s.valid("GET", "/grabs?cursor=nonsense", ""); r.Status != 422 {
		t.Errorf("a bad cursor = %d %s", r.Status, r.Body)
	}
}
