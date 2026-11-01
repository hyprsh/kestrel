package acquire

import (
	"context"
	"database/sql"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire/db"
	"github.com/hyprsh/kestrel/internal/downloads"
	"github.com/hyprsh/kestrel/internal/library"
)

// Why is how a Release came to be grabbed, as it stood when the Grab was made: how many Wanted
// it covers (episodes, or the Movie), how many existing files it replaces and the average gain in
// Score over those files. Who chose it (a search, a person or the RSS sweep) rides on the Grab's
// event.
type Why struct {
	CoversWanted  int
	ReplacesFiles int
	// ScoreDelta is the average Score gain over the replaced files that had a Score; 0 when none had.
	ScoreDelta int
}

// whyOf works out the Why of a Grab about to be sent. It reports false when the library cannot say,
// so the Grab is recorded without one rather than not at all.
func (s *Service) whyOf(ctx context.Context, o outgoing, score int) (Why, bool) {
	view := library.View{Now: s.clock()}
	var w Why
	var gains []int
	if o.media == downloads.Series {
		eps, err := s.lib.Episodes(ctx, o.titleID, view)
		if err != nil {
			return Why{}, false
		}
		for _, ep := range eps {
			c := ep.Cells[o.slot]
			if c == nil || !hasID(o.episodes, ep.ID) {
				continue
			}
			if c.State == library.Wanted {
				w.CoversWanted++
			}
			if c.HasFile {
				w.ReplacesFiles++
				if c.Score != nil {
					gains = append(gains, score-*c.Score)
				}
			}
		}
	} else {
		d, err := s.lib.Get(ctx, o.titleID, view)
		if err != nil {
			return Why{}, false
		}
		for _, v := range d.Versions {
			if v.ID != o.versionID {
				continue
			}
			if v.State == library.Wanted {
				w.CoversWanted = 1
			}
			if v.File != nil {
				w.ReplacesFiles = 1
				if v.File.Score != nil {
					gains = append(gains, score-*v.File.Score)
				}
			}
		}
	}
	if len(gains) > 0 {
		sum := 0
		for _, g := range gains {
			sum += g
		}
		w.ScoreDelta = sum / len(gains)
	}
	return w, true
}

func hasID(ids []int64, id int64) bool {
	for _, x := range ids {
		if x == id {
			return true
		}
	}
	return false
}

func optTime(n sql.NullString) *time.Time {
	if !n.Valid {
		return nil
	}
	t := parseTime(n.String)
	return &t
}

func optInt(n sql.NullInt64) *int {
	if !n.Valid {
		return nil
	}
	v := int(n.Int64)
	return &v
}

// HeldUp counts the Grabs a connection outage that began at since held up: those not yet imported (waited) and those
// lost to the download client since (lost). A zero indexerID counts every Grab; an indexer's outage counts its own.
func (s *Service) HeldUp(ctx context.Context, indexerID int64, since time.Time) (waited, lost int, err error) {
	q := db.New(s.st.Read())
	w, err := q.CountUnfinishedGrabs(ctx, indexerID)
	if err != nil {
		return 0, 0, err
	}
	l, err := q.CountLostGrabsSince(ctx, db.CountLostGrabsSinceParams{Since: ts(since), IndexerID: indexerID})
	return int(w), int(l), err
}
