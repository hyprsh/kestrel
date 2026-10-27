package plextv_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/plextv"
	"github.com/hyprsh/kestrel/internal/plextv/plextvtest"
)

func TestTheOwnersWatchlistIsReadPageByPage(t *testing.T) {
	t.Parallel()
	c, tv := newClient(t)
	var items []plextvtest.WatchItem
	for i := range 120 {
		items = append(items, plextvtest.WatchItem{Key: fmt.Sprintf("k%03d", i), Type: "movie", Title: fmt.Sprintf("Movie %d", i)})
	}
	items[5].Type = "show"
	tv.SetWatchlist(plextvtest.Owner.UUID, items...)

	got, err := c.OwnerWatchlist(context.Background(), "cid", plextvtest.OwnerToken)
	if err != nil || len(got) != 120 {
		t.Fatalf("OwnerWatchlist = %d entries, %v, want 120", len(got), err)
	}
	if got[0] != (plextv.WatchlistEntry{Key: "k000", Guid: "plex://movie/k000", Kind: plextv.Movie, Title: "Movie 0"}) {
		t.Errorf("first entry = %+v", got[0])
	}
	if got[5].Kind != plextv.Series || got[5].Guid != "plex://show/k005" {
		t.Errorf("a show = %+v, want a Series", got[5])
	}
}

func TestAnEmptyWatchlistIsEmptyButAnUnexpectedAnswerIsUnavailable(t *testing.T) {
	t.Parallel()
	c, tv := newClient(t)
	ctx := context.Background()
	if got, err := c.OwnerWatchlist(ctx, "cid", plextvtest.OwnerToken); err != nil || len(got) != 0 {
		t.Fatalf("an empty Watchlist = %v, %v", got, err)
	}
	tv.BreakWatchlists(true)
	if _, err := c.OwnerWatchlist(ctx, "cid", plextvtest.OwnerToken); !errors.Is(err, plextv.ErrUnavailable) {
		t.Errorf("owner, odd answer: err = %v, want ErrUnavailable", err)
	}
	if _, err := c.Friends(ctx, "cid", plextvtest.OwnerToken); !errors.Is(err, plextv.ErrUnavailable) {
		t.Errorf("friends, odd answer: err = %v, want ErrUnavailable", err)
	}
	if _, err := c.FriendWatchlist(ctx, "cid", plextvtest.OwnerToken, "u"); !errors.Is(err, plextv.ErrUnavailable) {
		t.Errorf("friend Watchlist, odd answer: err = %v, want ErrUnavailable", err)
	}
	tv.BreakWatchlists(false)
	tv.SetDown(true)
	if _, err := c.OwnerWatchlist(ctx, "cid", plextvtest.OwnerToken); !errors.Is(err, plextv.ErrUnavailable) {
		t.Errorf("down: err = %v, want ErrUnavailable", err)
	}
}

func TestFriendsAndTheirWatchlistsAreReadByUUID(t *testing.T) {
	t.Parallel()
	c, tv := newClient(t)
	ctx := context.Background()
	tv.AddFriend(plextvtest.Friend{UUID: "uuid-anna", Username: "anna", DisplayName: "Anna"})
	var items []plextvtest.WatchItem
	for i := range 250 {
		items = append(items, plextvtest.WatchItem{Key: fmt.Sprintf("f%03d", i), Type: "show", Title: "S"})
	}
	tv.SetWatchlist("uuid-anna", items...)

	friends, err := c.Friends(ctx, "cid", plextvtest.OwnerToken)
	if err != nil || len(friends) != 1 || friends[0] != (plextv.Friend{UUID: "uuid-anna", Username: "anna", DisplayName: "Anna"}) {
		t.Fatalf("Friends = %+v, %v", friends, err)
	}
	got, err := c.FriendWatchlist(ctx, "cid", plextvtest.OwnerToken, "uuid-anna")
	if err != nil || len(got) != 250 || got[0].Kind != plextv.Series || got[0].Guid != "plex://show/f000" {
		t.Fatalf("FriendWatchlist = %d entries (%+v), %v, want 250 Series", len(got), got[:1], err)
	}
	// A friend plex.tv does not know, or whose Watchlist is private, is not an empty one.
	if _, err := c.FriendWatchlist(ctx, "cid", plextvtest.OwnerToken, "uuid-nobody"); !errors.Is(err, plextv.ErrUnavailable) {
		t.Errorf("an unknown friend: err = %v, want ErrUnavailable", err)
	}
}

func TestAnEntrysIdsComeFromPlexsMetadata(t *testing.T) {
	t.Parallel()
	c, tv := newClient(t)
	ctx := context.Background()
	tv.SetWatchlist(plextvtest.Owner.UUID,
		plextvtest.WatchItem{Key: "m1", Type: "movie", Title: "Dune", Guids: []string{"imdb://tt1160419", "tmdb://438631", "tvdb://12345"}},
		plextvtest.WatchItem{Key: "s1", Type: "show", Title: "Severance", Guids: []string{"tmdb://95396", "tvdb://371980"}},
		plextvtest.WatchItem{Key: "x1", Type: "movie", Title: "Obscure"},
	)
	cases := []struct {
		key  string
		want plextv.Ids
	}{
		{"m1", plextv.Ids{TMDB: 438631, TVDB: 12345, IMDb: "tt1160419"}},
		{"s1", plextv.Ids{TMDB: 95396, TVDB: 371980}},
		{"x1", plextv.Ids{}},
		{"gone", plextv.Ids{}}, // plex.tv does not know it: no ids, not an outage
	}
	for _, tc := range cases {
		got, err := c.Resolve(ctx, "cid", plextvtest.OwnerToken, tc.key)
		if err != nil || got != tc.want {
			t.Errorf("Resolve(%s) = %+v, %v, want %+v", tc.key, got, err, tc.want)
		}
	}
	tv.BreakWatchlists(true)
	if _, err := c.Resolve(ctx, "cid", plextvtest.OwnerToken, "m1"); !errors.Is(err, plextv.ErrUnavailable) {
		t.Errorf("odd answer: err = %v, want ErrUnavailable", err)
	}
}

func TestNoWatchlistCallLeaksAToken(t *testing.T) {
	t.Parallel()
	c, tv := newClient(t)
	tv.SetDown(true)
	_, err := c.OwnerWatchlist(context.Background(), "cid", plextvtest.OwnerToken)
	if err == nil || strings.Contains(err.Error(), plextvtest.OwnerToken) {
		t.Errorf("err = %v, want one without the token", err)
	}
	for _, call := range tv.Calls() {
		if call.Product != "Kestrel" || call.ClientID != "cid" {
			t.Errorf("call %+v lacks Kestrel's headers", call)
		}
	}
}
