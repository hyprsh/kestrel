// Package mediahttp is the small HTTP layer the media_server.v1 adapters share:
// build the request from a Connection, and turn every way it can fail into a
// plugin.Error without leaking the credential.
package mediahttp

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/hyprsh/kestrel/internal/plugin"
)

const maxBody = 8 << 20

// Client returns httpClient, or one with a 30 s timeout when it is nil.
func Client(httpClient *http.Client) *http.Client {
	if httpClient == nil {
		return &http.Client{Timeout: 30 * time.Second}
	}
	return httpClient
}

// BaseURL returns the connection's "url" without a trailing slash, or an
// invalid Error.
func BaseURL(conn plugin.Connection) (string, error) {
	raw := strings.TrimRight(conn.String("url"), "/")
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", plugin.Errorf(plugin.CodeInvalid, "URL must be an http(s) address")
	}
	return raw, nil
}

// Request is one call.
type Request struct {
	Method  string
	URL     string
	Header  map[string]string
	Body    io.Reader
	Name    string // the server's name for messages, e.g. "Plex"
	Secret  string // removed from any message
	OKCodes []int  // statuses besides 2xx that count as success
}

// Do sends r and returns the status and body. 401 and 403 are auth Errors, 429
// is rate_limited, everything else non-successful is unavailable.
func Do(ctx context.Context, c *http.Client, r Request) (int, []byte, error) {
	req, err := http.NewRequestWithContext(ctx, r.Method, r.URL, r.Body)
	if err != nil {
		return 0, nil, plugin.Errorf(plugin.CodeInvalid, "bad %s URL", r.Name)
	}
	for k, v := range r.Header {
		req.Header.Set(k, v)
	}
	res, err := c.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return 0, nil, ctx.Err()
		}
		var ue *url.Error
		if errors.As(err, &ue) {
			err = ue.Err // url.Error embeds the URL, which may carry the token
		}
		return 0, nil, plugin.Errorf(plugin.CodeUnavailable, "cannot reach %s: %s", r.Name, redact(err.Error(), r.Secret))
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, maxBody))
	if err != nil {
		return 0, nil, plugin.Errorf(plugin.CodeUnavailable, "reading %s's answer: %s", r.Name, redact(err.Error(), r.Secret))
	}
	switch {
	case res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden:
		return res.StatusCode, raw, plugin.Errorf(plugin.CodeAuth, "%s rejected the credentials", r.Name)
	case res.StatusCode == http.StatusTooManyRequests:
		e := plugin.Errorf(plugin.CodeRateLimited, "%s is rate limiting Kestrel", r.Name)
		e.RetryAfter = retryAfter(res.Header.Get("Retry-After"))
		return res.StatusCode, raw, e
	case res.StatusCode/100 == 2:
		return res.StatusCode, raw, nil
	}
	for _, ok := range r.OKCodes {
		if ok == res.StatusCode {
			return res.StatusCode, raw, nil
		}
	}
	return res.StatusCode, raw, plugin.Errorf(plugin.CodeUnavailable, "%s answered HTTP %d", r.Name, res.StatusCode)
}

func retryAfter(h string) time.Duration {
	d, err := time.ParseDuration(strings.TrimSpace(h) + "s")
	if err != nil || d < 0 {
		return 0
	}
	return d
}

func redact(s, secret string) string {
	if secret == "" {
		return s
	}
	return strings.ReplaceAll(s, secret, "***")
}
