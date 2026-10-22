package library

import (
	"context"
	"time"

	"github.com/hyprsh/kestrel/internal/library/db"
)

// ReleaseType is which release of a Movie an Upcoming entry dates.
type ReleaseType string

// The typed release dates Upcoming lists for a Movie.
const (
	TheatricalRelease ReleaseType = "theatrical"
	DigitalRelease    ReleaseType = "digital"
	PhysicalRelease   ReleaseType = "physical"
)

func dayOf(t time.Time) time.Time {
	t = t.UTC()
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

// UpcomingDays is how far past `from` the agenda looks when no end is asked for.
const UpcomingDays = 30

// UpcomingWindow is the agenda's days: from (today in UTC if not given) to
// `to` (UpcomingDays after from if not given).
func UpcomingWindow(now time.Time, from, to *time.Time) (time.Time, time.Time) {
	start := dayOf(now)
	if from != nil {
		start = *from
	}
	end := start.AddDate(0, 0, UpcomingDays)
	if to != nil {
		end = *to
	}
	return start, end
}

// RecentImport is one Import in "Recently added".
type RecentImport struct {
	TitleID int64
	Title   string
	Year    int
	Kind    Kind
	Slot    string
	Release string
	Score   *int
	// ScoreDelta is what an Upgrade gained over the file it replaced; nil for a first Import.
	ScoreDelta *int
	Files      int // how many files the Import brought (a season pack brings many)
	IsUpgrade  bool
	ImportedAt time.Time
}

// RecentWindow is how far back "recently" reaches: the Imports Recently added
// counts and the week Activity's Done stage lists.
const RecentWindow = 7 * 24 * time.Hour

// CountRecentImports is how many Imports the RecentWindow before now brought;
// the files of one Grab count as one.
func (s *Service) CountRecentImports(ctx context.Context, now time.Time) (int, error) {
	n, err := db.New(s.st.Read()).CountImportsSince(ctx, ts(now.Add(-RecentWindow)))
	return int(n), err
}

// RecentImports is the last n Imports, newest first; the files of one Grab
// count as one.
func (s *Service) RecentImports(ctx context.Context, n int) ([]RecentImport, error) {
	q := db.New(s.st.Read())
	// A pack can fill the window with one Import, so look at more files than rows.
	rows, err := q.ListRecentFiles(ctx, int64(n*20))
	if err != nil {
		return nil, err
	}
	var out []RecentImport
	byGrab := map[int64]int{}
	for _, r := range rows {
		if r.GrabID.Valid {
			if i, ok := byGrab[r.GrabID.Int64]; ok {
				out[i].Files++
				continue
			}
		}
		if len(out) == n {
			continue
		}
		t, err := q.GetTitle(ctx, r.TitleID)
		if err != nil {
			return nil, err
		}
		item := RecentImport{
			TitleID: t.ID, Title: t.Title, Year: int(t.Year.Int64), Kind: Kind(t.Kind), Slot: r.Slot, Release: r.ReleaseName,
			Files: 1, IsUpgrade: r.IsUpgrade == 1, ImportedAt: parseTime(r.ImportedAt),
		}
		if r.Score.Valid {
			v := int(r.Score.Int64)
			item.Score = &v
			if r.ReplacedScore.Valid {
				d := v - int(r.ReplacedScore.Int64)
				item.ScoreDelta = &d
			}
		}
		if r.GrabID.Valid {
			byGrab[r.GrabID.Int64] = len(out)
		}
		out = append(out, item)
	}
	return out, nil
}
