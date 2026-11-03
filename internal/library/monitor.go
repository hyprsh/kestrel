package library

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/hyprsh/kestrel/internal/library/db"
)

var (
	// ErrNotAMovie rejects a Movie-only operation on a Series.
	ErrNotAMovie = errors.New("not a Movie")
	// ErrUnknownMode rejects a monitoring mode that is not one of the three.
	ErrUnknownMode = errors.New("unknown monitoring mode")
	// ErrModeContradicts rejects monitoring with MonitorNone, or unmonitoring
	// with a mode other than MonitorNone.
	ErrModeContradicts = errors.New("the monitoring mode contradicts monitored")
)

// MonitorResult is what SetMonitored did to one Title.
type MonitorResult struct {
	TitleID int64
	// Changed is false when the Title already was as asked, or does not exist.
	Changed bool
	// NotFound is true when there is no such Title.
	NotFound bool
}

// SetMonitored monitors or unmonitors Titles, all in one transaction, and says
// per Title whether that changed it; an id given twice counts once. A Movie's
// flag is set: an unmonitored Movie is never Wanted, searched or Upgraded, and
// keeps its Versions and files. A Series follows the same rule through its
// mode: unmonitoring sets MonitorNone, which unmonitors every episode, and
// monitoring applies mode. With mode empty a monitored Series keeps its mode
// and an unmonitored one gets MonitorAll. A Title monitored again has its
// Versions due a search now; the caller kicks the sweep. A mode that is not
// one of the three is ErrUnknownMode; MonitorNone when monitoring, or another
// mode when unmonitoring, is ErrModeContradicts.
func (s *Service) SetMonitored(ctx context.Context, ids []int64, monitored bool, mode Monitor) ([]MonitorResult, error) {
	switch {
	case mode != "" && !mode.Valid():
		return nil, fmt.Errorf("library: %w %q", ErrUnknownMode, mode)
	case monitored && mode == MonitorNone, !monitored && mode != "" && mode != MonitorNone:
		return nil, ErrModeContradicts
	case !monitored:
		mode = MonitorNone
	}
	now := s.clock()
	tx, err := s.st.Write().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	q := db.New(tx)
	out := make([]MonitorResult, 0, len(ids))
	seen := make(map[int64]bool, len(ids))
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		r, err := setMonitored(ctx, q, id, monitored, mode, now)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	for _, r := range out {
		if r.Changed {
			s.recordTitleMonitoring(ctx, r.TitleID, monitored, mode)
		}
	}
	return out, nil
}

// recordTitleMonitoring writes the entry of a Title monitored or unmonitored (a Series with its mode).
func (s *Service) recordTitleMonitoring(ctx context.Context, id int64, monitored bool, mode Monitor) {
	if s.off(ctx) {
		return
	}
	kind, name := s.nameOf(ctx, id)
	msg := titleLabel(kind, name) + " " + onOff(monitored)
	data := map[string]any{"monitored": monitored}
	if kind == Series && mode != "" {
		msg += ", monitoring " + string(mode)
		data["series_monitor"] = string(mode)
	}
	s.recordMonitoring(ctx, id, "title", msg, data)
}

// SetMovieMonitored monitors or unmonitors one Movie, as SetMonitored does;
// ErrNotFound for no such Title and ErrNotAMovie for a Series.
func (s *Service) SetMovieMonitored(ctx context.Context, id int64, monitored bool) error {
	tx, err := s.st.Write().BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	q := db.New(tx)
	t, err := q.GetTitle(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if Kind(t.Kind) != Movie {
		return ErrNotAMovie
	}
	r, err := setMonitored(ctx, q, id, monitored, "", s.clock())
	if err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	if r.Changed {
		s.recordTitleMonitoring(ctx, id, monitored, "")
	}
	return nil
}

func setMonitored(ctx context.Context, q *db.Queries, id int64, monitored bool, mode Monitor, now time.Time) (MonitorResult, error) {
	r := MonitorResult{TitleID: id}
	t, err := q.GetTitle(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		r.NotFound = true
		return r, nil
	}
	if err != nil {
		return r, err
	}
	if Kind(t.Kind) == Series {
		if mode == "" {
			if Monitor(t.SeriesMonitor.String) != MonitorNone {
				return r, nil // monitored already: its mode stays
			}
			mode = MonitorAll
		}
		if r.Changed, err = applySeriesMode(ctx, q, id, mode, now); err != nil {
			return r, err
		}
		if err := q.RefreshSeasonsMonitored(ctx, id); err != nil {
			return r, err
		}
	} else if r.Changed = (t.Monitored == 1) != monitored; r.Changed {
		if err := q.SetTitleMonitored(ctx, db.SetTitleMonitoredParams{Monitored: boolInt(monitored), ID: id}); err != nil {
			return r, err
		}
	}
	if !r.Changed || !monitored {
		return r, nil
	}
	versions, err := q.ListVersionsOfTitle(ctx, id)
	if err != nil {
		return r, err
	}
	due := sql.NullString{String: ts(now), Valid: true}
	for _, v := range versions {
		if err := q.SetNextSearchesAll(ctx, db.SetNextSearchesAllParams{NextMissingAt: due, NextUpgradeAt: due, VersionID: v.ID}); err != nil {
			return r, err
		}
	}
	return r, nil
}

// Monitor is a Series' monitoring mode (PRD Settled 10).
type Monitor string

const (
	// MonitorAll monitors every episode, future ones and new seasons included.
	MonitorAll Monitor = "all"
	// MonitorFuture monitors episodes airing today or later, or without an air
	// date, and new seasons.
	MonitorFuture Monitor = "future"
	// MonitorNone monitors nothing; new episodes arrive unmonitored.
	MonitorNone Monitor = "none"
)

// Valid is whether m is one of the three modes.
func (m Monitor) Valid() bool { return m == MonitorAll || m == MonitorFuture || m == MonitorNone }

// MonitorOptions are the two switches of a Series beside its mode: whether a
// season added later is monitored, and whether Specials follow the mode.
type MonitorOptions struct {
	NewSeasons bool
	Specials   bool
}

// DefaultMonitorOptions are what a Series starts with: new seasons monitored,
// Specials not.
var DefaultMonitorOptions = MonitorOptions{NewSeasons: true}

// Monitors is MonitorsEpisode with the Series' options: Specials follow the
// mode when o.Specials is on. A season that is new (not yet in the Series) is
// left unmonitored when o.NewSeasons is off; the caller says so with newSeason.
func (m Monitor) Monitors(o MonitorOptions, season int, aired *time.Time, now time.Time, newSeason bool) bool {
	if newSeason && !o.NewSeasons {
		return false
	}
	if season == 0 {
		return o.Specials && m.MonitorsEpisode(1, aired, now)
	}
	return m.MonitorsEpisode(season, aired, now)
}

// MonitorsEpisode is whether the mode monitors an episode of season that airs
// on aired (nil: no air date) when applied at now. Specials (season 0) are
// never monitored automatically. An episode airing today still counts as
// future: air dates carry no time of day.
func (m Monitor) MonitorsEpisode(season int, aired *time.Time, now time.Time) bool {
	if season == 0 {
		return false
	}
	switch m {
	case MonitorAll:
		return true
	case MonitorFuture:
		if aired == nil {
			return true
		}
		today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
		return !aired.Before(today)
	}
	return false
}
