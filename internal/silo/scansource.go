package silo

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	pluginv1 "github.com/Silo-Server/silo-plugin-sdk/pkg/pluginproto/silo/plugin/v1"
)

const (
	// maxPollPages bounds the pages one poll reads while Kestrel says there
	// is more. The rest waits for the next poll, which starts at the marker
	// this poll returns.
	maxPollPages = 10
	// pollTimeout bounds all the HTTP time of one poll, well below the five
	// minutes Silo gives PollChanges (the client's 30 s per call still applies).
	pollTimeout = 90 * time.Second
	pageLimit   = 1000
)

// ScanSource is the scan_source.v1 server: it polls Kestrel's folder-change
// feed and returns the Title folders that changed as paths for Silo Autoscan.
// It keeps no state: Silo stores the marker and sends the connection on every
// poll.
type ScanSource struct {
	pluginv1.UnimplementedScanSourceServer
	opts Options
}

// NewScanSource returns a ScanSource.
func NewScanSource(o Options) *ScanSource { return &ScanSource{opts: o} }

// folderChange is one entry of GET /folder-changes. Kind is a growing enum.
type folderChange struct {
	Path string `json:"path"`
	Kind string `json:"kind"`
}

type folderChanges struct {
	Changes    []folderChange `json:"changes"`
	NextMarker string         `json:"next_marker"`
	Expired    bool           `json:"expired"`
	More       bool           `json:"more"`
}

// PollChanges returns the Title folders that changed since req.Marker. The
// errors are written for the operator: Silo stores their text on the source.
// None carries the API key.
func (s *ScanSource) PollChanges(ctx context.Context, req *pluginv1.PollChangesRequest) (*pluginv1.PollChangesResponse, error) {
	conn := req.GetConnection()
	if strings.TrimSpace(conn.GetBaseUrl()) == "" || conn.GetApiKey() == "" {
		return nil, errors.New("no Kestrel connection is bound to this source; bind the Kestrel connection (base URL and API key) in the source's settings")
	}
	cl, err := newClient(s.opts.HTTP, conn.GetBaseUrl(), conn.GetApiKey())
	if err != nil {
		return nil, fmt.Errorf("the Kestrel connection is not usable: %w", err)
	}
	ctx, cancel := context.WithTimeout(ctx, pollTimeout)
	defer cancel()

	marker := req.GetMarker()
	var kinds []folderChange // one per path, in first-seen order, the last kind winning
	index := map[string]int{}
	for page := 1; ; page++ {
		got, err := cl.folderChanges(ctx, marker)
		if err != nil {
			if page > 1 {
				// Pages already read are good and marker is the position after
				// them: return those and let the next poll carry on.
				break
			}
			return nil, s.explain(ctx, cl, err)
		}
		if got.NextMarker == "" {
			return nil, errors.New("the Kestrel server answered an empty marker for its folder changes; update Kestrel and the plugin to matching releases")
		}
		if got.Expired {
			return s.rescanRoots(ctx, cl, got.NextMarker)
		}
		for _, c := range got.Changes {
			p := strings.TrimRight(c.Path, "/")
			if p == "" {
				continue
			}
			if i, ok := index[p]; ok {
				kinds[i].Kind = c.Kind
				continue
			}
			index[p] = len(kinds)
			kinds = append(kinds, folderChange{Path: p, Kind: c.Kind})
		}
		marker = got.NextMarker
		if !got.More || page == maxPollPages {
			break
		}
	}

	resp := &pluginv1.PollChangesResponse{NextMarker: marker}
	for _, c := range kinds {
		resp.Changes = append(resp.Changes, changeFor(c))
	}
	return resp, nil
}

// changeFor maps a folder change to a scan. A folder that exists (created,
// modified, or a kind this plugin does not know yet) is scanned as a subtree.
// A deleted folder is reported without a trailing slash, so Silo scans its
// parent, usually the Root folder: scanning a directory that is gone leaves its
// items alone, and the parent's scan shows the folder missing and marks them so.
func changeFor(c folderChange) *pluginv1.ScanSourceChange {
	scope := pluginv1.ScanSourceChangeScope_SCAN_SOURCE_CHANGE_SCOPE_SUBTREE
	if c.Kind == "deleted" {
		scope = pluginv1.ScanSourceChangeScope_SCAN_SOURCE_CHANGE_SCOPE_AUTO
	}
	return &pluginv1.ScanSourceChange{SourcePath: c.Path, Scope: scope}
}

// rescanRoots answers a marker Kestrel can no longer answer (older than its
// retention, from another Kestrel, or unreadable): it has no list of what
// changed, so every Root folder is reported with a trailing slash, which makes
// Silo scan the directory itself, a full library scan when it is a library
// root. A Kestrel without Root folders has nothing to scan.
func (s *ScanSource) rescanRoots(ctx context.Context, cl *client, next string) (*pluginv1.PollChangesResponse, error) {
	roots, err := cl.rootFolders(ctx)
	if err != nil {
		return nil, s.explain(ctx, cl, err)
	}
	resp := &pluginv1.PollChangesResponse{NextMarker: next}
	seen := map[string]bool{}
	for _, r := range roots {
		p := strings.TrimRight(r, "/") + "/"
		if strings.TrimSpace(r) == "" || seen[p] {
			continue
		}
		seen[p] = true
		resp.Changes = append(resp.Changes, &pluginv1.ScanSourceChange{
			SourcePath: p,
			Scope:      pluginv1.ScanSourceChangeScope_SCAN_SOURCE_CHANGE_SCOPE_AUTO,
		})
	}
	return resp, nil
}

// explain turns a Kestrel error into text for the operator.
func (s *ScanSource) explain(ctx context.Context, cl *client, err error) error {
	var ae *apiError
	switch {
	case errors.As(err, &ae) && ae.Status == http.StatusUnauthorized:
		return errors.New("the Kestrel server rejected the API key (HTTP 401); check the API key on the bound connection")
	case errors.As(err, &ae) && ae.Status == http.StatusNotFound:
		who := "the Kestrel server"
		if _, v, verr := cl.system(ctx); verr == nil && v != "" {
			who = "the Kestrel server (version " + v + ")"
		}
		return fmt.Errorf("%s has no folder-change feed (HTTP 404); update Kestrel to the release matching this plugin", who)
	case errors.As(err, &ae):
		return fmt.Errorf("the Kestrel server could not list its folder changes: %w", err)
	case ctx.Err() != nil:
		return fmt.Errorf("the Kestrel server did not answer in time: %w", ctx.Err())
	}
	return fmt.Errorf("could not reach Kestrel: %w", err)
}

// folderChanges reads one page of GET /folder-changes after marker.
func (c *client) folderChanges(ctx context.Context, marker string) (folderChanges, error) {
	q := url.Values{}
	q.Set("marker", marker)
	q.Set("limit", strconv.Itoa(pageLimit))
	var out folderChanges
	_, err := c.do(ctx, http.MethodGet, "/folder-changes?"+q.Encode(), nil, &out)
	return out, err
}
