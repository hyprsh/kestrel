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

// airClock is when in its air date a Series' episodes air: the time of day
// ("21:00") in the Series' network's time zone. The zero airClock knows no
// time: an episode then airs at the start of its air date (midnight UTC).
type airClock struct {
	at  string // "HH:MM"
	loc *time.Location
}

// airClockOf is the air clock stored on a Title. A time without a zone Kestrel
// can load counts as no time at all.
func airClockOf(t db.Title) airClock {
	if t.AirTime == "" || t.AirTimezone == "" {
		return airClock{}
	}
	loc, err := time.LoadLocation(t.AirTimezone)
	if err != nil {
		return airClock{}
	}
	if _, err := time.Parse("15:04", t.AirTime); err != nil {
		return airClock{}
	}
	return airClock{at: t.AirTime, loc: loc}
}

// known says whether the clock has an air time.
func (c airClock) known() bool { return c.loc != nil }

// moment is when an episode with the air date `day` (midnight UTC) airs.
func (c airClock) moment(day time.Time) time.Time {
	if !c.known() {
		return day
	}
	tod, _ := time.Parse("15:04", c.at)
	return time.Date(day.Year(), day.Month(), day.Day(), tod.Hour(), tod.Minute(), 0, 0, c.loc).UTC()
}

// airOf is the moment an episode airs: its air date read on the clock; nil
// without an air date.
func (c airClock) airOf(e db.Episode) *time.Time {
	day := parseDate(e.AirDate)
	if day == nil {
		return nil
	}
	m := c.moment(*day)
	return &m
}

// releasedOf maps each episode of one Series to when it counts as released,
// nil while it is not. An episode with an air date is released at it. One
// without is released once a later episode of the Series (by season, then
// number; Specials neither count nor are counted) is out, at the earliest such
// moment. An air date is read on the Series' air clock: the air time in the
// network's zone, else the start of the day. filed holds the import time of each episode's earliest file in any
// Version.
func releasedOf(eps []db.Episode, filed map[int64]time.Time, clock airClock) map[int64]*time.Time {
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
		if own := ownRelease(e, clock); own != nil {
			out[e.ID] = own
		} else if e.Season > 0 {
			out[e.ID] = later
		}
		if e.Season > 0 {
			later = earliest(later, outAt(e, filed, clock))
		}
	}
	return out
}

// ownRelease is when an episode is released by its own data alone: its air
// date, or a Placeholder Episode's creation. nil when that says nothing.
func ownRelease(e db.Episode, clock airClock) *time.Time {
	if at := placeholderAt(e); at != nil {
		return at
	}
	return clock.airOf(e)
}

// placeholderAt is when a Placeholder Episode was created; nil for a listed episode.
func placeholderAt(e db.Episode) *time.Time {
	if !e.PlaceholderAt.Valid {
		return nil
	}
	at := parseTime(e.PlaceholderAt.String)
	return &at
}

// outAt is when an episode was out, so that every undated episode before it
// counts as released: when it aired, when it was added as a Placeholder
// Episode, or when a file for it was first imported, whichever came first. nil
// when none happened.
func outAt(e db.Episode, filed map[int64]time.Time, clock airClock) *time.Time {
	at := earliest(clock.airOf(e), placeholderAt(e))
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
