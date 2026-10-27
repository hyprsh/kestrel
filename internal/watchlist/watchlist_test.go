package watchlist_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/plextv"
	"github.com/hyprsh/kestrel/internal/plextv/plextvtest"
	"github.com/hyprsh/kestrel/internal/store"
	"github.com/hyprsh/kestrel/internal/store/storetest"
	"github.com/hyprsh/kestrel/internal/watchlist"
)

type request struct {
	P watchlist.Person
	E watchlist.Entry
}

// host is the rest of Kestrel: its switch, its users list and the Requests it makes.
type host struct {
	on       bool
	users    []string
	requests []request
	failFor  string // a title whose Request fails
	url      string
	st       *store.Store
}

func (h *host) Config(context.Context) (watchlist.Config, bool, error) {
	return watchlist.Config{ClientID: "cid", PlexURL: h.url, OwnerToken: plextvtest.OwnerToken, Users: h.users}, h.on, nil
}

func (h *host) Request(_ context.Context, p watchlist.Person, e watchlist.Entry) (int64, error) {
	if e.Title == h.failFor {
		return 0, errors.New("no Root folder")
	}
	h.requests = append(h.requests, request{p, e})
	var id int64
	err := h.st.Write().QueryRow(`INSERT INTO requests (source, source_request_id, requester_id, requester_name, title_name, outcome, created_at)
		VALUES (?, ?, ?, ?, ?, 'accepted', '2026-10-27T12:00:00Z') RETURNING id`,
		watchlist.Source, watchlist.SourceRequestID(p, e), p.ID, p.Name, e.Title).Scan(&id)
	return id, err
}

type env struct {
	t     *testing.T
	tv    *plextvtest.Server
	host  *host
	st    *store.Store
	sync  *watchlist.Sync
	clock time.Time
}

