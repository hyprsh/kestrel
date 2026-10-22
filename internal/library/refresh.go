package library

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/hyprsh/kestrel/internal/library/db"
	"github.com/hyprsh/kestrel/internal/metadata"
)

// MovieRefresh is a Movie's fresh details from TMDB.
type MovieRefresh struct {
	Details metadata.MovieDetails
	// PrimaryLanguage (ISO 639-1) picks the Primary-Language title.
	PrimaryLanguage string
}

// SeriesRefresh is a Series' fresh details from TMDB and TheTVDB.
type SeriesRefresh struct {
	TMDB            metadata.SeriesDetails
	TVDB            metadata.TVDBSeries
	PrimaryLanguage string
	// Fetching are the ids of the Series' episodes an active Grab is
	// fetching, as the acquire module counts one: a Placeholder Episode among
	// them stays though it holds no file yet.
	Fetching map[int64]bool
}

// Refreshed says what a refresh changed that others must act on.
type Refreshed struct {
	// Renamed is set when the English title or the year changed, which renames
	// the Title's folder and files. Episode titles never do.
	Renamed bool
}

// RefreshRef is a Title that can be refreshed, with what the refresher needs
// to decide whether it is due.
type RefreshRef struct {
	ID          int64
	Kind        Kind
	TMDBID      int
	TVDBID      int
	RefreshedAt time.Time
}

// Refreshable lists the Titles a refresh may touch: every Title whose metadata
// is not frozen.
func (s *Service) Refreshable(ctx context.Context) ([]RefreshRef, error) {
	rows, err := db.New(s.st.Read()).ListRefreshable(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]RefreshRef, len(rows))
	for i, r := range rows {
		out[i] = RefreshRef{ID: r.ID, Kind: Kind(r.Kind), TMDBID: int(r.TmdbID.Int64), TVDBID: int(r.TvdbID.Int64), RefreshedAt: parseTime(r.RefreshedAt)}
	}
	return out, nil
}

// SetMetadataFrozen freezes a Title's metadata (a refresh skips it and its
// stored data stays indefinitely) or unfreezes it.
func (s *Service) SetMetadataFrozen(ctx context.Context, id int64, frozen bool) error {
	q := db.New(s.st.Write())
	if _, err := q.GetTitle(ctx, id); errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	return q.SetMetadataFrozen(ctx, db.SetMetadataFrozenParams{MetadataFrozen: boolInt(frozen), ID: id})
}

// refreshCommon writes the fields TMDB keeps for both kinds and replaces the
// aliases and dates. It reports whether the English title or year changed.
func (s *Service) refreshCommon(ctx context.Context, q *db.Queries, id int64, kind Kind, p db.UpdateTitleMetadataParams, aliases []metadata.Alias, tr []metadata.Translation, extra []string, dates metadata.ReleaseDates) (bool, error) {
	t, err := q.GetTitle(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return false, ErrNotFound
	}
	if err != nil {
		return false, err
	}
	if Kind(t.Kind) != kind {
		return false, fmt.Errorf("library: title %d is a %s", id, t.Kind)
	}
	renamed := p.Title != t.Title || p.Year != t.Year
	p.ID = id
	p.RefreshedAt = ts(s.clock())
	if err := q.UpdateTitleMetadata(ctx, p); err != nil {
		return false, err
	}
	if err := q.DeleteAliasesOfTitle(ctx, id); err != nil {
		return false, err
	}
	for _, al := range aliases {
		if err := q.InsertAlias(ctx, db.InsertAliasParams{TitleID: id, Alias: al.Title, Country: al.Country}); err != nil {
			return false, err
		}
	}
	for _, x := range tr {
		if x.Title == "" {
			continue
		}
		if err := q.InsertAlias(ctx, db.InsertAliasParams{TitleID: id, Alias: x.Title, Country: x.Country, Language: x.Language}); err != nil {
			return false, err
		}
	}
	for _, al := range extra {
		if err := q.InsertAlias(ctx, db.InsertAliasParams{TitleID: id, Alias: al}); err != nil {
			return false, err
		}
	}
	if err := q.DeleteReleaseDatesOfTitle(ctx, id); err != nil {
		return false, err
	}
	for _, r := range dates {
		if err := q.InsertReleaseDate(ctx, db.InsertReleaseDateParams{
			TitleID: id, Country: r.Country, Type: int64(r.Type), Date: ts(r.Date), Certification: r.Certification,
		}); err != nil {
			return false, err
		}
	}
	return renamed, nil
}

