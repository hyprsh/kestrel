package metadata

import (
	"context"
	"errors"
	"log/slog"
	"sync"
)

// Reasons a Series has no TheTVDB id, for the lookup's `not_addable_reason`.
const (
	ReasonNotOnTVDB       = "not_on_tvdb"
	ReasonTVDBUnavailable = "tvdb_unavailable"
)

// Bridged is a TMDB series' TheTVDB id, or why it has none.
type Bridged struct {
	ID     int
	Reason string
}

// Bridge maps TMDB series to TheTVDB ones, which is where Series episodes
// come from. TMDB's own external ids come first, then a TheTVDB remote-id
// search by IMDb id; a series with neither is not on TheTVDB.
type Bridge struct {
	Meta Provider
	TVDB TVDBProvider
	Log  *slog.Logger
}

// TVDBIDOf is the TheTVDB id of a series: known (an id some source already
// holds) if non-zero, else the remote-id search by IMDb id. 0 means TheTVDB
// does not have it.
func TVDBIDOf(ctx context.Context, tvdb TVDBProvider, known int, imdbID string) (int, error) {
	if known != 0 {
		return known, nil
	}
	if imdbID == "" {
		return 0, nil
	}
	id, ok, err := tvdb.SeriesByIMDb(ctx, imdbID)
	if err != nil || !ok {
		return 0, err
	}
	return id, nil
}

// TVDBID is TVDBIDOf with the Bridge's TheTVDB client.
func (b *Bridge) TVDBID(ctx context.Context, known int, imdbID string) (int, error) {
	return TVDBIDOf(ctx, b.TVDB, known, imdbID)
}

// Lookup bridges every series of a search in parallel. A TMDB series that has
// vanished is not on TheTVDB; a TheTVDB outage greys the result out instead
// of failing the search. Any other TMDB error fails the lookup.
func (b *Bridge) Lookup(ctx context.Context, tmdbIDs []int) (map[int]Bridged, error) {
	out := map[int]Bridged{}
	var (
		mu       sync.Mutex
		wg       sync.WaitGroup
		firstErr error
		sem      = make(chan struct{}, 8)
	)
	for _, id := range tmdbIDs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			var br Bridged
			ext, err := b.Meta.SeriesExternalIDs(ctx, id)
			var me *Error
			switch {
			case errors.As(err, &me) && me.Code == CodeNotFound:
				br, err = Bridged{Reason: ReasonNotOnTVDB}, nil
			case err == nil:
				var tvdbID int
				if tvdbID, err = b.TVDBID(ctx, ext.TVDBID, ext.IMDbID); err != nil {
					b.warn("TheTVDB lookup failed", id, err)
					br, err = Bridged{Reason: ReasonTVDBUnavailable}, nil
				} else if tvdbID == 0 {
					br = Bridged{Reason: ReasonNotOnTVDB}
				} else {
					br = Bridged{ID: tvdbID}
				}
			}
			mu.Lock()
			defer mu.Unlock()
			if err != nil && firstErr == nil {
				firstErr = err
			}
			out[id] = br
		}()
	}
	wg.Wait()
	return out, firstErr
}

func (b *Bridge) warn(msg string, tmdbID int, err error) {
	log := b.Log
	if log == nil {
		log = slog.Default()
	}
	log.Warn(msg, "tmdb_id", tmdbID, "err", err)
}
