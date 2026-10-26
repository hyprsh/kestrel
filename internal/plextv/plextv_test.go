package plextv_test

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/plextv"
	"github.com/hyprsh/kestrel/internal/plextv/plextvtest"
)

func newClient(t *testing.T) (*plextv.Client, *plextvtest.Server) {
	t.Helper()
	tv := plextvtest.New(t)
	return plextv.New(plextv.Options{BaseURL: tv.URL, AppURL: tv.URL + "/auth", Version: "9.9.9"}), tv
}

func TestAPinIsCreatedAuthorisedAndRead(t *testing.T) {
	t.Parallel()
	c, tv := newClient(t)
	ctx := context.Background()
	pin, err := c.CreatePin(ctx, "client-1")
	if err != nil || pin.ID == 0 || pin.Code == "" {
		t.Fatalf("CreatePin = %+v, %v", pin, err)
	}
	if tok, err := c.PinToken(ctx, "client-1", pin); err != nil || tok != "" {
		t.Fatalf("before authorising = %q, %v, want no token", tok, err)
	}
	tv.Authorise(pin.Code, "t-1")
	if tok, err := c.PinToken(ctx, "client-1", pin); err != nil || tok != "t-1" {
		t.Fatalf("after authorising = %q, %v", tok, err)
	}
	if _, err := c.PinToken(ctx, "client-1", plextv.Pin{ID: pin.ID, Code: "wrong"}); !errors.Is(err, plextv.ErrPinGone) {
		t.Errorf("a wrong code: err = %v, want ErrPinGone", err)
	}
	tv.ExpireAll()
	if _, err := c.PinToken(ctx, "client-1", pin); !errors.Is(err, plextv.ErrPinGone) {
		t.Errorf("an expired PIN: err = %v, want ErrPinGone", err)
	}
	for _, call := range tv.Calls() {
		if call.Product != "Kestrel" || call.Version != "9.9.9" || call.ClientID != "client-1" {
			t.Errorf("call %+v lacks Kestrel's headers", call)
		}
	}
}

func TestTheAuthURLCarriesTheClientTheCodeAndWhereToComeBack(t *testing.T) {
	t.Parallel()
	c := plextv.New(plextv.Options{})
	got := c.AuthURL("cid 1", plextv.Pin{ID: 5, Code: "abc"}, "https://kestrel.example/base/?plex=1")
	want := "https://app.plex.tv/auth#?clientID=cid+1&code=abc&forwardUrl=" + url.QueryEscape("https://kestrel.example/base/?plex=1") +
		"&context%5Bdevice%5D%5Bproduct%5D=Kestrel"
	if got != want {
		t.Errorf("AuthURL = %s\nwant      %s", got, want)
	}
}

func TestTheAccountBehindATokenIsRead(t *testing.T) {
	t.Parallel()
	c, tv := newClient(t)
	tv.AddAccount("t", plextv.Account{ID: 7, UUID: "u", Username: "", Title: "Kim", Thumb: "http://x/y.png"})
	a, err := c.Account(context.Background(), "cid", "t")
	if err != nil || a.ID != 7 || a.Name() != "Kim" || a.Thumb != "http://x/y.png" || a.UUID != "u" {
		t.Errorf("Account = %+v, %v", a, err)
	}
	if _, err := c.Account(context.Background(), "cid", "unknown"); !errors.Is(err, plextv.ErrTokenRejected) {
		t.Errorf("an unknown token: err = %v, want ErrTokenRejected", err)
	}
}

func TestSharedUsersAreReadFromTheOwnersXML(t *testing.T) {
	t.Parallel()
	c, tv := newClient(t)
	tv.Share(plextv.SharedUser{ID: 2, Username: "o'brien & co", Title: `Q "the" <Q>`, Servers: []string{"m1", "m2"}})
	tv.Share(plextv.SharedUser{ID: 3, Title: "Kim", Home: true})
	users, err := c.SharedUsers(context.Background(), "cid", plextvtest.OwnerToken)
	if err != nil || len(users) != 2 {
		t.Fatalf("SharedUsers = %+v, %v", users, err)
	}
	if u := users[0]; u.ID != 2 || u.Username != "o'brien & co" || u.Title != `Q "the" <Q>` || u.Home || len(u.Servers) != 2 || u.Servers[1] != "m2" {
		t.Errorf("friend = %+v", u)
	}
	if u := users[1]; u.ID != 3 || u.Username != "" || !u.Home || len(u.Servers) != 0 {
		t.Errorf("Home user = %+v", u)
	}
}

