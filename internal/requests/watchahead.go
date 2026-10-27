package requests

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/requests/db"
)

// firstSeason is the seasons a Watch-ahead Request starts with: season 1, or
// the lowest numbered season after the specials when the Series has no season 1.
// nil when the Series has no season but the specials.
func firstSeason(have map[int]bool) []int {
	if have[1] {
		return []int{1}
	}
	lowest := 0
	for n := range have {
		if n > 0 && (lowest == 0 || n < lowest) {
			lowest = n
		}
	}
	if lowest == 0 {
		return nil
	}
	return []int{lowest}
}

// WatchAhead is a Request that asks for its Series one season at a time.
type WatchAhead struct {
	RequestID int64
	TitleID   int64
	// Seasons are the seasons the Request holds, ascending.
	Seasons   []int
	CreatedAt time.Time
}

// WatchAheads lists the accepted Watch-ahead Requests whose Title is still
// there, oldest first.
func (s *Service) WatchAheads(ctx context.Context) ([]WatchAhead, error) {
	q := db.New(s.d.Store.Read())
	rows, err := q.ListWatchAheadRequests(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]WatchAhead, 0, len(rows))
	for _, r := range rows {
		seasons, err := q.ListSeasonsOfRequest(ctx, r.ID)
		if err != nil {
			return nil, err
		}
		w := WatchAhead{RequestID: r.ID, TitleID: r.TitleID.Int64}
		w.CreatedAt, _ = time.Parse(time.RFC3339, r.CreatedAt)
		for _, n := range seasons {
			w.Seasons = append(w.Seasons, int(n))
		}
		out = append(out, w)
	}
	return out, nil
}

// AddSeason adds a season of the Request's Series to a Request that named its
// seasons: the season is monitored on every Version and made due a search now.
// Adding a season the Request holds is a no-op, so it can be repeated. The
// caller kicks the search sweep when searchDue.
func (s *Service) AddSeason(ctx context.Context, requestID int64, season int) (searchDue bool, err error) {
	row, err := db.New(s.d.Store.Read()).GetRequest(ctx, requestID)
	if errors.Is(err, sql.ErrNoRows) {
		return false, ErrNotFound
	}
	if err != nil {
		return false, err
	}
	if season < 0 {
		return false, invalid("season", "invalid", "Seasons are numbered from 0")
	}
	if row.Outcome != string(Accepted) || !row.TitleID.Valid {
		return false, invalid("request", "rejected", "The Request was not accepted")
	}
	held, err := db.New(s.d.Store.Read()).ListSeasonsOfRequest(ctx, requestID)
	if err != nil {
		return false, err
	}
	if len(held) == 0 {
		return false, invalid("request", "whole_series", "The Request asks for the whole Series")
	}
	d, err := s.detail(ctx, row.TitleID.Int64, s.cache())
	if err != nil {
		return false, err
	}
	if d == nil || d.Kind != library.Series {
		return false, invalid("request", "no_series", "The Request's Series is not in the Library")
	}
	var found, monitored bool
	for _, se := range d.Seasons {
		if se.Number == season {
			found, monitored = true, se.Monitored
		}
	}
	if !found {
		return false, invalid("season", "not_found", fmt.Sprintf("The Series has no season %d", season))
	}
	// Monitoring comes before the row, so that a pass cut short is redone from
	// the Request's seasons.
	if !monitored {
		if err := s.d.Library.SetSeasonMonitored(ctx, d.ID, season, true); err != nil {
			return false, err
		}
		for _, v := range d.Versions {
			if err := s.d.Library.RequestSeasonSearch(ctx, v.ID, []int{season}); err != nil {
				return false, err
			}
		}
		searchDue = true
	}
	return searchDue, db.New(s.d.Store.Write()).AddRequestSeason(ctx, db.AddRequestSeasonParams{RequestID: requestID, Season: int64(season)})
}
