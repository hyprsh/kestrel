// Package health owns health_issues: the conditions that show in Needs attention
// and clear themselves when they go (PRD story 84-86; #17). Any module that
// notices a problem it cannot fix itself raises a row; the same module clears it
// when the problem is gone.
//
// Raising a new kind of row takes three steps:
//
//  1. Declare a Kind constant here.
//  2. Call Raise(ctx, Issue{Key, Kind, Severity, Message, ...}) where the
//     condition is noticed, and Clear(ctx, key) where it ends. The Key names the
//     condition (kind plus subject, e.g. "refresh_failed:jellyfin"), so a repeat
//     bumps one row instead of adding another. Condition checks that run on a
//     timer register themselves with AddCheck instead.
//  3. Give the kind its actions in internal/api/attention.go (attentionActions).
//
// Stalled Imports and Long Missing are not rows here: the api joins them in
// from acquire and library.
package health

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/hyprsh/kestrel/internal/health/db"
	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/store"
)

// Severity orders Needs attention: Blocking rows come first.
type Severity string

const (
	Blocking Severity = "blocking"
	Warning  Severity = "warning"
)

// Kind says what sort of condition a row is. The api picks a row's actions by it.
type Kind string

const (
	// KindDownloadClient: the download client does not answer or rejects Kestrel (Blocking).
	KindDownloadClient Kind = "download_client_unreachable"
	// KindNoIndexer: nothing can be searched (Blocking).
	KindNoIndexer Kind = "no_indexer"
	// KindRootFolder: a Root folder is missing, not a directory or not writable (Blocking).
	KindRootFolder Kind = "root_folder_unavailable"
	// KindMetadata: a metadata provider fails (Blocking on bad credentials, else a Warning after a day).
	KindMetadata Kind = "metadata_provider_failing"
	// KindIndexer: one indexer fails (Warning).
	KindIndexer Kind = "indexer_failing"
	// KindLowDisk: the data mount is nearly full (Warning).
	KindLowDisk Kind = "low_disk_space"
	// KindProxyHeader: the reverse-proxy user header came from an address that is not a trusted proxy (Warning).
	KindProxyHeader Kind = "untrusted_proxy_header"
	// KindSecurityFix: a published GHSA covers the running version (Warning).
	KindSecurityFix Kind = "security_fix_available"

	// KindGoneUpstream: the metadata provider deleted or merged a Title's entry (Warning).
	KindGoneUpstream Kind = "title_gone_upstream"

	// One-off health warnings: dismissible, keyed kind+subject.

	// KindEXDEV: an Import had to copy across filesystems instead of moving.
	KindEXDEV Kind = "exdev"
	// KindRefreshFailed: a media server refresh failed.
	KindRefreshFailed Kind = "refresh_failed"
	// KindPlexNoSection: a Title folder lies in no Plex library section.
	KindPlexNoSection Kind = "plex_no_section"
)

// Subject is what a row is about, for the actions it offers. Zero fields are unset.
type Subject struct {
	TitleID          int64 `json:"title_id,omitempty"`
	VersionID        int64 `json:"version_id,omitempty"`
	GrabID           int64 `json:"grab_id,omitempty"`
	PluginInstanceID int64 `json:"plugin_instance_id,omitempty"`
}

// Issue is a condition to show. Key is its identity.
type Issue struct {
	Key      string
	Kind     Kind
	Severity Severity
	Subject  Subject
	Message  string
	// Dismissible rows (one-off health warnings) have a Dismiss action; the others
	// stay until the condition goes.
	Dismissible bool
}

// Row is a stored Issue.
type Row struct {
	ID int64
	Issue
	FirstAt time.Time
	LastAt  time.Time
	// Count is how many times the condition was raised since the row appeared.
	Count int
}

var (
	// ErrNotFound means no such row.
	ErrNotFound = errors.New("no such health issue")
	// ErrNotDismissible means the row clears itself only.
	ErrNotDismissible = errors.New("this issue cannot be dismissed")
)

// Deps are what New needs. Checks (checks.go) read the optional ones.
type Deps struct {
	Store   *store.Store
	Clock   func() time.Time
	History *history.Service
	Logger  *slog.Logger

	Checks ChecksDeps
}

// Service raises and clears rows and runs the periodic checks.
type Service struct {
	st    *store.Store
	clock func() time.Time
	hist  *history.Service
	log   *slog.Logger
	deps  ChecksDeps

	mu      sync.Mutex // guards the watches and the checks
	watches watches
	checks  []namedCheck
}

// New returns a Service.
func New(d Deps) *Service {
	if d.Clock == nil {
		d.Clock = time.Now
	}
	if d.Logger == nil {
		d.Logger = slog.Default()
	}
	s := &Service{st: d.Store, clock: d.Clock, hist: d.History, log: d.Logger, deps: d.Checks}
	s.watches = newWatches()
	s.addBuiltinChecks()
	return s
}