// RefreshMovie replaces a Movie's stored metadata with fresh details.
func (s *Service) RefreshMovie(ctx context.Context, id int64, r MovieRefresh) (Refreshed, error) {
	d := r.Details
	primary := d.TitleIn(r.PrimaryLanguage)
	if primary == "" {
		primary = d.Title
	}
	tx, err := s.st.Write().BeginTx(ctx, nil)
	if err != nil {
		return Refreshed{}, err
	}
	defer tx.Rollback()
	voteAverage, voteCount := ratingColumns(d.Rating)
	renamed, err := s.refreshCommon(ctx, db.New(tx), id, Movie, db.UpdateTitleMetadataParams{
		Title: d.Title, OriginalTitle: d.OriginalTitle, PrimaryTitle: primary, Year: nullInt(d.Year),
		OriginalLanguage: d.OriginalLanguage, Overview: d.Overview, Runtime: nullInt(d.Runtime), PosterPath: nullStr(d.PosterPath),
		TmdbVoteAverage: voteAverage, TmdbVoteCount: voteCount,
	}, d.Aliases, d.Translations, nil, d.ReleaseDates)
	if err != nil {
		return Refreshed{}, err
	}
	return Refreshed{Renamed: renamed}, tx.Commit()
}

// RefreshSeries replaces a Series' stored metadata with fresh details and
// brings its episodes up to date: an episode is matched by its TheTVDB id (else
// by season and number), takes the new name, air date and place, and an episode
// TheTVDB has added is monitored by the Series' mode. Episodes TheTVDB no
// longer lists stay, so files they hold are never orphaned. A Placeholder
// Episode TheTVDB now lists is adopted; one a listed episode moves onto yields
// to it (yieldPlaceholders); one that holds no file and is not among
// r.Fetching is removed.
func (s *Service) RefreshSeries(ctx context.Context, id int64, r SeriesRefresh) (Refreshed, error) {
	d := r.TMDB
	primary := d.TitleIn(r.PrimaryLanguage)
	if primary == "" {
		primary = d.Title
	}
	tx, err := s.st.Write().BeginTx(ctx, nil)
	if err != nil {
		return Refreshed{}, err
	}
	defer tx.Rollback()
	q := db.New(tx)
	voteAverage, voteCount := ratingColumns(d.Rating)
	renamed, err := s.refreshCommon(ctx, q, id, Series, db.UpdateTitleMetadataParams{
		Title: d.Title, OriginalTitle: d.OriginalTitle, PrimaryTitle: primary, Year: nullInt(d.Year),
		OriginalLanguage: d.OriginalLanguage, Overview: d.Overview, Runtime: nullInt(d.Runtime), PosterPath: nullStr(d.PosterPath),
		TmdbVoteAverage: voteAverage, TmdbVoteCount: voteCount,
	}, d.Aliases, d.Translations, r.TVDB.Aliases, d.Ratings)
	if err != nil {
		return Refreshed{}, err
	}
	if err := setSeriesAiring(ctx, q, id, d, r.TVDB); err != nil {
		return Refreshed{}, err
	}
	if err := s.refreshEpisodes(ctx, q, id, r.TVDB.Episodes, r.Fetching); err != nil {
		return Refreshed{}, err
	}
	return Refreshed{Renamed: renamed}, tx.Commit()
}

