// Package sabnzbd is the SABnzbd adapter for download_client.v1. It is stateless:
// every call builds its requests from the Connection it is given.
//
// SABnzbd's API: https://sabnzbd.org/wiki/configuration/5.1/api
package sabnzbd

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/hyprsh/kestrel/internal/plugin"
	downloadclient "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1"
)

// ID is the plugin id.
const ID = "sabnzbd"

// priority is sent on every Add: SABnzbd's "default" priority, so Kestrel never
// jumps or stalls the user's own queue.
const priority = -100

// historyLimit bounds how much finished history List reads; Kestrel polls the
// jobs it created, which are recent.
const historyLimit = 200

// maxBody caps a response we are willing to read.
const maxBody = 32 << 20

// Client is the SABnzbd adapter.
type Client struct {
	http *http.Client
}

var _ downloadclient.Client = (*Client)(nil)

// New returns the adapter. A nil httpClient means a client with a 30 s timeout.
func New(httpClient *http.Client) *Client {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 30 * time.Second}
	}
	return &Client{http: httpClient}
}

func (*Client) Describe() plugin.Manifest {
	return plugin.Manifest{
		ID: ID, Name: "SABnzbd", Contract: downloadclient.Contract.ID, Version: "1",
		Capabilities: map[string][]string{"protocols": {"usenet"}},
		Fields: []plugin.Field{
			{Key: "url", Label: "URL", Type: plugin.FieldURL, Required: true,
				Help: "Where Kestrel reaches SABnzbd, e.g. http://sabnzbd:8080. Add its URL base if it has one."},
			{Key: "api_key", Label: "API key", Type: plugin.FieldSecret, Required: true,
				Help: "SABnzbd's full API key (Config, General), not the NZB key."},
			{Key: "movie_category", Label: "Movie category", Type: plugin.FieldText, Default: "movies", Live: true,
				Help: "The SABnzbd category Movie downloads go to."},
			{Key: "tv_category", Label: "Series category", Type: plugin.FieldText, Default: "tv", Live: true,
				Help: "The SABnzbd category Series downloads go to."},
		},
	}
}

func (c *Client) Test(ctx context.Context, conn plugin.Connection) (plugin.TestResult, error) {
	var v struct {
		Version string `json:"version"`
	}
	// `version` needs no key, so it only proves SABnzbd is there; get_config proves the key.
	if err := c.call(ctx, conn, "version", nil, &v); err != nil {
		return plugin.TestResult{}, err
	}
	if _, err := c.categories(ctx, conn); err != nil {
		return plugin.TestResult{}, err
	}
	if v.Version == "" {
		return plugin.TestResult{Message: "SABnzbd"}, nil
	}
	return plugin.TestResult{Message: "SABnzbd " + v.Version}, nil
}

func (c *Client) ListOptions(ctx context.Context, conn plugin.Connection, field string) ([]plugin.Option, error) {
	if field != "movie_category" && field != "tv_category" {
		return nil, plugin.Errorf(plugin.CodeInvalid, "no live options for %q", field)
	}
	names, err := c.categories(ctx, conn)
	if err != nil {
		return nil, err
	}
	out := make([]plugin.Option, len(names))
	for i, n := range names {
		out[i] = plugin.Option{Value: n, Label: n}
	}
	return out, nil
}

func (c *Client) categories(ctx context.Context, conn plugin.Connection) ([]string, error) {
	var cfg struct {
		Config struct {
			Categories []struct {
				Name string `json:"name"`
			} `json:"categories"`
		} `json:"config"`
	}
	if err := c.call(ctx, conn, "get_config", nil, &cfg); err != nil {
		return nil, err
	}
	names := []string{}
	for _, cat := range cfg.Config.Categories {
		if cat.Name != "" {
			names = append(names, cat.Name)
		}
	}
	return names, nil
}

func (c *Client) Add(ctx context.Context, conn plugin.Connection, req downloadclient.AddRequest) (string, error) {
	if req.Kind != downloadclient.PayloadNZB {
		return "", plugin.Errorf(plugin.CodeInvalid, "SABnzbd takes NZBs, not %q", req.Kind)
	}
	if len(req.Data) == 0 {
		return "", plugin.Errorf(plugin.CodeInvalid, "empty NZB")
	}
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	part, err := mw.CreateFormFile("name", nzbFilename(req.Filename))
	if err != nil {
		return "", err
	}
	_, _ = part.Write(req.Data)
	if err := mw.Close(); err != nil {
		return "", err
	}
	q := url.Values{"priority": {strconv.Itoa(priority)}}
	if req.Category != "" {
		q.Set("cat", req.Category)
	}
	var out struct {
		Status bool     `json:"status"`
		NzoIDs []string `json:"nzo_ids"`
	}
	if err := c.do(ctx, conn, "addfile", q, mw.FormDataContentType(), &body, &out); err != nil {
		return "", err
	}
	if !out.Status || len(out.NzoIDs) == 0 {
		return "", plugin.Errorf(plugin.CodeInvalid, "SABnzbd did not accept the NZB")
	}
	return out.NzoIDs[0], nil
}

