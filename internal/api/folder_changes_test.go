package api_test

import (
	"context"
	"encoding/json"
	"net/url"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/imports"
	"github.com/hyprsh/kestrel/internal/jobs"
)

type folderChangesJSON struct {
	Changes []struct {
		Path string `json:"path"`
		Kind string `json:"kind"`
		At   string `json:"at"`
	} `json:"changes"`
	NextMarker string `json:"next_marker"`
	Expired    bool   `json:"expired"`
	More       bool   `json:"more"`
}

func getFolderChanges(t *testing.T, b *browser, query string) folderChangesJSON {
	t.Helper()
	r := b.get("/folder-changes" + query)
	if r.Status != 200 {
		t.Fatalf("GET /folder-changes%s = %d %s", query, r.Status, r.Body)
	}
	var out folderChangesJSON
	if err := json.Unmarshal([]byte(r.Body), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestFolderChangesNeedTheAdmin(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	in.setUp()
	if r := in.call("GET", "/folder-changes", "", nil); r.Status != 401 {
		t.Fatalf("anonymous GET /folder-changes = %d", r.Status)
	}
}

func TestFolderChangesAnswerTheMarkerWindowAndSurviveARestart(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	b := in.setUp()
	ctx := context.Background()
	feed := imports.NewFolderFeed(in.st, in.clock.Now)

	start := getFolderChanges(t, b, "")
	if start.NextMarker != "fc1:0" || start.Expired || start.More || start.Changes == nil || len(start.Changes) != 0 {
		t.Fatalf("first poll = %+v", start)
	}
	if err := feed.Record(ctx, "/media/movies/Arrival (2016)", true); err != nil {
		t.Fatal(err)
	}
	if err := feed.Record(ctx, "/media/movies/Dune (2021)", false); err != nil {
		t.Fatal(err)
	}

	got := getFolderChanges(t, b, "?marker="+url.QueryEscape(start.NextMarker))
	if len(got.Changes) != 2 || got.Changes[0].Kind != "created" || got.Changes[1].Kind != "deleted" ||
		got.Changes[0].Path != "/media/movies/Arrival (2016)" || got.NextMarker != "fc1:2" || got.Expired || got.More {
		t.Fatalf("poll = %+v", got)
	}
	if _, err := time.Parse(time.RFC3339, got.Changes[0].At); err != nil {
		t.Fatalf("at %q: %v", got.Changes[0].At, err)
	}
	cut := getFolderChanges(t, b, "?marker=fc1:0&limit=1")
	if len(cut.Changes) != 1 || !cut.More || cut.NextMarker != "fc1:1" {
		t.Fatalf("limit 1 = %+v", cut)
	}

	in.restart()
	b = in.login()
	again := getFolderChanges(t, b, "?marker=fc1:0&limit=1")
	if len(again.Changes) != 1 || again.NextMarker != "fc1:1" || again.Expired {
		t.Fatalf("after a restart = %+v", again)
	}
}

func TestAMarkerTheFeedCannotAnswerIsExpiredNotAnError(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	b := in.setUp()
	feed := imports.NewFolderFeed(in.st, in.clock.Now)
	if err := feed.Record(context.Background(), "/a", true); err != nil {
		t.Fatal(err)
	}
	for _, m := range []string{"fc1:9", "nonsense", "fc2:1", "fc1:-3"} {
		got := getFolderChanges(t, b, "?marker="+url.QueryEscape(m))
		if !got.Expired || len(got.Changes) != 0 || got.NextMarker != "fc1:1" {
			t.Fatalf("marker %q = %+v", m, got)
		}
	}
}

func TestTheDailyPruneTrimsTheFolderChangeFeed(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	b := in.setUp()
	ctx := context.Background()
	feed := imports.NewFolderFeed(in.st, func() time.Time { return in.clock.Now().AddDate(0, 0, -40) })
	for _, p := range []string{"/a", "/b"} {
		if err := feed.Record(ctx, p, true); err != nil {
			t.Fatal(err)
		}
	}
	if err := imports.NewFolderFeed(in.st, in.clock.Now).Record(ctx, "/c", true); err != nil {
		t.Fatal(err)
	}
	if err := in.app.Jobs.Pass(ctx, jobs.Prune); err != nil {
		t.Fatal(err)
	}
	if got := getFolderChanges(t, b, "?marker=fc1:1"); !got.Expired || got.NextMarker != "fc1:3" {
		t.Fatalf("pruned marker = %+v", got)
	}
	if got := getFolderChanges(t, b, "?marker=fc1:2"); got.Expired || len(got.Changes) != 1 {
		t.Fatalf("boundary marker = %+v", got)
	}
}
