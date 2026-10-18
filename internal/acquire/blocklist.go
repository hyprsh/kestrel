package acquire

import (
	"context"
	"errors"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire/db"
	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/indexers"
)

// BlockEntry is a Release to never grab again.
type BlockEntry struct {
	ReleaseName string
	IndexerID   int64
	GUID        string
	PublishedAt time.Time
	Size        int64
	Reason      string
	// TitleID and GrabID say what it was blocked for, when known.
	TitleID   int64
	VersionID int64
	GrabID    int64
}

// Block adds an entry to the global Blocklist. Entries never expire; they are
// removed by hand.
func (s *Service) Block(ctx context.Context, e BlockEntry) error {
	_, err := db.New(s.st.Write()).InsertBlocklist(ctx, db.InsertBlocklistParams{
		ReleaseName: e.ReleaseName, IndexerID: e.IndexerID, Guid: e.GUID, PublishedAt: ts(e.PublishedAt), Size: e.Size,
		Reason: e.Reason, TitleID: nullID(e.TitleID), GrabID: nullID(e.GrabID), CreatedAt: ts(s.clock()),
	})
	if err == nil {
		s.hist.Record(ctx, history.Event{
			Kind: history.Blocklisted, TitleID: e.TitleID, VersionID: e.VersionID, GrabID: e.GrabID,
			Message: "Blocklisted " + e.ReleaseName + ": " + e.Reason,
		})
	}
	return err
}

// Blocked is one Blocklist entry.
type Blocked struct {
	ID          int64
	ReleaseName string
	IndexerID   int64
	Reason      string
	Size        int64
	PublishedAt time.Time
	CreatedAt   time.Time
	// TitleID and GrabID are 0 when the Title or Grab is gone or was never known.
	TitleID int64
	GrabID  int64
}

// Blocklist lists the entries newest first; a non-zero titleID narrows it to one Title.
func (s *Service) Blocklist(ctx context.Context, titleID int64) ([]Blocked, error) {
	var filter any
	if titleID != 0 {
		filter = titleID
	}
	rows, err := db.New(s.st.Read()).ListBlocklist(ctx, filter)
	if err != nil {
		return nil, err
	}
	out := make([]Blocked, 0, len(rows))
	for _, r := range rows {
		out = append(out, Blocked{
			ID: r.ID, ReleaseName: r.ReleaseName, IndexerID: r.IndexerID, Reason: r.Reason, Size: r.Size,
			PublishedAt: parseTime(r.PublishedAt), CreatedAt: parseTime(r.CreatedAt), TitleID: r.TitleID.Int64, GrabID: r.GrabID.Int64,
		})
	}
	return out, nil
}

// ErrBlockNotFound is returned when removing a Blocklist entry that does not exist.
var ErrBlockNotFound = errors.New("blocklist entry not found")

// Unblock removes an entry, so the Release can be grabbed again.
func (s *Service) Unblock(ctx context.Context, id int64) error {
	n, err := db.New(s.st.Write()).DeleteBlocklist(ctx, id)
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrBlockNotFound
	}
	return nil
}

const (
	sameReleaseWindow = 2 * time.Minute
	sameReleaseSize   = 2 << 20
)

// blocklisted applies the *arr rule: the same indexer's GUID, or the same title
// posted at the same time, or the same title from another indexer posted within
// two minutes with a size within two megabytes.
func (s *Service) blocklisted(ctx context.Context, r indexers.Release) (bool, error) {
	rows, err := db.New(s.st.Read()).FindBlocklisted(ctx, db.FindBlocklistedParams{IndexerID: r.IndexerID, Guid: r.GUID, ReleaseName: r.Title})
	if err != nil {
		return false, err
	}
	for _, row := range rows {
		if row.IndexerID == r.IndexerID && row.Guid == r.GUID {
			return true, nil
		}
		if row.ReleaseName != r.Title {
			continue
		}
		gap := parseTime(row.PublishedAt).Sub(r.PublishDate)
		if row.IndexerID == r.IndexerID && gap == 0 {
			return true, nil
		}
		if row.IndexerID != r.IndexerID && gap.Abs() <= sameReleaseWindow && abs(row.Size-r.Size) <= sameReleaseSize {
			return true, nil
		}
	}
	return false, nil
}

func abs(n int64) int64 {
	if n < 0 {
		return -n
	}
	return n
}
