package api_test

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/jobs"
	"github.com/hyprsh/kestrel/internal/plextv/plextvtest"
)

const watchlistOn = `{"enabled":true,"watchlist":true,"watch_ahead":false,"labels":false,"poster_badge":false,"poster_badge_days":null,"instance":"Plex","users":[],"user_root_folders":%s}`

func (h *plexHousehold) watchlistPass(t *testing.T) error {
	t.Helper()
	return h.app.Jobs.Pass(context.Background(), jobs.Watchlist)
}

func TestATitleNewlyOnAFriendsWatchlistBecomesTheirRequestInTheirRootFolder(t *testing.T) {
	t.Parallel()
	h, l := requesterLibrary(t)
	movies, _ := l.moreFolders(t)
	h.putSignIn(fmt.Sprintf(watchlistOn, fmt.Sprintf(`[{"user":"anna","movies":%q,"series":null}]`, movies)))
	h.tv.AddFriend(plextvtest.Friend{UUID: "uuid-anna", Username: "anna", DisplayName: "Anna"})
	h.tv.SetWatchlist("uuid-anna", plextvtest.WatchItem{Key: "old", Type: "movie", Title: "Old", Guids: []string{"tmdb://999999"}})

	if err := h.watchlistPass(t); err != nil {
		t.Fatal(err)
	}
	if list := decode[requestListJSON](t, l.valid("GET", "/requests?source=plex_watchlist", "")); len(list.Items) != 0 {
		t.Fatalf("the baseline made Requests: %+v", list.Items)
	}

	h.tv.SetWatchlist("uuid-anna",
		plextvtest.WatchItem{Key: "old", Type: "movie", Title: "Old", Guids: []string{"tmdb://999999"}},
		plextvtest.WatchItem{Key: "pad", Type: "movie", Title: "Paddington", Guids: []string{"tmdb://116149"}})
	for range 2 { // the second pass has nothing new
		if err := h.watchlistPass(t); err != nil {
			t.Fatal(err)
		}
	}
	list := decode[requestListJSON](t, l.valid("GET", "/requests?source=plex_watchlist", ""))
	if len(list.Items) != 1 {
		t.Fatalf("Requests = %+v, want one", list.Items)
	}
	req := list.Items[0]
	if req.Requester.ID != "10" || req.Requester.Name != "anna" || req.Outcome != "accepted" || len(req.Slots) != 1 {
		t.Errorf("request = %+v", req)
	}
	if st, _, profile, _ := req.slot(t, "standard"); st != "queued" || profile != "hd-primary" {
		t.Errorf("standard = %s %s", st, profile)
	}
	if got := decode[titleJSON](t, l.valid("GET", fmt.Sprintf("/titles/%d", *req.TitleID), "")).RootFolder; got != movies {
		t.Errorf("root folder = %q, want %q", got, movies)
	}
	// It is her Request, like one from the UI: My Requests only lists the UI's, the Log names the source.
	if r := l.valid("GET", "/events", ""); !strings.Contains(r.Body, "Request from anna via Watchlist") {
		t.Errorf("the Log lacks the Request: %s", r.Body)
	}
}

func TestWatchlistSyncDoesNothingWhileItsSwitchIsOff(t *testing.T) {
	t.Parallel()
	h, l := requesterLibrary(t)
	h.tv.AddFriend(plextvtest.Friend{UUID: "uuid-anna", Username: "anna"})
	h.tv.SetWatchlist("uuid-anna")
	before := len(h.tv.Calls())
	if err := h.watchlistPass(t); err != nil || len(h.tv.Calls()) != before {
		t.Fatalf("err %v, %d new plex.tv calls, want none", err, len(h.tv.Calls())-before)
	}
	jobsList := l.valid("GET", "/jobs", "")
	if !strings.Contains(jobsList.Body, `"name":"watchlist"`) || !strings.Contains(jobsList.Body, `"disabled_by":"plex_watchlist"`) {
		t.Errorf("jobs = %s, want the Watchlist job disabled by its switch", jobsList.Body)
	}
	h.putSignIn(fmt.Sprintf(watchlistOn, `[]`))
	if r := l.valid("GET", "/jobs", ""); strings.Contains(r.Body, `"disabled_by":"plex_watchlist"`) {
		t.Errorf("jobs = %s, want the job enabled", r.Body)
	}
}
