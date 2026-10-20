package library

import (
	"context"
	"sort"
	"time"

	"github.com/hyprsh/kestrel/internal/library/db"
)

// This file holds the one rule for when an episode counts as released (see
// Wanted in the glossary). It is worked out from stored data whenever it is
// needed, never stored.

// releasedOf maps each episode of one Series to when it counts as released,
// nil while it is not. An episode with an air date is released at it. One
// without is released once a later episode of the Series (by season, then
// number; Specials neither count nor are counted) is out, at the earliest such
// moment. filed holds the import time of each episode's earliest file in any
// Version.
func releasedOf(eps []db.Episode, filed map[int64]time.Time) map[int64]*time.Time {
	order := make([]db.Episode, len(eps))
	copy(order, eps)
	sort.Slice(order, func(i, j int) bool {
		if order[i].Season != order[j].Season {
			return order[i].Season < order[j].Season
		}
		return order[i].Number < order[j].Number
	})
	out := make(map[int64]*time.Time, len(eps))
	var later *time.Time // the earliest moment an episode after this one was out
	for i := len(order) - 1; i >= 0; i-- {
		e := order[i]
		if own := ownRelease(e); own != nil {
			out[e.ID] = own
		} else if e.Season > 0 {
			out[e.ID] = later
		}
		if e.Season > 0 {
			later = earliest(later, outAt(e, filed))
		}
	}
	return out
}

// ownRelease is when an episode is released by its own data alone: its air
// date. nil when that says nothing.
func ownRelease(e db.Episode) *time.Time {
	return parseDate(e.AirDate)
}

// outAt is when an episode was out, so that every undated episode before it
// counts as released: when it aired, or when a file for it was first imported,
// whichever came first. nil when neither happened.
func outAt(e db.Episode, filed map[int64]time.Time) *time.Time {
	at := parseDate(e.AirDate)
	if f, ok := filed[e.ID]; ok {
		at = earliest(at, &f)
	}
	return at
}

func earliest(a, b *time.Time) *time.Time {
	if a == nil || (b != nil && b.Before(*a)) {
		return b
	}
	return a
}

// filedOf maps each episode to when its earliest file was imported.
func filedOf(rows []db.ListFirstFiledRow) map[int64]time.Time {
	out := make(map[int64]time.Time, len(rows))
	for _, r := range rows {
		out[r.EpisodeID] = parseTime(r.ImportedAt)
	}
	return out
}

// filedOfTitle is filedOf for the episodes of one Title.
func filedOfTitle(ctx context.Context, q *db.Queries, titleID int64) (map[int64]time.Time, error) {
	rows, err := q.ListFirstFiledOfTitle(ctx, titleID)
	if err != nil {
		return nil, err
	}
	all := make([]db.ListFirstFiledRow, len(rows))
	for i, r := range rows {
		all[i] = db.ListFirstFiledRow(r)
	}
	return filedOf(all), nil
}
