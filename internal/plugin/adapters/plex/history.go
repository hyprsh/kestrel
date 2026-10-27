package plex

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/hyprsh/kestrel/internal/plugin"
	"github.com/hyprsh/kestrel/internal/plugin/adapters/mediahttp"
	mediaserver "github.com/hyprsh/kestrel/internal/plugin/mediaserver/v1"
)

var _ mediaserver.PlayHistory = (*Client)(nil)

const (
	// historyPage is how many history entries one call asks for, and
	// historyPages how many calls one read makes before it hands back what it
	// has; Plays.Through lets the next read go on from there.
	historyPage  = 200
	historyPages = 25
)

type historyEntry struct {
	Type           string `json:"type"`
	ViewedAt       int64  `json:"viewedAt"`
	GrandparentKey string `json:"grandparentKey"`
	ParentIndex    *int   `json:"parentIndex"`
	Index          *int   `json:"index"`
}

// Plays reads /status/sessions/history/all, which lists the plays of every
// account on the server when the token is the owner's.
func (c *Client) Plays(ctx context.Context, conn plugin.Connection, since time.Time) (mediaserver.Plays, error) {
	var out mediaserver.Plays
	for page := range historyPages {
		q := url.Values{
			"sort":                   {"viewedAt:asc"},
			"X-Plex-Container-Start": {strconv.Itoa(page * historyPage)},
			"X-Plex-Container-Size":  {strconv.Itoa(historyPage)},
		}
		if !since.IsZero() {
			// Plex reads a key that ends in ">" as the filter ">=".
			q.Set("viewedAt>", strconv.FormatInt(since.Unix(), 10))
		}
		raw, err := c.get(ctx, conn, "/status/sessions/history/all", q)
		if err != nil {
			return out, err
		}
		var body struct {
			MediaContainer struct{ Metadata []historyEntry }
		}
		if err := json.Unmarshal(raw, &body); err != nil {
			return out, plugin.Errorf(plugin.CodeUnavailable, "that is not a Plex server (is the URL right?)")
		}
		entries := body.MediaContainer.Metadata
		for _, e := range entries {
			at := time.Unix(e.ViewedAt, 0).UTC()
			if at.After(out.Through) {
				out.Through = at
			}
			if e.Type != "episode" || e.GrandparentKey == "" || e.ParentIndex == nil || e.Index == nil {
				continue
			}
			out.Items = append(out.Items, mediaserver.Play{ViewedAt: at, ShowKey: e.GrandparentKey, Season: *e.ParentIndex, Episode: *e.Index})
		}
		if len(entries) < historyPage {
			break
		}
	}
	return out, nil
}

// ShowGuids reads a show's metadata for its external ids.
func (c *Client) ShowGuids(ctx context.Context, conn plugin.Connection, showKey string) ([]string, error) {
	if !strings.HasPrefix(showKey, "/library/metadata/") || strings.ContainsAny(showKey, "?#") || strings.Contains(showKey, "..") {
		return nil, plugin.Errorf(plugin.CodeInvalid, "%q is not a Plex show", showKey)
	}
	base, err := mediahttp.BaseURL(conn)
	if err != nil {
		return nil, err
	}
	tok := conn.String("token")
	status, raw, err := mediahttp.Do(ctx, c.http, mediahttp.Request{
		Method: http.MethodGet, URL: base + showKey + "?includeGuids=1", Name: "Plex", Secret: tok, OKCodes: []int{http.StatusNotFound},
		Header: map[string]string{"X-Plex-Token": tok, "Accept": "application/json"},
	})
	if err != nil {
		return nil, err
	}
	if status == http.StatusNotFound {
		return nil, plugin.Errorf(plugin.CodeNotFound, "Plex has no item %s", showKey)
	}
	var body struct {
		MediaContainer struct {
			Metadata []struct {
				Legacy string                `json:"guid"`
				Guids  []struct{ ID string } `json:"Guid"`
			}
		}
	}
	if err := json.Unmarshal(raw, &body); err != nil || len(body.MediaContainer.Metadata) == 0 {
		return nil, plugin.Errorf(plugin.CodeUnavailable, "Plex's answer for %s was not what a show looks like", showKey)
	}
	m := body.MediaContainer.Metadata[0]
	var out []string
	for _, g := range m.Guids {
		out = append(out, g.ID)
	}
	if m.Legacy != "" { // the legacy agents name the show here
		out = append(out, m.Legacy)
	}
	return out, nil
}
