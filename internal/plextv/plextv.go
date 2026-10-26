// Package plextv is Kestrel's client for plex.tv, as far as signing a
// Requester in with Plex needs it (ADR 0018): create and read a PIN, learn the
// account behind a token, read the owner's shared users and ask the Plex
// server who it is. It decides who has access to the server, and holds no
// state: the caller passes the client identifier and the tokens in, and no
// token is logged or put in an error.
package plextv

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	// DefaultURL is plex.tv.
	DefaultURL = "https://plex.tv"
	// DefaultAppURL is the Plex web app's sign-in page.
	DefaultAppURL = "https://app.plex.tv/auth"

	product = "Kestrel"
	maxBody = 4 << 20
)

// Errors a caller tells apart. Anything else a call returns wraps
// ErrUnavailable: plex.tv or the Plex server could not be reached or did not
// make sense.
var (
	// ErrUnavailable means plex.tv or the Plex server could not be reached, or answered badly.
	ErrUnavailable = errors.New("plex is unavailable")
	// ErrPinGone means the PIN is unknown or expired at plex.tv: sign-in starts again.
	ErrPinGone = errors.New("the PIN is unknown or has expired")
	// ErrTokenRejected means plex.tv does not accept the token.
	ErrTokenRejected = errors.New("plex.tv rejected the token")
)

// Options configures a Client.
type Options struct {
	// BaseURL is plex.tv; empty means DefaultURL. Tests and the demo point it at a fake.
	BaseURL string
	// AppURL is the Plex web app's sign-in page; empty means DefaultAppURL.
	AppURL string
	// Version is Kestrel's version, sent as X-Plex-Version.
	Version string
	// HTTP is the HTTP client; nil means one with a 15 s timeout.
	HTTP *http.Client
}

// Client talks to plex.tv.
type Client struct {
	base, app, version string
	http               *http.Client
}

// New returns a Client.
func New(o Options) *Client {
	c := &Client{base: strings.TrimRight(o.BaseURL, "/"), app: o.AppURL, version: o.Version, http: o.HTTP}
	if c.base == "" {
		c.base = DefaultURL
	}
	if c.app == "" {
		c.app = DefaultAppURL
	}
	if c.http == nil {
		c.http = &http.Client{Timeout: 15 * time.Second}
	}
	return c
}

// Pin is a PIN plex.tv created for one sign-in.
type Pin struct {
	ID   int64
	Code string
}

// Account is a plex.tv account.
type Account struct {
	ID       int64
	UUID     string
	Username string
	// Title is the account's display name; a Plex Home user may have no Username.
	Title string
	Thumb string
}

// Name is what the account is called: its username, else its title.
func (a Account) Name() string {
	if a.Username != "" {
		return a.Username
	}
	return a.Title
}

// Matches reports whether the account's username or title is one of names, ignoring case.
func (a Account) Matches(names []string) bool {
	return NameMatches(a.Username, a.Title, names)
}

// NameMatches reports whether username or title (when not empty) equals one of names, ignoring case.
func NameMatches(username, title string, names []string) bool {
	for _, n := range names {
		for _, have := range []string{username, title} {
			if have != "" && strings.EqualFold(strings.TrimSpace(n), have) {
				return true
			}
		}
	}
	return false
}

