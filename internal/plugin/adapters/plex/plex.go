// Package plex is the Plex adapter for media_server.v1. Plex refreshes a
// library section, so the adapter finds the section whose location holds the
// folder and asks for a partial scan of that folder.
package plex

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/hyprsh/kestrel/internal/plugin"
	"github.com/hyprsh/kestrel/internal/plugin/adapters/mediahttp"
	mediaserver "github.com/hyprsh/kestrel/internal/plugin/mediaserver/v1"
)

// ID is the plugin id.
const ID = "plex"

// Client is the Plex adapter.
type Client struct{ http *http.Client }

var _ mediaserver.Server = (*Client)(nil)

// New returns the adapter. A nil httpClient means one with a 30 s timeout.
func New(httpClient *http.Client) *Client { return &Client{http: mediahttp.Client(httpClient)} }

func (*Client) Describe() plugin.Manifest {
	return plugin.Manifest{
		ID: ID, Name: "Plex", Contract: mediaserver.Contract.ID, Version: "1",
		Fields: []plugin.Field{
			{Key: "url", Label: "URL", Type: plugin.FieldURL, Required: true,
				Help: "Where Kestrel reaches Plex, e.g. http://plex:32400."},
			{Key: "token", Label: "Token", Type: plugin.FieldSecret, Required: true,
				Help: "A Plex token (X-Plex-Token) of an account that may scan libraries."},
		},
	}
}

func (c *Client) get(ctx context.Context, conn plugin.Connection, path string, q url.Values) ([]byte, error) {
	base, err := mediahttp.BaseURL(conn)
	if err != nil {
		return nil, err
	}
	tok := conn.String("token")
	u := base + path
	if len(q) > 0 {
		u += "?" + q.Encode()
	}
	_, raw, err := mediahttp.Do(ctx, c.http, mediahttp.Request{
		Method: http.MethodGet, URL: u, Name: "Plex", Secret: tok,
		Header: map[string]string{"X-Plex-Token": tok, "Accept": "application/json"},
	})
	return raw, err
}

type section struct {
	Key      string
	Location []struct{ Path string }
}

func (c *Client) sections(ctx context.Context, conn plugin.Connection) ([]section, error) {
	raw, err := c.get(ctx, conn, "/library/sections", nil)
	if err != nil {
		return nil, err
	}
	var out struct {
		MediaContainer struct{ Directory []section }
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, plugin.Errorf(plugin.CodeUnavailable, "that is not a Plex server (is the URL right?)")
	}
	return out.MediaContainer.Directory, nil
}

func (c *Client) Test(ctx context.Context, conn plugin.Connection) (plugin.TestResult, error) {
	s, err := c.sections(ctx, conn)
	if err != nil {
		return plugin.TestResult{}, err
	}
	return plugin.TestResult{Message: "Plex (" + plural(len(s), "library section") + ")"}, nil
}

func plural(n int, noun string) string {
	if n == 1 {
		return "1 " + noun
	}
	return strconv.Itoa(n) + " " + noun + "s"
}

func (*Client) ListOptions(context.Context, plugin.Connection, string) ([]plugin.Option, error) {
	return nil, plugin.Errorf(plugin.CodeInvalid, "Plex has no live options")
}

// within says whether path is dir or lies below it.
func within(dir, path string) bool {
	dir = strings.TrimRight(dir, "/")
	return path == dir || strings.HasPrefix(path, dir+"/")
}

func (c *Client) Refresh(ctx context.Context, conn plugin.Connection, changes []mediaserver.Change) error {
	secs, err := c.sections(ctx, conn)
	if err != nil {
		return err
	}
	var missing []string
	var first error
	for _, ch := range changes {
		key := ""
		for _, s := range secs {
			for _, l := range s.Location {
				if within(l.Path, ch.Path) {
					key = s.Key
				}
			}
		}
		if key == "" {
			missing = append(missing, ch.Path)
			continue
		}
		_, err := c.get(ctx, conn, "/library/sections/"+url.PathEscape(key)+"/refresh", url.Values{"path": {ch.Path}})
		if err != nil && first == nil {
			first = err
		}
	}
	if first != nil {
		return first
	}
	if len(missing) > 0 {
		return plugin.Errorf(plugin.CodeNotFound, "no Plex library section contains %s", strings.Join(missing, ", "))
	}
	return nil
}
