package library

import (
	"context"
	"database/sql"
	"time"

	"github.com/hyprsh/kestrel/internal/library/db"
)

// Due is a Version whose search_state says it is due a search.
type Due struct {
	VersionID int64
	TitleID   int64
	// Fresh is true when the Version was never searched: its search is the
	// search on add (or after a Request), not a sweep.
	Fresh bool
	// Episodes is how many Wanted episodes a Series Version's search covers
	// (0 for a Movie), for the search status's "12 Versions · 340 episodes".
	Episodes int
	// RequestedBy is the history.Trigger key of the person who made the Version due now by hand (a bulk Search),
	// "" for one that came due by the schedule.
	RequestedBy string
}

// RequestSearch makes a Version due a missing search now; the caller
// kicks the sweep. A canceled Grab that was blocklisted uses it to retry.
func (s *Service) RequestSearch(ctx context.Context, versionID int64) error {
	return db.New(s.st.Write()).SetNextMissing(ctx, db.SetNextMissingParams{
		NextMissingAt: sql.NullString{String: ts(s.clock()), Valid: true}, VersionID: versionID,
	})
}

// NextSearch is when a Version is next searched: for what it is missing, and for an Upgrade. A Series Version is
// searched per season, so these are the earliest of its seasons. Nil when the Version has no search to come (an
// unmonitored Title has none).
type NextSearch struct {
	Missing, Upgrade *time.Time
}

// NextSearches returns, for each Version of a Title, when its next search is due.
func (s *Service) NextSearches(ctx context.Context, titleID int64) (map[int64]NextSearch, error) {
	rows, err := db.New(s.st.Read()).ListSearchStatesOfTitle(ctx, titleID)
	if err != nil {
		return nil, err
	}
	out := nextSearchesOf(rows)
	return out, s.sweepNextMissing(ctx, out, func(r sweepRow) bool { return r.titleID == titleID })
}

// NextSearchesOf returns when each of the given Versions is next searched, in one query for a list of Titles.
func (s *Service) NextSearchesOf(ctx context.Context, versionIDs []int64) (map[int64]NextSearch, error) {
	rows, err := db.New(s.st.Read()).ListSearchStates(ctx)
	if err != nil {
		return nil, err
	}
	want := make(map[int64]bool, len(versionIDs))
	for _, id := range versionIDs {
		want[id] = true
	}
	kept := rows[:0:0]
	for _, r := range rows {
		if want[r.VersionID] {
			kept = append(kept, db.SearchState(r))
		}
	}
	out := nextSearchesOf(kept)
	return out, s.sweepNextMissing(ctx, out, func(r sweepRow) bool { return want[r.versionID] })
}

// sweepNextMissing replaces, in `out`, the next missing search of each Version by when the sweep searches it: a Wanted
// row's dueAt, the same function the sweep picks Versions by (it pulls a row forward after a newly aired episode). A Series
// Version's is the earliest of its rows, each by its dueAt where it has one and by its stored time where it has not.
func (s *Service) sweepNextMissing(ctx context.Context, out map[int64]NextSearch, keep func(sweepRow) bool) error {
	rows, err := s.sweepRows(ctx, s.clock())
	if err != nil {
		return err
	}
	seen := map[int64]bool{}
	for _, r := range rows {
		if !keep(r) {
			continue
		}
		at, ok := r.dueAt()
		if !ok {
			if r.nextMissing == nil {
				continue
			}
			at = *r.nextMissing
		}
		n := out[r.versionID]
		if !seen[r.versionID] || at.Before(*n.Missing) {
			n.Missing = &at
		}
		seen[r.versionID] = true
		out[r.versionID] = n
	}
	return nil
}

func nextSearchesOf(rows []db.SearchState) map[int64]NextSearch {
	out := map[int64]NextSearch{}
	earliest := func(cur *time.Time, n sql.NullString) *time.Time {
		t := optTime(n)
		if t != nil && (cur == nil || t.Before(*cur)) {
			return t
		}
		return cur
	}
	for _, r := range rows {
		n := out[r.VersionID]
		n.Missing, n.Upgrade = earliest(n.Missing, r.NextMissingAt), earliest(n.Upgrade, r.NextUpgradeAt)
		out[r.VersionID] = n
	}
	return out
}
