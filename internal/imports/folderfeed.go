package imports

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/hyprsh/kestrel/internal/imports/db"
	"github.com/hyprsh/kestrel/internal/store"
)

// FolderFeedRetention is how long the folder-change feed keeps its rows.
const FolderFeedRetention = 30 * 24 * time.Hour

// markerPrefix starts every feed marker; the rest is the id of the last row the
// client has seen. This pair of functions is the only place that knows it.
const markerPrefix = "fc1:"

func formatMarker(id int64) string { return markerPrefix + strconv.FormatInt(id, 10) }

func parseMarker(m string) (int64, bool) {
	rest, ok := strings.CutPrefix(m, markerPrefix)
	if !ok || rest == "" {
		return 0, false
	}
	for _, r := range rest {
		if r < '0' || r > '9' {
			return 0, false
		}
	}
	id, err := strconv.ParseInt(rest, 10, 64)
	return id, err == nil
}

// FolderChange is one settled change to a Title folder.
type FolderChange struct {
	Path string
	// Kind is "created", "modified" or "deleted".
	Kind string
	// At is when it was recorded, RFC 3339 UTC.
	At string
}

// FolderChanges is a page of the feed.
type FolderChanges struct {
	Changes    []FolderChange
	NextMarker string
	// Expired: the marker could not be answered; Changes is empty and
	// NextMarker is the current position.
	Expired bool
	// More: changes after NextMarker already exist.
	More bool
}

// FolderFeed is the durable feed of Title folder changes that settled, read by
// other tools (the Silo plugin) through a marker. Pruning deletes a prefix of
// ids and never the newest row, so a marker m is answerable exactly when
// MIN(id)-1 <= m <= MAX(id) (only m == 0 when the feed is empty).
type FolderFeed struct {
	st    *store.Store
	clock func() time.Time
}

// NewFolderFeed returns the feed over st. clock defaults to time.Now.
func NewFolderFeed(st *store.Store, clock func() time.Time) *FolderFeed {
	if clock == nil {
		clock = time.Now
	}
	return &FolderFeed{st: st, clock: clock}
}

func feedTime(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05Z") }

// Record appends a settled change to folder. An existing folder is created when
// the feed's last row for it is absent or deleted, else modified; a folder that
// no longer exists is deleted.
func (f *FolderFeed) Record(ctx context.Context, folder string, exists bool) error {
	tx, err := f.st.Write().BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	q := db.New(tx)
	kind := "deleted"
	if exists {
		kind = "created"
		last, err := q.LastFolderChangeKind(ctx, folder)
		switch {
		case err == nil:
			if last != "deleted" {
				kind = "modified"
			}
		case !errors.Is(err, sql.ErrNoRows):
			return err
		}
	}
	if err := q.InsertFolderChange(ctx, db.InsertFolderChangeParams{At: feedTime(f.clock()), Path: folder, Kind: kind}); err != nil {
		return err
	}
	return tx.Commit()
}

// Changes answers marker: the changes after it, oldest first, at most limit
// (1..1000; out of range means 1000). See the GET /folder-changes description.
func (f *FolderFeed) Changes(ctx context.Context, marker string, limit int) (FolderChanges, error) {
	if limit < 1 || limit > 1000 {
		limit = 1000
	}
	// One read transaction, so the range and the rows are the same snapshot.
	tx, err := f.st.Read().BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return FolderChanges{}, err
	}
	defer tx.Rollback()
	q := db.New(tx)
	r, err := q.FolderChangeRange(ctx)
	if err != nil {
		return FolderChanges{}, err
	}
	head := formatMarker(r.MaxID)
	if marker == "" {
		return FolderChanges{Changes: []FolderChange{}, NextMarker: head}, nil
	}
	m, ok := parseMarker(marker)
	answerable := ok && m <= r.MaxID
	if answerable && r.MaxID > 0 {
		answerable = m >= r.MinID-1
	} else if answerable {
		answerable = m == 0
	}
	if !answerable {
		return FolderChanges{Changes: []FolderChange{}, NextMarker: head, Expired: true}, nil
	}
	rows, err := q.ListFolderChangesAfter(ctx, db.ListFolderChangesAfterParams{ID: m, Limit: int64(limit) + 1})
	if err != nil {
		return FolderChanges{}, fmt.Errorf("folder changes: %w", err)
	}
	out := FolderChanges{Changes: []FolderChange{}, NextMarker: formatMarker(m)}
	if len(rows) > limit {
		out.More = true
		rows = rows[:limit]
	}
	for _, row := range rows {
		out.Changes = append(out.Changes, FolderChange{Path: row.Path, Kind: row.Kind, At: row.At})
		out.NextMarker = formatMarker(row.ID)
	}
	return out, nil
}

// Prune deletes the changes recorded over 30 days ago, as a prefix of ids, and
// never the newest row.
func (f *FolderFeed) Prune(ctx context.Context) error {
	return db.New(f.st.Write()).PruneFolderChanges(ctx, feedTime(f.clock().Add(-FolderFeedRetention)))
}