// request sends one call and returns the body of a 2xx answer. A 404 is
// ErrPinGone only where the caller says so; 401 is ErrTokenRejected.
func (c *Client) request(ctx context.Context, method, rawURL, clientID, token string, accept string) (int, []byte, error) {
	req, err := http.NewRequestWithContext(ctx, method, rawURL, nil)
	if err != nil {
		return 0, nil, fmt.Errorf("%w: bad URL", ErrUnavailable)
	}
	req.Header.Set("Accept", accept)
	req.Header.Set("X-Plex-Product", product)
	req.Header.Set("X-Plex-Version", c.version)
	req.Header.Set("X-Plex-Client-Identifier", clientID)
	if token != "" {
		req.Header.Set("X-Plex-Token", token)
	}
	res, err := c.http.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return 0, nil, ctx.Err()
		}
		var ue *url.Error
		if errors.As(err, &ue) {
			err = ue.Err // url.Error embeds the URL
		}
		return 0, nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, maxBody))
	if err != nil {
		return 0, nil, fmt.Errorf("%w: reading the answer: %v", ErrUnavailable, err)
	}
	switch {
	case res.StatusCode == http.StatusUnauthorized:
		return res.StatusCode, nil, ErrTokenRejected
	case res.StatusCode/100 != 2 && res.StatusCode != http.StatusNotFound:
		return res.StatusCode, nil, fmt.Errorf("%w: HTTP %d", ErrUnavailable, res.StatusCode)
	}
	return res.StatusCode, raw, nil
}

type pinJSON struct {
	ID        int64   `json:"id"`
	Code      string  `json:"code"`
	AuthToken *string `json:"authToken"`
}

// CreatePin asks plex.tv for a strong PIN.
func (c *Client) CreatePin(ctx context.Context, clientID string) (Pin, error) {
	status, raw, err := c.request(ctx, http.MethodPost, c.base+"/api/v2/pins?strong=true", clientID, "", "application/json")
	if err != nil {
		return Pin{}, err
	}
	var p pinJSON
	if status == http.StatusNotFound || json.Unmarshal(raw, &p) != nil || p.ID == 0 || p.Code == "" {
		return Pin{}, fmt.Errorf("%w: plex.tv sent no PIN", ErrUnavailable)
	}
	return Pin{ID: p.ID, Code: p.Code}, nil
}

// AuthURL is the plex.tv page that asks the account to authorise pin, and
// sends the browser on to forwardURL afterwards.
func (c *Client) AuthURL(clientID string, pin Pin, forwardURL string) string {
	return c.app + "#?clientID=" + url.QueryEscape(clientID) + "&code=" + url.QueryEscape(pin.Code) +
		"&forwardUrl=" + url.QueryEscape(forwardURL) + "&context%5Bdevice%5D%5Bproduct%5D=" + product
}

// PinToken is the token the account authorised pin with, or "" while it has not.
// ErrPinGone says the PIN is unknown or has expired.
func (c *Client) PinToken(ctx context.Context, clientID string, pin Pin) (string, error) {
	u := c.base + "/api/v2/pins/" + strconv.FormatInt(pin.ID, 10) + "?code=" + url.QueryEscape(pin.Code)
	status, raw, err := c.request(ctx, http.MethodGet, u, clientID, "", "application/json")
	if err != nil {
		return "", err
	}
	if status == http.StatusNotFound {
		return "", ErrPinGone
	}
	var p pinJSON
	if err := json.Unmarshal(raw, &p); err != nil {
		return "", fmt.Errorf("%w: plex.tv sent no PIN", ErrUnavailable)
	}
	if p.AuthToken == nil {
		return "", nil
	}
	return *p.AuthToken, nil
}

// Account reads the account behind token.
func (c *Client) Account(ctx context.Context, clientID, token string) (Account, error) {
	status, raw, err := c.request(ctx, http.MethodGet, c.base+"/api/v2/user", clientID, token, "application/json")
	if err != nil {
		return Account{}, err
	}
	var u struct {
		ID       int64  `json:"id"`
		UUID     string `json:"uuid"`
		Username string `json:"username"`
		Title    string `json:"title"`
		Thumb    string `json:"thumb"`
	}
	if status == http.StatusNotFound || json.Unmarshal(raw, &u) != nil || u.ID == 0 {
		return Account{}, fmt.Errorf("%w: plex.tv sent no account", ErrUnavailable)
	}
	return Account{ID: u.ID, UUID: u.UUID, Username: u.Username, Title: u.Title, Thumb: u.Thumb}, nil
}

// SharedUser is someone the owner shares with: a friend, or a member of the owner's Plex Home.
type SharedUser struct {
	ID       int64
	Username string
	Title    string
	Home     bool
	// Servers are the machine identifiers of the servers shared with the user.
	Servers []string
}