func (s *Service) refreshEpisodes(ctx context.Context, q *db.Queries, id int64, fresh []metadata.Episode, fetching map[int64]bool) error {
	t, err := q.GetTitle(ctx, id)
	if err != nil {
		return err
	}
	mode := Monitor(t.SeriesMonitor.String)
	have, err := q.ListEpisodesOfTitle(ctx, id)
	if err != nil {
		return err
	}
	byTVDB := map[int64]db.Episode{}
	byRef := map[[2]int64]db.Episode{}
	for _, e := range have {
		if e.TvdbID.Valid {
			byTVDB[e.TvdbID.Int64] = e
		}
		byRef[[2]int64{e.Season, e.Number}] = e
	}
	type change struct {
		ep    db.Episode
		fresh metadata.Episode
	}
	var changes []change
	var added []metadata.Episode
	seen := map[int64]bool{}
	// TheTVDB ids first, so an episode that moves is not taken by another that
	// arrives at its old place.
	byID := map[int]db.Episode{}
	for i, f := range fresh {
		if e, ok := byTVDB[int64(f.ID)]; ok && f.ID != 0 && !seen[e.ID] {
			seen[e.ID] = true
			byID[i] = e
		}
	}
	for i, f := range fresh {
		e, ok := byID[i]
		if !ok {
			e, ok = byRef[[2]int64{int64(f.Season), int64(f.Number)}]
			if !ok || seen[e.ID] {
				added = append(added, f)
				continue
			}
			seen[e.ID] = true
		}
		changes = append(changes, change{e, f})
	}
	moves := map[[2]int64]int64{}
	for _, c := range changes {
		moves[[2]int64{int64(c.fresh.Season), int64(c.fresh.Number)}] = c.ep.ID
	}
	if err := yieldPlaceholders(ctx, q, have, seen, moves); err != nil {
		return err
	}
	airOf := func(f metadata.Episode) sql.NullString {
		if f.Aired == nil {
			return sql.NullString{}
		}
		return sql.NullString{String: f.Aired.Format("2006-01-02"), Valid: true}
	}
	// Episodes that move are parked on a free number first, so two that swap
	// places do not collide.
	for _, c := range changes {
		if int(c.ep.Season) != c.fresh.Season || int(c.ep.Number) != c.fresh.Number {
			if err := q.ParkEpisodeNumber(ctx, c.ep.ID); err != nil {
				return err
			}
		}
	}
	for _, c := range changes {
		tvdb := c.ep.TvdbID
		if c.fresh.ID != 0 {
			tvdb = nullInt(c.fresh.ID)
		}
		primary := c.fresh.PrimaryName
		if primary == "" {
			primary = c.ep.PrimaryName // the translated titles could not be fetched: keep the stored one
		}
		overview := c.fresh.Overview
		if overview == "" {
			overview = c.ep.Overview
		}
		if err := q.UpdateEpisode(ctx, db.UpdateEpisodeParams{
			Season: int64(c.fresh.Season), Number: int64(c.fresh.Number), TvdbID: tvdb, Name: c.fresh.Name, AirDate: airOf(c.fresh),
			PrimaryName: primary, Overview: overview, ID: c.ep.ID,
		}); err != nil {
			return err
		}
	}

	now := s.clock()
	known := map[int64]bool{}
	seasonNums, err := q.ListSeasonNumbers(ctx, id)
	if err != nil {
		return err
	}
	for _, n := range seasonNums {
		known[n] = true
	}
	versions, err := q.ListVersionsOfTitle(ctx, id)
	if err != nil {
		return err
	}
	for _, f := range added {
		on := mode.Valid() && mode.MonitorsEpisode(f.Season, f.Aired, now)
		if err := q.InsertEpisode(ctx, db.InsertEpisodeParams{
			TitleID: id, Season: int64(f.Season), Number: int64(f.Number), TvdbID: nullInt(f.ID), Name: f.Name, AirDate: airOf(f), Monitored: boolInt(on),
			PrimaryName: f.PrimaryName, Overview: f.Overview,
		}); err != nil {
			return err
		}
		if known[int64(f.Season)] {
			continue
		}
		known[int64(f.Season)] = true
		if err := q.InsertSeason(ctx, db.InsertSeasonParams{TitleID: id, Number: int64(f.Season), Monitored: boolInt(on)}); err != nil {
			return err
		}
		if f.Season == 0 {
			continue // Specials are never searched automatically
		}
		for _, v := range versions {
			if err := q.InsertSearchState(ctx, db.InsertSearchStateParams{
				VersionID: v.ID, Season: sql.NullInt64{Int64: int64(f.Season), Valid: true},
				NextMissingAt: sql.NullString{String: ts(now), Valid: true}, NextUpgradeAt: sql.NullString{String: ts(now), Valid: true},
			}); err != nil {
				return err
			}
		}
	}
	strays, err := q.ListFilelessPlaceholders(ctx, id)
	if err != nil {
		return err
	}
	for _, ep := range strays {
		if fetching[ep] {
			continue
		}
		if err := q.DeleteEpisode(ctx, ep); err != nil {
			return err
		}
	}
	return q.RefreshSeasonsMonitored(ctx, id)
}