var unsafeName = regexp.MustCompile(`[\\/:*?"<>|\x00-\x1f]+`)

// nzbFilename makes the job's file name from the release title: SABnzbd names
// the job after it.
func nzbFilename(title string) string {
	n := strings.Join(strings.Fields(unsafeName.ReplaceAllString(title, " ")), " ")
	n = strings.TrimSuffix(n, ".nzb")
	if n == "" {
		n = "release"
	}
	return n + ".nzb"
}

func (c *Client) List(ctx context.Context, conn plugin.Connection, category string) ([]downloadclient.Item, error) {
	q := url.Values{"start": {"0"}}
	if category != "" {
		q.Set("category", category)
	}
	var queue struct {
		Queue struct {
			Slots []queueSlot `json:"slots"`
		} `json:"queue"`
	}
	qq := cloneValues(q)
	qq.Set("limit", "0")
	if err := c.call(ctx, conn, "queue", qq, &queue); err != nil {
		return nil, err
	}
	var hist struct {
		History struct {
			Slots []historySlot `json:"slots"`
		} `json:"history"`
	}
	hq := cloneValues(q)
	hq.Set("limit", strconv.Itoa(historyLimit))
	if err := c.call(ctx, conn, "history", hq, &hist); err != nil {
		return nil, err
	}

	items := []downloadclient.Item{}
	for _, s := range queue.Queue.Slots {
		if category == "" || s.Cat == category {
			items = append(items, s.item())
		}
	}
	for _, s := range hist.History.Slots {
		if category == "" || s.Category == category {
			items = append(items, s.item())
		}
	}
	return items, nil
}

func cloneValues(v url.Values) url.Values {
	out := make(url.Values, len(v))
	for k, vs := range v {
		out[k] = append([]string(nil), vs...)
	}
	return out
}

func (c *Client) Remove(ctx context.Context, conn plugin.Connection, clientID string, deleteData bool) error {
	del := "0"
	if deleteData {
		del = "1"
	}
	// A job lives in the queue or in history; SABnzbd answers success for an id it
	// does not know, so deleting from both is idempotent.
	for _, mode := range []string{"queue", "history"} {
		q := url.Values{"name": {"delete"}, "value": {clientID}, "del_files": {del}}
		if mode == "history" {
			q.Set("archive", "0")
		}
		var out struct {
			Status bool `json:"status"`
		}
		if err := c.call(ctx, conn, mode, q, &out); err != nil {
			return err
		}
	}
	return nil
}

// ---- mapping ----

const encryptedPrefix = "ENCRYPTED / "

type queueSlot struct {
	NzoID    string `json:"nzo_id"`
	Filename string `json:"filename"`
	Cat      string `json:"cat"`
	Status   string `json:"status"`
	MB       string `json:"mb"`
	MBLeft   string `json:"mbleft"`
	TimeLeft string `json:"timeleft"`
}

func (s queueSlot) item() downloadclient.Item {
	it := downloadclient.Item{
		ClientID:   s.NzoID,
		Name:       strings.TrimPrefix(s.Filename, encryptedPrefix),
		Category:   s.Cat,
		BytesTotal: mbToBytes(s.MB),
		BytesLeft:  mbToBytes(s.MBLeft),
		ETA:        parseTimeLeft(s.TimeLeft),
	}
	switch {
	case strings.HasPrefix(s.Filename, encryptedPrefix):
		it.Phase, it.Failure, it.Message = downloadclient.PhaseFailed, downloadclient.FailureEncrypted, "encrypted"
		it.CanRemove = true
	case s.Status == "Paused":
		it.Phase = downloadclient.PhasePaused
	case s.Status == "Queued", s.Status == "Grabbing", s.Status == "Propagating":
		it.Phase = downloadclient.PhaseQueued
	default:
		it.Phase = downloadclient.PhaseDownloading
	}
	return it
}

type historySlot struct {
	NzoID       string `json:"nzo_id"`
	Name        string `json:"name"`
	Category    string `json:"category"`
	Status      string `json:"status"`
	FailMessage string `json:"fail_message"`
	Storage     string `json:"storage"`
	Bytes       int64  `json:"bytes"`
}

var diskFault = regexp.MustCompile(`(?i)write error|disk is full|disk full|no space left`)