// SharedUsers reads the owner's friends and Plex Home members.
func (c *Client) SharedUsers(ctx context.Context, clientID, ownerToken string) ([]SharedUser, error) {
	status, raw, err := c.request(ctx, http.MethodGet, c.base+"/api/users", clientID, ownerToken, "application/xml")
	if err != nil {
		return nil, err
	}
	var doc struct {
		Users []struct {
			ID       int64  `xml:"id,attr"`
			Username string `xml:"username,attr"`
			Title    string `xml:"title,attr"`
			Home     string `xml:"home,attr"`
			Servers  []struct {
				MachineIdentifier string `xml:"machineIdentifier,attr"`
			} `xml:"Server"`
		} `xml:"User"`
	}
	if status == http.StatusNotFound || xml.Unmarshal(raw, &doc) != nil {
		return nil, fmt.Errorf("%w: plex.tv sent no users", ErrUnavailable)
	}
	out := make([]SharedUser, 0, len(doc.Users))
	for _, u := range doc.Users {
		su := SharedUser{ID: u.ID, Username: u.Username, Title: u.Title, Home: u.Home == "1"}
		for _, s := range u.Servers {
			su.Servers = append(su.Servers, s.MachineIdentifier)
		}
		out = append(out, su)
	}
	return out, nil
}

// MachineIdentifier asks the Plex server at plexURL who it is.
func (c *Client) MachineIdentifier(ctx context.Context, clientID, plexURL, ownerToken string) (string, error) {
	status, raw, err := c.request(ctx, http.MethodGet, strings.TrimRight(plexURL, "/")+"/identity", clientID, ownerToken, "application/json")
	if errors.Is(err, ErrTokenRejected) {
		err = fmt.Errorf("%w: the Plex server rejected the token", ErrUnavailable)
	}
	if err != nil {
		return "", err
	}
	var id struct {
		MediaContainer struct {
			MachineIdentifier string `json:"machineIdentifier"`
		} `json:"MediaContainer"`
	}
	if status == http.StatusNotFound || json.Unmarshal(raw, &id) != nil || id.MediaContainer.MachineIdentifier == "" {
		return "", fmt.Errorf("%w: that is not a Plex server (is its URL right?)", ErrUnavailable)
	}
	return id.MediaContainer.MachineIdentifier, nil
}

// HasAccess reports whether acct may use the Plex server at plexURL, by what
// the owner's token (ownerToken) can see: acct is the owner, a member of the
// owner's Plex Home, or a friend with a share that includes this server. An
// error means the answer is not known (ErrUnavailable or ErrTokenRejected for
// the owner's token), never "no".
func (c *Client) HasAccess(ctx context.Context, clientID, plexURL, ownerToken string, acct Account) (bool, error) {
	owner, err := c.Account(ctx, clientID, ownerToken)
	if err != nil {
		return false, ownerError(err)
	}
	if owner.ID == acct.ID {
		return true, nil
	}
	users, err := c.SharedUsers(ctx, clientID, ownerToken)
	if err != nil {
		return false, ownerError(err)
	}
	var shared *SharedUser
	for i := range users {
		if users[i].ID == acct.ID {
			shared = &users[i]
			break
		}
	}
	if shared == nil {
		return false, nil
	}
	if shared.Home {
		return true, nil
	}
	machine, err := c.MachineIdentifier(ctx, clientID, plexURL, ownerToken)
	if err != nil {
		return false, err
	}
	for _, s := range shared.Servers {
		if s == machine {
			return true, nil
		}
	}
	return false, nil
}

// ownerError words a rejected owner token as unavailable: Kestrel cannot tell
// who has access, which is not the Requester's doing.
func ownerError(err error) error {
	if errors.Is(err, ErrTokenRejected) {
		return fmt.Errorf("%w: plex.tv rejected the Plex instance's token", ErrUnavailable)
	}
	return err
}