func stamp(t time.Time) string { return t.UTC().Format(time.RFC3339) }

// Raise shows the Issue, or bumps the row of the same Key when it already shows
// (a dismissed one shows again). Only a row that appears is recorded in the Log.
func (s *Service) Raise(ctx context.Context, is Issue) error {
	subject, err := json.Marshal(is.Subject)
	if err != nil {
		return err
	}
	now := stamp(s.clock())
	diss := int64(0)
	if is.Dismissible {
		diss = 1
	}
	w := db.New(s.st.Write())
	_, err = db.New(s.st.Read()).GetIssueByKey(ctx, is.Key)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		err = w.InsertIssue(ctx, db.InsertIssueParams{
			Key: is.Key, Kind: string(is.Kind), Severity: string(is.Severity), Subject: string(subject),
			Message: is.Message, Dismissible: diss, FirstAt: now, LastAt: now,
		})
		if err != nil {
			return err
		}
		s.hist.Record(ctx, history.Event{
			Kind: history.HealthRaised, TitleID: is.Subject.TitleID, VersionID: is.Subject.VersionID, GrabID: is.Subject.GrabID,
			Message: is.Message, Data: eventData(is),
		})
		return nil
	case err != nil:
		return err
	}
	return w.BumpIssue(ctx, db.BumpIssueParams{
		Kind: string(is.Kind), Severity: string(is.Severity), Subject: string(subject), Message: is.Message,
		Dismissible: diss, LastAt: now, Key: is.Key,
	})
}

func eventData(is Issue) json.RawMessage {
	b, _ := json.Marshal(map[string]string{"key": is.Key, "kind": string(is.Kind), "severity": string(is.Severity)})
	return b
}

// Clear removes the row of this Key. Clearing a row that is not there is fine.
func (s *Service) Clear(ctx context.Context, key string) error {
	row, err := db.New(s.st.Read()).GetIssueByKey(ctx, key)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	n, err := db.New(s.st.Write()).DeleteIssue(ctx, key)
	if err != nil || n == 0 {
		return err
	}
	s.hist.Record(ctx, history.Event{
		Kind: history.HealthCleared, Message: "Cleared: " + row.Message,
		Data: eventData(Issue{Key: row.Key, Kind: Kind(row.Kind), Severity: Severity(row.Severity)}),
	})
	return nil
}

// ClearExcept clears every row of a kind whose key is not in keep: the way a
// check that owns a kind retires rows whose subject is gone.
func (s *Service) ClearExcept(ctx context.Context, kind Kind, keep ...string) error {
	rows, err := s.all(ctx)
	if err != nil {
		return err
	}
outer:
	for _, r := range rows {
		if r.Kind != kind {
			continue
		}
		for _, k := range keep {
			if r.Key == k {
				continue outer
			}
		}
		if err := s.Clear(ctx, r.Key); err != nil {
			return err
		}
	}
	return nil
}

// List returns the rows that show: dismissed ones are left out. Order is by
// first appearance; the api sorts them for display.
func (s *Service) List(ctx context.Context) ([]Row, error) {
	all, err := s.all(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Row, 0, len(all))
	for _, r := range all {
		if !r.dismissed {
			out = append(out, r.Row)
		}
	}
	return out, nil
}

type storedRow struct {
	Row
	dismissed bool
}

func (s *Service) all(ctx context.Context) ([]storedRow, error) {
	rows, err := db.New(s.st.Read()).ListIssues(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]storedRow, 0, len(rows))
	for _, r := range rows {
		var sub Subject
		if err := json.Unmarshal([]byte(r.Subject), &sub); err != nil {
			return nil, fmt.Errorf("health: stored subject of %s: %w", r.Key, err)
		}
		first, _ := time.Parse(time.RFC3339, r.FirstAt)
		last, _ := time.Parse(time.RFC3339, r.LastAt)
		out = append(out, storedRow{Row: Row{
			ID: r.ID, FirstAt: first, LastAt: last, Count: int(r.Count),
			Issue: Issue{Key: r.Key, Kind: Kind(r.Kind), Severity: Severity(r.Severity), Subject: sub, Message: r.Message, Dismissible: r.Dismissible == 1},
		}, dismissed: r.DismissedAt.Valid})
	}
	return out, nil
}

// Dismiss hides a one-off warning until its condition recurs.
func (s *Service) Dismiss(ctx context.Context, id int64) error {
	n, err := db.New(s.st.Write()).DismissIssue(ctx, db.DismissIssueParams{DismissedAt: sql.NullString{String: stamp(s.clock()), Valid: true}, ID: id})
	if err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	rows, err := s.all(ctx)
	if err != nil {
		return err
	}
	for _, r := range rows {
		if r.ID == id {
			return ErrNotDismissible
		}
	}
	return ErrNotFound
}
