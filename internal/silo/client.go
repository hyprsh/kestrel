// Package silo is Kestrel's Silo request_router.v1 plugin (ADR 0004): it turns a
// Silo Request into a Kestrel Request and reports the status and download
// progress back. It talks only to Kestrel's native Request API, so it links
// none of the server.
package silo

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// APIMajor is the Kestrel API major this plugin build speaks; TestConnection
// fails against any other. A test keeps it equal to api.Major.
const APIMajor = 1

// Wire shapes of the Request API, the parts the plugin reads and writes.

type requester struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type requestTitle struct {
	Kind   string  `json:"kind"`
	TMDBID *int    `json:"tmdb_id,omitempty"`
	TVDBID *int    `json:"tvdb_id,omitempty"`
	IMDbID *string `json:"imdb_id,omitempty"`
}

type slotCreate struct {
	Slot    string  `json:"slot"`
	Profile *string `json:"profile,omitempty"`
}

type requestCreate struct {
	Source          string       `json:"source"`
	SourceRequestID string       `json:"source_request_id"`
	Requester       requester    `json:"requester"`
	Title           requestTitle `json:"title"`
	Slots           []slotCreate `json:"slots"`
	Seasons         *[]int       `json:"seasons,omitempty"`
}

type download struct {
	Phase      string `json:"phase"`
	BytesTotal int64  `json:"bytes_total"`
	BytesLeft  int64  `json:"bytes_left"`
	ETA        *int   `json:"eta"`
}

type requestSlot struct {
	Slot        string    `json:"slot"`
	Profile     *string   `json:"profile"`
	Status      string    `json:"status"`
	StatusLabel string    `json:"status_label"`
	Download    *download `json:"download"`
}

type kestrelRequest struct {
	ID           int64         `json:"id"`
	Outcome      string        `json:"outcome"`
	RejectReason *string       `json:"reject_reason"`
	Slots        []requestSlot `json:"slots"`
}

func (r kestrelRequest) slot(name string) (requestSlot, bool) {
	for _, s := range r.Slots {
		if s.Slot == name {
			return s, true
		}
	}
	return requestSlot{}, false
}

type profile struct {
	Key     string `json:"key"`
	Name    string `json:"name"`
	Slot    string `json:"slot"`
	Enabled bool   `json:"enabled"`
}

// The error texts below carry the phrases Silo's options probe looks for
// (internal/requests/integration_probe.go): "HTTP <status>", "base URL is
// required", "unsupported protocol scheme", "API key is required" and "decode
// response", so Silo marks the base URL or API key field in its form.

// apiError is a non-2xx answer from Kestrel.
type apiError struct {
	Status int
	Code   string
	Detail string
}

func (e *apiError) Error() string {
	if e.Detail != "" {
		return fmt.Sprintf("kestrel answered HTTP %d: %s", e.Status, e.Detail)
	}
	return fmt.Sprintf("kestrel answered HTTP %d", e.Status)
}

// client is one Kestrel connection: base URL (with any routing prefix) and API key.
type client struct {
	base string
	key  string
	http *http.Client
}

func newClient(h *http.Client, baseURL, apiKey string) (*client, error) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		return nil, errors.New("base URL is required")
	}
	u, err := url.Parse(baseURL)
	switch {
	case err != nil || u.Host == "" && (u.Scheme == "http" || u.Scheme == "https"):
		return nil, fmt.Errorf("the base URL %q is not a URL", baseURL)
	case u.Scheme != "http" && u.Scheme != "https":
		return nil, fmt.Errorf("the base URL %q has an unsupported protocol scheme; it needs http:// or https://", baseURL)
	}
	if apiKey == "" {
		return nil, errors.New("API key is required")
	}
	if h == nil {
		h = &http.Client{Timeout: 30 * time.Second}
	}
	return &client{base: baseURL, key: apiKey, http: h}, nil
}

func (c *client) do(ctx context.Context, method, path string, in, out any) (int, error) {
	var body io.Reader
	if in != nil {
		raw, err := json.Marshal(in)
		if err != nil {
			return 0, err
		}
		body = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+"/api/v1"+path, body)
	if err != nil {
		return 0, err
	}
	req.Header.Set("X-Api-Key", c.key)
	req.Header.Set("Accept", "application/json")
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := c.http.Do(req)
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if err != nil {
		return res.StatusCode, err
	}
	if res.StatusCode/100 != 2 {
		var p struct {
			Code   string `json:"code"`
			Detail string `json:"detail"`
			Title  string `json:"title"`
		}
		_ = json.Unmarshal(raw, &p)
		if p.Detail == "" {
			p.Detail = p.Title
		}
		return res.StatusCode, &apiError{Status: res.StatusCode, Code: p.Code, Detail: p.Detail}
	}
	if out != nil {
		if err := json.Unmarshal(raw, out); err != nil {
			return res.StatusCode, fmt.Errorf("kestrel sent an unreadable answer (decode response: %w); is the base URL Kestrel's?", err)
		}
	}
	return res.StatusCode, nil
}

// system reads the API major from GET /system.
func (c *client) system(ctx context.Context) (major int, version string, err error) {
	var out struct {
		Version  string `json:"version"`
		APIMajor int    `json:"api_major"`
	}
	if _, err = c.do(ctx, http.MethodGet, "/system", nil, &out); err != nil {
		return 0, "", err
	}
	return out.APIMajor, out.Version, nil
}

func (c *client) createRequest(ctx context.Context, in requestCreate) (kestrelRequest, error) {
	var out kestrelRequest
	_, err := c.do(ctx, http.MethodPost, "/requests", in, &out)
	return out, err
}

// requests reads the named Requests, at most 100 per call as the API allows.
func (c *client) requests(ctx context.Context, ids []int64) (map[int64]kestrelRequest, error) {
	got := make(map[int64]kestrelRequest, len(ids))
	for start := 0; start < len(ids); start += 100 {
		end := min(start+100, len(ids))
		q := url.Values{}
		for _, id := range ids[start:end] {
			q.Add("id", strconv.FormatInt(id, 10))
		}
		var out struct {
			Items []kestrelRequest `json:"items"`
		}
		if _, err := c.do(ctx, http.MethodGet, "/requests?"+q.Encode(), nil, &out); err != nil {
			return nil, err
		}
		for _, r := range out.Items {
			got[r.ID] = r
		}
	}
	return got, nil
}

func (c *client) profiles(ctx context.Context) ([]profile, error) {
	var out struct {
		Items []profile `json:"items"`
	}
	if _, err := c.do(ctx, http.MethodGet, "/profiles", nil, &out); err != nil {
		return nil, err
	}
	return out.Items, nil
}
