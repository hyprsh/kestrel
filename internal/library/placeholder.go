package library

import (
	"context"
	"database/sql"
	"errors"
	"slices"
	"time"

	"github.com/hyprsh/kestrel/internal/library/db"
)

// This file holds Placeholder Episodes (ADR 0013): episodes Kestrel adds itself
// because a Release names them before TheTVDB lists them.

// PlaceholderLimit is how far past the last episode TheTVDB lists in a season
// a Placeholder Episode may be added.
const PlaceholderLimit = 2

// Unlisted says whether the episodes a Release names that the Series has no
// episode for may get Placeholder Episodes.
type Unlisted int

const (
	// Qualifies: every one of them may (or there are none).
	Qualifies Unlisted = iota
	// EpisodeNotListed: one is in a season TheTVDB lists but does not qualify:
	// it is beyond PlaceholderLimit, a gap at or below the last listed episode,
	// or its season is not monitored. A Grab by hand may override it.
	EpisodeNotListed
	// SeasonNotListed: one is in a season TheTVDB does not list. Nothing
	// overrides it.
	SeasonNotListed
)

// UnlistedOf are the episodes of season, among numbers, that the Series has no
// episode for (listed or Placeholder), and whether they qualify for
// Placeholder Episodes: each must be in a season TheTVDB lists that is
// monitored, of a Series whose mode monitors a new episode of it, and its
// number past the last listed episode of the season by at most
// PlaceholderLimit. The limit counts from listed episodes only, never from
// Placeholder Episodes. A number at or below the last listed one, a gap in
// what TheTVDB lists, does not qualify: TheTVDB is behind only on episodes
// after its last. A Release qualifies only when every one does.
func UnlistedOf(d Detail, eps []Episode, season int, numbers []int, now time.Time) ([]EpisodeRef, Unlisted) {
	have := map[EpisodeRef]bool{}
	last, listed := 0, false
	for _, e := range eps {
		have[EpisodeRef{e.Season, e.Number}] = true
		if e.Season == season && !e.Placeholder {
			listed = true
			last = max(last, e.Number)
		}
	}
	monitored := slices.ContainsFunc(d.Seasons, func(s Season) bool { return s.Number == season && s.Monitored }) &&
		d.SeriesMonitor.MonitorsEpisode(season, nil, now)
	var out []EpisodeRef
	why := Qualifies
	for _, n := range numbers {
		r := EpisodeRef{season, n}
		if have[r] || slices.Contains(out, r) {
			continue
		}
		out = append(out, r)
		switch {
		case !listed:
			why = SeasonNotListed
		case why == Qualifies && (!monitored || n <= last || n > last+PlaceholderLimit):
			why = EpisodeNotListed
		}
	}
	return out, why
}

// yieldPlaceholders clears the way for listed episodes a refresh moves onto a
// Placeholder Episode's season and number (moves maps each target to the
// episode moving there; seen are the episodes the refresh matched). The listed
// episode wins: in each Version where it holds no file it takes the
// placeholder's; where it holds one, the placeholder's file is dropped from the
// Library and stays on disk as an Unmanaged file. The placeholder is removed.
func yieldPlaceholders(ctx context.Context, q *db.Queries, have []db.Episode, seen map[int64]bool, moves map[[2]int64]int64) error {
	for _, p := range have {
		winner, ok := moves[[2]int64{p.Season, p.Number}]
		if !p.PlaceholderAt.Valid || seen[p.ID] || !ok || winner == p.ID {
			continue
		}
		held, err := q.ListFileEpisodesOfEpisode(ctx, p.ID)
		if err != nil {
			return err
		}
		for _, h := range held {
			_, err := q.GetFileOfVersionEpisode(ctx, db.GetFileOfVersionEpisodeParams{VersionID: h.VersionID, EpisodeID: winner})
			if errors.Is(err, sql.ErrNoRows) {
				if err := q.MoveFileEpisode(ctx, db.MoveFileEpisodeParams{ToEpisode: winner, VersionID: h.VersionID, FromEpisode: p.ID}); err != nil {
					return err
				}
				continue
			}
			if err != nil {
				return err
			}
			if err := q.DeleteFileEpisode(ctx, db.DeleteFileEpisodeParams{VersionID: h.VersionID, EpisodeID: p.ID}); err != nil {
				return err
			}
			if n, err := q.CountFileEpisodes(ctx, h.FileID); err != nil {
				return err
			} else if n == 0 {
				if err := q.DeleteFile(ctx, h.FileID); err != nil {
					return err
				}
			}
		}
		if err := q.DeleteEpisode(ctx, p.ID); err != nil {
			return err
		}
	}
	return nil
}

// AddPlaceholders adds a monitored Placeholder Episode, created now, for each
// ref the Series has no episode at; one already there is kept. A season the
// Series does not have is an *UnknownSeasonError and adds nothing. Whether the
// refs qualify is the caller's business (UnlistedOf): a Grab by hand may add
// one beyond the limit.
func (s *Service) AddPlaceholders(ctx context.Context, titleID int64, refs []EpisodeRef) error {
	if len(refs) == 0 {
		return nil
	}
	at := ts(s.clock())
	return s.writeSeries(ctx, titleID, func(q *db.Queries) error {
		seasons, err := q.ListSeasonNumbers(ctx, titleID)
		if err != nil {
			return err
		}
		for _, r := range refs {
			if !slices.Contains(seasons, int64(r.Season)) {
				return &UnknownSeasonError{Season: r.Season}
			}
			if err := q.InsertPlaceholderEpisode(ctx, db.InsertPlaceholderEpisodeParams{
				TitleID: titleID, Season: int64(r.Season), Number: int64(r.Number), PlaceholderAt: nullStr(at),
			}); err != nil {
				return err
			}
		}
		return nil
	})
}