func newEnv(t *testing.T) *env {
	t.Helper()
	tv := plextvtest.New(t)
	st, err := store.Open(context.Background(), store.Options{Dir: storetest.Dir(t)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	e := &env{t: t, tv: tv, host: &host{on: true, url: tv.URL, st: st}, st: st, clock: time.Date(2026, 10, 27, 12, 0, 0, 0, time.UTC)}
	client := plextv.New(plextv.Options{BaseURL: tv.URL})
	e.sync = watchlist.New(watchlist.Deps{Store: st, TV: client, Host: e.host, Clock: func() time.Time { return e.clock }})
	return e
}

func (e *env) run() error {
	e.t.Helper()
	e.clock = e.clock.Add(10 * time.Minute)
	return e.sync.Run(context.Background())
}

func movie(key, title string, tmdb int) plextvtest.WatchItem {
	return plextvtest.WatchItem{Key: key, Type: "movie", Title: title, Guids: []string{fmt.Sprintf("tmdb://%d", tmdb)}}
}

func show(key, title string, tvdb int) plextvtest.WatchItem {
	return plextvtest.WatchItem{Key: key, Type: "show", Title: title, Guids: []string{fmt.Sprintf("tvdb://%d", tvdb)}}
}

// friend shares the server with a friend of the owner.
func (e *env) friend(id int64, uuid, name string) {
	e.tv.AddFriend(plextvtest.Friend{UUID: uuid, Username: name, DisplayName: name})
	e.tv.Share(plextv.SharedUser{ID: id, Username: name, Title: name, Servers: []string{plextvtest.Machine}})
}

func (e *env) entries() int {
	var n int
	if err := e.st.Read().QueryRow("SELECT count(*) FROM watchlist_entries").Scan(&n); err != nil {
		e.t.Fatal(err)
	}
	return n
}

func TestTheFirstPassTakesABaselineAndRequestsNothingThenOnlyNewTitlesAreRequested(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	owner := plextvtest.Owner.UUID
	e.tv.SetWatchlist(owner, movie("m1", "Dune", 438631), show("s1", "Severance", 371980))

	if err := e.run(); err != nil || len(e.host.requests) != 0 || e.entries() != 2 {
		t.Fatalf("first pass: err %v, %d Requests, %d entries, want a baseline of 2 and no Requests", err, len(e.host.requests), e.entries())
	}
	if n := e.tv.MetadataReads("m1"); n != 0 {
		t.Errorf("the baseline read the metadata of an entry %d times, want never", n)
	}

	e.tv.SetWatchlist(owner, movie("m1", "Dune", 438631), show("s1", "Severance", 371980), movie("m2", "Arrival", 329865), show("s2", "Andor", 393189))
	if err := e.run(); err != nil || len(e.host.requests) != 2 {
		t.Fatalf("second pass: err %v, %d Requests, want 2", err, len(e.host.requests))
	}
	got := e.host.requests
	if got[0].E.Title != "Arrival" || got[0].E.Kind != plextv.Movie || got[0].E.Ids.TMDB != 329865 || got[0].P.ID != "1" || got[0].P.Name != "owner" {
		t.Errorf("first Request = %+v", got[0])
	}
	if got[1].E.Title != "Andor" || got[1].E.Kind != plextv.Series || got[1].E.Ids.TVDB != 393189 {
		t.Errorf("second Request = %+v", got[1])
	}
}

func TestAPassThatChangesNothingDoesNothing(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	owner := plextvtest.Owner.UUID
	e.tv.SetWatchlist(owner, movie("m1", "Dune", 1))
	_ = e.run()
	e.tv.SetWatchlist(owner, movie("m1", "Dune", 1), movie("m2", "Arrival", 2))
	_ = e.run()
	for range 3 {
		if err := e.run(); err != nil {
			t.Fatal(err)
		}
	}
	if len(e.host.requests) != 1 || e.entries() != 2 || e.tv.MetadataReads("m2") != 1 {
		t.Errorf("%d Requests, %d entries, %d metadata reads, want 1, 2 and 1", len(e.host.requests), e.entries(), e.tv.MetadataReads("m2"))
	}
}

func TestATitleWithNoIdIsKeptAndNotLookedUpAgain(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	owner := plextvtest.Owner.UUID
	e.tv.SetWatchlist(owner)
	_ = e.run()
	e.tv.SetWatchlist(owner, plextvtest.WatchItem{Key: "x1", Type: "movie", Title: "Obscure"})
	_ = e.run()
	_ = e.run()
	if len(e.host.requests) != 0 || e.entries() != 1 || e.tv.MetadataReads("x1") != 1 {
		t.Errorf("%d Requests, %d entries, %d reads, want none, 1 and 1", len(e.host.requests), e.entries(), e.tv.MetadataReads("x1"))
	}
}

func TestNothingIsReadWhileTheSwitchIsOff(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	e.host.on = false
	e.tv.SetWatchlist(plextvtest.Owner.UUID, movie("m1", "Dune", 1))
	if err := e.run(); err != nil || len(e.tv.Calls()) != 0 || e.entries() != 0 {
		t.Errorf("err %v, %d calls, %d entries, want nothing", err, len(e.tv.Calls()), e.entries())
	}
}

func TestFriendsWhoMayRequestAreReadAndTheirTitlesAreTheirs(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	e.friend(10, "uuid-anna", "anna")
	e.friend(11, "uuid-ben", "ben")
	// carl is a friend whose share does not include this server; dora is not shared with at all.
	e.tv.AddFriend(plextvtest.Friend{UUID: "uuid-carl", Username: "carl"})
	e.tv.Share(plextv.SharedUser{ID: 12, Username: "carl", Servers: []string{"another-machine"}})
	e.tv.AddFriend(plextvtest.Friend{UUID: "uuid-dora", Username: "dora"})
	// a Plex Home member needs no share
	e.tv.AddFriend(plextvtest.Friend{UUID: "uuid-eve", Username: "eve"})
	e.tv.Share(plextv.SharedUser{ID: 13, Username: "eve", Home: true})
	for _, f := range []string{"uuid-anna", "uuid-ben", "uuid-carl", "uuid-dora", "uuid-eve"} {
		e.tv.SetWatchlist(f, movie("old-"+f, "Old "+f, 1))
	}
	_ = e.run()
	e.tv.SetWatchlist("uuid-anna", movie("old-uuid-anna", "Old", 1), movie("n1", "New for Anna", 7))
	e.tv.SetWatchlist("uuid-carl", movie("n2", "New for Carl", 8))
	e.tv.SetWatchlist("uuid-eve", movie("n3", "New for Eve", 9))
	if err := e.run(); err != nil {
		t.Fatal(err)
	}
	var who []string
	for _, r := range e.host.requests {
		who = append(who, r.P.ID+":"+r.P.Name+":"+r.E.Title)
	}
	if got := strings.Join(who, ","); got != "10:anna:New for Anna,13:eve:New for Eve" {
		t.Errorf("Requests = %s", got)
	}
}

func TestTheUsersListNarrowsWhoIsRead(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	e.friend(10, "uuid-anna", "anna")
	e.friend(11, "uuid-ben", "ben")
	e.host.users = []string{"ANNA"}
	e.tv.SetWatchlist("uuid-anna")
	e.tv.SetWatchlist("uuid-ben")
	e.tv.SetWatchlist(plextvtest.Owner.UUID)
	_ = e.run()
	e.tv.SetWatchlist("uuid-anna", movie("a", "For Anna", 1))
	e.tv.SetWatchlist("uuid-ben", movie("b", "For Ben", 2))
	e.tv.SetWatchlist(plextvtest.Owner.UUID, movie("o", "For the owner", 3))
	_ = e.run()
	if len(e.host.requests) != 1 || e.host.requests[0].P.Name != "anna" {
		t.Errorf("Requests = %+v, want anna's alone", e.host.requests)
	}
}

func TestWhenPlexTVMakesNoSenseNothingIsRecordedAndTheNextPassRetries(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	owner := plextvtest.Owner.UUID
	e.tv.SetWatchlist(owner)
	_ = e.run()
	e.tv.SetWatchlist(owner, movie("m1", "Dune", 1))
	e.tv.BreakWatchlists(true)
	if err := e.run(); !errors.Is(err, plextv.ErrUnavailable) || e.entries() != 0 {
		t.Fatalf("err %v, %d entries, want ErrUnavailable and none", err, e.entries())
	}
	e.tv.BreakWatchlists(false)
	if err := e.run(); err != nil || len(e.host.requests) != 1 {
		t.Errorf("after recovering: err %v, %d Requests, want 1", err, len(e.host.requests))
	}
}

func TestAnUnavailableWatchlistAsABaselineIsNotAnEmptyOne(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	e.tv.SetWatchlist(plextvtest.Owner.UUID, movie("m1", "Dune", 1))
	e.tv.BreakWatchlists(true)
	_ = e.run()
	e.tv.BreakWatchlists(false)
	_ = e.run() // the baseline is taken now, with Dune on it
	if len(e.host.requests) != 0 || e.entries() != 1 {
		t.Errorf("%d Requests, %d entries, want a baseline of 1 and no Requests", len(e.host.requests), e.entries())
	}
}

func TestATitleWhoseRequestFailsIsTriedAgainAndTheOthersAreNot(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	owner := plextvtest.Owner.UUID
	e.tv.SetWatchlist(owner)
	_ = e.run()
	e.tv.SetWatchlist(owner, movie("m1", "Broken", 1), movie("m2", "Fine", 2))
	e.host.failFor = "Broken"
	if err := e.run(); err == nil || len(e.host.requests) != 1 || e.entries() != 1 {
		t.Fatalf("err %v, %d Requests, %d entries, want an error, 1 and 1", err, len(e.host.requests), e.entries())
	}
	e.host.failFor = ""
	if err := e.run(); err != nil || len(e.host.requests) != 2 || e.host.requests[1].E.Title != "Broken" {
		t.Errorf("after the fix: err %v, Requests %+v", err, e.host.requests)
	}
}

func TestEntriesRecordTheTimeTheyWereFirstSeen(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	e.tv.SetWatchlist(plextvtest.Owner.UUID)
	_ = e.run()
	e.tv.SetWatchlist(plextvtest.Owner.UUID, movie("m1", "Dune", 1))
	_ = e.run()
	var seen string
	var tmdb, reqID int
	if err := e.st.Read().QueryRow("SELECT first_seen_at, tmdb_id, request_id FROM watchlist_entries WHERE plex_guid = 'plex://movie/m1'").Scan(&seen, &tmdb, &reqID); err != nil {
		t.Fatal(err)
	}
	if seen != "2026-10-27T12:20:00Z" || tmdb != 1 || reqID != 1 {
		t.Errorf("first_seen_at %s tmdb_id %d request_id %d", seen, tmdb, reqID)
	}
}