func (s historySlot) item() downloadclient.Item {
	it := downloadclient.Item{
		ClientID:   s.NzoID,
		Name:       s.Name,
		Category:   s.Category,
		BytesTotal: s.Bytes,
		Message:    s.FailMessage,
	}
	switch s.Status {
	case "Completed":
		it.Phase, it.OutputPath, it.CanRemove = downloadclient.PhaseCompleted, s.Storage, true
	case "Failed":
		it.Phase, it.CanRemove = downloadclient.PhaseFailed, true
		it.BytesLeft = s.Bytes
		switch {
		case diskFault.MatchString(s.FailMessage):
			it.Failure = downloadclient.FailureOther
		case strings.Contains(strings.ToLower(s.FailMessage), "encryption detected"):
			it.Failure = downloadclient.FailureEncrypted
		default:
			it.Failure = downloadclient.FailureFailed
		}
	default: // Queued, QuickCheck, Verifying, Repairing, Extracting, Moving, Running
		it.Phase = downloadclient.PhasePostProcessing
	}
	return it
}

func mbToBytes(s string) int64 {
	f, err := strconv.ParseFloat(strings.ReplaceAll(s, ",", ""), 64)
	if err != nil || f < 0 {
		return 0
	}
	return int64(f * 1024 * 1024)
}

// parseTimeLeft reads SABnzbd's H:MM:SS (hours may exceed 24); 0 when unreadable.
func parseTimeLeft(s string) time.Duration {
	parts := strings.Split(s, ":")
	if len(parts) != 3 {
		return 0
	}
	var secs int
	for _, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return 0
		}
		secs = secs*60 + n
	}
	return time.Duration(secs) * time.Second
}

// ---- transport ----

func (c *Client) call(ctx context.Context, conn plugin.Connection, mode string, q url.Values, out any) error {
	return c.do(ctx, conn, mode, q, "", nil, out)
}

// do sends mode with the connection's key. Bodies are POSTed; everything else is a GET.
func (c *Client) do(ctx context.Context, conn plugin.Connection, mode string, q url.Values, contentType string, body io.Reader, out any) error {
	base, err := baseURL(conn)
	if err != nil {
		return err
	}
	key := conn.String("api_key")
	v := url.Values{}
	for k, vs := range q {
		v[k] = vs
	}
	v.Set("mode", mode)
	v.Set("output", "json")
	v.Set("apikey", key)

	method := http.MethodGet
	if body != nil {
		method = http.MethodPost
	}
	req, err := http.NewRequestWithContext(ctx, method, base+"/api?"+v.Encode(), body)
	if err != nil {
		return plugin.Errorf(plugin.CodeInvalid, "bad SABnzbd URL")
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	res, err := c.http.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		// url.Error embeds the request URL, which carries the API key: drop it.
		var ue *url.Error
		if errors.As(err, &ue) {
			err = ue.Err
		}
		return plugin.Errorf(plugin.CodeUnavailable, "cannot reach SABnzbd: %s", redact(err.Error(), key))
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, maxBody))
	if err != nil {
		return plugin.Errorf(plugin.CodeUnavailable, "reading SABnzbd's answer: %s", redact(err.Error(), key))
	}

	switch {
	case res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden:
		return plugin.Errorf(plugin.CodeAuth, "SABnzbd rejected the API key")
	case res.StatusCode != http.StatusOK:
		return plugin.Errorf(plugin.CodeUnavailable, "SABnzbd answered HTTP %d", res.StatusCode)
	}
	if msg, failed := apiError(raw); failed {
		if strings.Contains(strings.ToLower(msg), "api key") {
			return plugin.Errorf(plugin.CodeAuth, "SABnzbd rejected the API key")
		}
		return plugin.Errorf(plugin.CodeUnavailable, "SABnzbd: %s", redact(msg, key))
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return plugin.Errorf(plugin.CodeUnavailable, "SABnzbd answered something that is not its API (is the URL right?)")
	}
	return nil
}

func baseURL(conn plugin.Connection) (string, error) {
	raw := strings.TrimRight(conn.String("url"), "/")
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", plugin.Errorf(plugin.CodeInvalid, "URL must be an http(s) address")
	}
	return raw, nil
}

// apiError recognises SABnzbd's two failure shapes: {"status": false, "error": "..."}
// and a plain "error: ..." text.
func apiError(raw []byte) (string, bool) {
	trimmed := strings.TrimSpace(string(raw))
	if strings.HasPrefix(strings.ToLower(trimmed), "error:") {
		return strings.TrimSpace(trimmed[len("error:"):]), true
	}
	var e struct {
		Status json.RawMessage `json:"status"`
		Error  string          `json:"error"`
	}
	if json.Unmarshal(raw, &e) == nil && string(e.Status) == "false" && e.Error != "" {
		return e.Error, true
	}
	return "", false
}

func redact(s, key string) string {
	if key == "" {
		return s
	}
	return strings.ReplaceAll(s, key, "***")
}