func TestAccessIsTheOwnerAHomeMemberOrAFriendWithAShareOfThisServer(t *testing.T) {
	t.Parallel()
	c, tv := newClient(t)
	tv.Share(plextv.SharedUser{ID: 2, Username: "friend", Servers: []string{plextvtest.Machine}})
	tv.Share(plextv.SharedUser{ID: 3, Username: "away", Servers: []string{"other"}})
	tv.Share(plextv.SharedUser{ID: 4, Username: "bare"})
	tv.Share(plextv.SharedUser{ID: 5, Title: "Kim", Home: true})
	for _, c2 := range []struct {
		id   int64
		want bool
	}{{plextvtest.Owner.ID, true}, {2, true}, {3, false}, {4, false}, {5, true}, {77, false}} {
		got, err := c.HasAccess(context.Background(), "cid", tv.URL, plextvtest.OwnerToken, plextv.Account{ID: c2.id})
		if err != nil || got != c2.want {
			t.Errorf("account %d: access = %v, %v, want %v", c2.id, got, err, c2.want)
		}
	}
}

func TestAnOutageOrABadOwnerTokenIsAnErrorNeverANo(t *testing.T) {
	t.Parallel()
	c, tv := newClient(t)
	tv.Share(plextv.SharedUser{ID: 2, Username: "friend", Servers: []string{plextvtest.Machine}})
	ctx := context.Background()

	if ok, err := c.HasAccess(ctx, "cid", tv.URL, "wrong-token", plextv.Account{ID: 2}); ok || !errors.Is(err, plextv.ErrUnavailable) {
		t.Errorf("a bad owner token = %v, %v, want ErrUnavailable", ok, err)
	}
	if ok, err := c.HasAccess(ctx, "cid", "http://127.0.0.1:1", plextvtest.OwnerToken, plextv.Account{ID: 2}); ok || !errors.Is(err, plextv.ErrUnavailable) {
		t.Errorf("an unreachable Plex server = %v, %v, want ErrUnavailable", ok, err)
	}
	tv.SetDown(true)
	if ok, err := c.HasAccess(ctx, "cid", tv.URL, plextvtest.OwnerToken, plextv.Account{ID: 2}); ok || !errors.Is(err, plextv.ErrUnavailable) {
		t.Errorf("plex.tv down = %v, %v, want ErrUnavailable", ok, err)
	}
	if _, err := c.CreatePin(ctx, "cid"); !errors.Is(err, plextv.ErrUnavailable) {
		t.Errorf("CreatePin while down: err = %v", err)
	}
}

func TestNoTokenAppearsInAnError(t *testing.T) {
	t.Parallel()
	c, tv := newClient(t)
	tv.SetDown(true)
	_, err := c.Account(context.Background(), "cid", "super-secret-token")
	if err == nil || strings.Contains(err.Error(), "super-secret-token") {
		t.Errorf("err = %v", err)
	}
	_, err = c.MachineIdentifier(context.Background(), "cid", "http://127.0.0.1:1", "super-secret-token")
	if err == nil || strings.Contains(err.Error(), "super-secret-token") {
		t.Errorf("err = %v", err)
	}
}

func TestNamesMatchIgnoringCaseByUsernameOrTitle(t *testing.T) {
	t.Parallel()
	a := plextv.Account{Username: "anna", Title: "Anna Smith"}
	for _, names := range [][]string{{"ANNA"}, {"x", " anna smith "}} {
		if !a.Matches(names) {
			t.Errorf("%v should match", names)
		}
	}
	for _, names := range [][]string{nil, {"ann"}, {""}} {
		if a.Matches(names) {
			t.Errorf("%v should not match", names)
		}
	}
	if (plextv.Account{Title: "Kim"}).Matches([]string{""}) {
		t.Error("an empty name must not match an account without a username")
	}
}
