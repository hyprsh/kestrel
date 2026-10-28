// Package silo is the Silo adapter for media_server.v1: one POST /api/v2/scan
// per changed folder, authorised with a Silo admin API key. The same key reads
// the playback history of every account for Watch-ahead (mediaserver.PlayHistory).
//
// Silo documents no cheap authenticated check, so Test scans a path that is in
// no library: Silo checks the key first, so a 401/403 means a bad key and any
// other answer (400, 404, 422, or success) proves the key works.
package silo

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
const ID = "silo"

// probePath is what Test scans: a path no library holds.
const probePath = "/kestrel-connection-test"

// Client is the Silo adapter.
type Client struct{ http *http.Client }

var _ mediaserver.Server = (*Client)(nil)

// New returns the adapter. A nil httpClient means one with a 30 s timeout.
func New(httpClient *http.Client) *Client { return &Client{http: mediahttp.Client(httpClient)} }

func (*Client) Describe() plugin.Manifest {
	return plugin.Manifest{
		ID: ID, Name: "Silo", Contract: mediaserver.Contract.ID, Version: "1",
		Fields: []plugin.Field{
			{Key: "url", Label: "URL", Type: plugin.FieldURL, Required: true,
				Help: "Where Kestrel reaches Silo, e.g. http://silo:8080."},
			{Key: "api_key", Label: "Admin API key", Type: plugin.FieldSecret, Required: true,
				Help: "A Silo admin API key (starts with sa_). It scans folders and reads every account's playback history for Watch-ahead."},
		},
	}
}

func (c *Client) scan(ctx context.Context, conn plugin.Connection, path string, tolerate ...int) error {
	base, err := mediahttp.BaseURL(conn)
	if err != nil {
		return err
	}
	key := conn.String("api_key")
	body, err := json.Marshal(struct {
		Path string `json:"path"`
	}{path})
	if err != nil {
		return err
	}
	_, _, err = mediahttp.Do(ctx, c.http, mediahttp.Request{
		Method: http.MethodPost, URL: base + "/api/v2/scan", Body: bytes.NewReader(body), Name: "Silo", Secret: key,
		Header:  map[string]string{"Authorization": "Bearer " + key, "Content-Type": "application/json"},
		OKCodes: tolerate,
	})
	return err
}

func (c *Client) Test(ctx context.Context, conn plugin.Connection) (plugin.TestResult, error) {
	if err := c.scan(ctx, conn, probePath, http.StatusBadRequest, http.StatusNotFound, http.StatusUnprocessableEntity); err != nil {
		return plugin.TestResult{}, err
	}
	return plugin.TestResult{Message: "Silo accepted the API key"}, nil
}

func (*Client) ListOptions(context.Context, plugin.Connection, string) ([]plugin.Option, error) {
	return nil, plugin.Errorf(plugin.CodeInvalid, "Silo has no live options")
}

func (c *Client) Refresh(ctx context.Context, conn plugin.Connection, changes []mediaserver.Change) error {
	var first error
	for _, ch := range changes {
		if err := c.scan(ctx, conn, ch.Path); err != nil && first == nil {
			first = err
		}
	}
	return first
}
