// Package jellyfin is the Jellyfin adapter for media_server.v1. It tells
// Jellyfin which folders changed with POST /Library/Media/Updated.
package jellyfin

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"

	"github.com/hyprsh/kestrel/internal/plugin"
	"github.com/hyprsh/kestrel/internal/plugin/adapters/mediahttp"
	mediaserver "github.com/hyprsh/kestrel/internal/plugin/mediaserver/v1"
)

// ID is the plugin id.
const ID = "jellyfin"

// Client is the Jellyfin adapter.
type Client struct{ http *http.Client }

var _ mediaserver.Server = (*Client)(nil)

// New returns the adapter. A nil httpClient means one with a 30 s timeout.
func New(httpClient *http.Client) *Client { return &Client{http: mediahttp.Client(httpClient)} }

func (*Client) Describe() plugin.Manifest {
	return plugin.Manifest{
		ID: ID, Name: "Jellyfin", Contract: mediaserver.Contract.ID, Version: "1",
		Fields: []plugin.Field{
			{Key: "url", Label: "URL", Type: plugin.FieldURL, Required: true,
				Help: "Where Kestrel reaches Jellyfin, e.g. http://jellyfin:8096."},
			{Key: "api_key", Label: "API key", Type: plugin.FieldSecret, Required: true,
				Help: "Create one in Jellyfin's Dashboard under API Keys."},
		},
	}
}

func (c *Client) request(conn plugin.Connection, method, path string, body []byte) (mediahttp.Request, error) {
	base, err := mediahttp.BaseURL(conn)
	if err != nil {
		return mediahttp.Request{}, err
	}
	key := conn.String("api_key")
	r := mediahttp.Request{
		Method: method, URL: base + path, Name: "Jellyfin", Secret: key,
		Header: map[string]string{"Authorization": `MediaBrowser Token="` + key + `"`},
	}
	if body != nil {
		r.Body = bytes.NewReader(body)
		r.Header["Content-Type"] = "application/json"
	}
	return r, nil
}

func (c *Client) Test(ctx context.Context, conn plugin.Connection) (plugin.TestResult, error) {
	r, err := c.request(conn, http.MethodGet, "/System/Info", nil)
	if err != nil {
		return plugin.TestResult{}, err
	}
	_, raw, err := mediahttp.Do(ctx, c.http, r)
	if err != nil {
		return plugin.TestResult{}, err
	}
	var info struct{ ServerName, Version string }
	if json.Unmarshal(raw, &info) != nil || info.Version == "" {
		return plugin.TestResult{}, plugin.Errorf(plugin.CodeUnavailable, "that is not a Jellyfin server (is the URL right?)")
	}
	return plugin.TestResult{Message: "Jellyfin " + info.Version}, nil
}

func (*Client) ListOptions(context.Context, plugin.Connection, string) ([]plugin.Option, error) {
	return nil, plugin.Errorf(plugin.CodeInvalid, "Jellyfin has no live options")
}

type update struct {
	Path       string
	UpdateType string
}

func (c *Client) Refresh(ctx context.Context, conn plugin.Connection, changes []mediaserver.Change) error {
	updates := make([]update, len(changes))
	for i, ch := range changes {
		t := "Modified"
		switch ch.Kind {
		case mediaserver.Created:
			t = "Created"
		case mediaserver.Deleted:
			t = "Deleted"
		}
		updates[i] = update{Path: ch.Path, UpdateType: t}
	}
	body, err := json.Marshal(struct{ Updates []update }{updates})
	if err != nil {
		return err
	}
	r, err := c.request(conn, http.MethodPost, "/Library/Media/Updated", body)
	if err != nil {
		return err
	}
	_, _, err = mediahttp.Do(ctx, c.http, r)
	return err
}
