package library

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/hyprsh/kestrel/internal/library/db"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/slot"
)

var (
	// ErrNotASeries rejects a Series-only operation on a Movie.
	ErrNotASeries = errors.New("not a Series")
)

// AddSeries is a Series to add: TMDB's details, TheTVDB's seasons and episodes
// and the household's choices.
type AddSeries struct {
	TMDB metadata.SeriesDetails
	TVDB metadata.TVDBSeries
	// PrimaryLanguage (ISO 639-1) picks the Primary-Language title.
	PrimaryLanguage string
	Monitor         Monitor
	Versions        []VersionSpec
	RootFolder      string
	// Seasons, when not nil, are the seasons monitored at add, Specials
	// included when named; Monitor then decides only seasons that have not
	// started airing, and what arrives later. A season TheTVDB does not list
	// is an *UnknownSeasonError.
	Seasons []int
}

// Season is a season of a Series; season 0 is Specials.
type Season struct {
	Number    int
	Monitored bool
}

// EpisodeCell is one episode's state in one Slot's Version.
type EpisodeCell struct {
	State State
	Score *int // of the file holding it, when there is one
	// HasFile is true when a file holds the episode, even a misfit one (which
	// leaves the cell Wanted).
	HasFile bool
	// File is that file; nil when HasFile is false.
	File *EpisodeFile
}

// EpisodeFile is a file holding one or more episodes of a Version.
type EpisodeFile struct {
	ID   int64
	Path string
	Size int64
	// ParsedRelease is the JSON snapshot Imports wrote; "" when none.
	ParsedRelease string
	// EpisodeIDs are every episode the file holds, in aired order.
	EpisodeIDs []int64
	// Original marks an Original (see File).
	Original bool
}

// Episode is an episode with a cell per Slot that has a Version.
type Episode struct {
	ID     int64
	Season int
	Number int
	Name   string // the original title; "" for a Placeholder Episode
	// PrimaryName is the title in the Primary Language, Name where TheTVDB has
	// no translation or none was fetched yet.
	PrimaryName string
	AirDate     *time.Time // the TheTVDB air date; nil when it has none
	// Released is when it counts as released (releasedOf): the air date, or for
	// an undated episode when a later one was first out. nil while it is not.
	Released  *time.Time
	Monitored bool
	// Placeholder is set for a Placeholder Episode: one Kestrel added because a
	// Release named it before TheTVDB listed it.
	Placeholder bool
	// Cells is indexed by slot.Slot; nil where the Title has no Version.
	Cells [slot.Count]*EpisodeCell
}

func parseDate(s sql.NullString) *time.Time {
	if !s.Valid || s.String == "" {
		return nil
	}
	t, err := time.Parse("2006-01-02", s.String)
	if err != nil {
		return nil
	}
	return &t
}

func boolInt(b bool) int64 {
	if b {
		return 1
	}
	return 0
}

// AddSeries adds a Series with its seasons, episodes and Versions in one
// transaction and returns its id. Monitoring follows the mode (PRD Settled 10)
// or the Seasons asked for;
// each Version's search_state is due now for every season but Specials. A
// Series already in the Library is an *ExistsError.
func (s *Service) AddSeries(ctx context.Context, a AddSeries) (int64, error) {
	if len(a.Versions) == 0 {
		return 0, ErrNoVersions
	}
	if !a.Monitor.Valid() {
		return 0, fmt.Errorf("library: %w %q", ErrUnknownMode, a.Monitor)
	}
	seen := map[slot.Slot]bool{}
	for _, v := range a.Versions {
		if seen[v.Slot] {
			return 0, ErrDuplicateSlot
		}
		seen[v.Slot] = true
	}
	if err := checkSeasons(a.Seasons, a.TVDB.Episodes); err != nil {
		return 0, err
	}
	nowT := s.clock()
	now := ts(nowT)

	tx, err := s.st.Write().BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	q := db.New(tx)

	id, seasons, err := insertSeries(ctx, q, a, nowT)
	if err != nil {
		return 0, err
	}
	for _, v := range a.Versions {
		vid, err := q.InsertVersion(ctx, db.InsertVersionParams{TitleID: id, Slot: v.Slot.Key(), ProfileKey: v.Profile, AddedAt: now})
		if err != nil {
			return 0, fmt.Errorf("library: add the %s Version under %q: %w", v.Slot, v.Profile, err)
		}
		for _, n := range seasons {
			if n == 0 {
				continue // Specials are never searched automatically
			}
			if err := q.InsertSearchState(ctx, db.InsertSearchStateParams{
				VersionID: vid, Season: sql.NullInt64{Int64: int64(n), Valid: true},
				NextMissingAt: sql.NullString{String: now, Valid: true}, NextUpgradeAt: sql.NullString{String: now, Valid: true}, Fresh: 1,
			}); err != nil {
				return 0, err
			}
		}
	}
	return id, tx.Commit()
}

// insertSeries writes a new Series Title with its aliases, ratings, seasons and
// episodes, and returns its id and season numbers. A Series already in the
// Library is an *ExistsError.
func insertSeries(ctx context.Context, q *db.Queries, a AddSeries, nowT time.Time) (int64, []int, error) {
	d := a.TMDB
	primary := d.TitleIn(a.PrimaryLanguage)
	if primary == "" {
		primary = d.Title
	}
	now := ts(nowT)
	existing, err := q.FindTitlesByTMDB(ctx, string(Series))
	if err != nil {
		return 0, nil, err
	}
	for _, e := range existing {
		if e.TmdbID.Int64 == int64(d.TMDBID) {
			return 0, nil, &ExistsError{ID: e.ID}
		}
	}
	if id, err := q.FindTitleByTVDB(ctx, nullInt(a.TVDB.ID)); err == nil {
		return 0, nil, &ExistsError{ID: id}
	} else if !errors.Is(err, sql.ErrNoRows) {
		return 0, nil, err
	}
	voteAverage, voteCount := ratingColumns(d.Rating)
	id, err := q.InsertTitle(ctx, db.InsertTitleParams{
		Kind: string(Series), TmdbID: nullInt(d.TMDBID), TvdbID: nullInt(a.TVDB.ID), ImdbID: nullStr(d.IMDbID),
		Title: d.Title, OriginalTitle: d.OriginalTitle, PrimaryTitle: primary,
		Year: nullInt(d.Year), OriginalLanguage: d.OriginalLanguage, Overview: d.Overview,
		Runtime: nullInt(d.Runtime), PosterPath: nullStr(d.PosterPath), Monitored: 1,
		SeriesMonitor: nullStr(string(a.Monitor)),
		RootFolder:    a.RootFolder, AddedAt: now, RefreshedAt: now,
		TmdbVoteAverage: voteAverage, TmdbVoteCount: voteCount,
	})
	if err != nil {
		return 0, nil, err
	}
	if err := setSeriesAiring(ctx, q, id, d, a.TVDB); err != nil {
		return 0, nil, err
	}
	for _, al := range d.Aliases {
		if err := q.InsertAlias(ctx, db.InsertAliasParams{TitleID: id, Alias: al.Title, Country: al.Country}); err != nil {
			return 0, nil, err
		}
	}
	for _, tr := range d.Translations {
		if tr.Title == "" {
			continue
		}
		if err := q.InsertAlias(ctx, db.InsertAliasParams{TitleID: id, Alias: tr.Title, Country: tr.Country, Language: tr.Language}); err != nil {
			return 0, nil, err
		}
	}
	for _, al := range a.TVDB.Aliases {
		if err := q.InsertAlias(ctx, db.InsertAliasParams{TitleID: id, Alias: al}); err != nil {
			return 0, nil, err
		}
	}
	for _, r := range d.Ratings {
		if err := q.InsertReleaseDate(ctx, db.InsertReleaseDateParams{
			TitleID: id, Country: r.Country, Type: int64(r.Type), Date: ts(r.Date), Certification: r.Certification,
		}); err != nil {
			return 0, nil, err
		}
	}

	eps := append([]metadata.Episode(nil), a.TVDB.Episodes...)
	sort.SliceStable(eps, func(i, j int) bool {
		if eps[i].Season != eps[j].Season {
			return eps[i].Season < eps[j].Season
		}
		return eps[i].Number < eps[j].Number
	})
	seasonMonitored := map[int]bool{}
	started := startedSeasons(eps, nowT)
	var seasons []int
	for _, e := range eps {
		if _, ok := seasonMonitored[e.Season]; !ok {
			seasonMonitored[e.Season] = false
			seasons = append(seasons, e.Season)
		}
		on := a.monitorsAtAdd(e, started, nowT)
		seasonMonitored[e.Season] = seasonMonitored[e.Season] || on
		var air sql.NullString
		if e.Aired != nil {
			air = sql.NullString{String: e.Aired.Format("2006-01-02"), Valid: true}
		}
		if err := q.InsertEpisode(ctx, db.InsertEpisodeParams{
			TitleID: id, Season: int64(e.Season), Number: int64(e.Number), TvdbID: nullInt(e.ID), Name: e.Name, AirDate: air, Monitored: boolInt(on),
			PrimaryName: e.PrimaryName, Overview: e.Overview,
		}); err != nil {
			return 0, nil, err
		}
	}
	for _, n := range seasons {
		if err := q.InsertSeason(ctx, db.InsertSeasonParams{TitleID: id, Number: int64(n), Monitored: boolInt(seasonMonitored[n])}); err != nil {
			return 0, nil, err
		}
	}
	return id, seasons, nil
}

// setSeriesAiring stores a Series' network (TMDB's, else TheTVDB's), its
// TheTVDB status and its air time with the zone it is in. What the providers
// do not say leaves the stored value alone.
func setSeriesAiring(ctx context.Context, q *db.Queries, id int64, d metadata.SeriesDetails, tv metadata.TVDBSeries) error {
	network := d.Network
	if network == "" {
		network = tv.Network
	}
	return q.SetSeriesAiring(ctx, db.SetSeriesAiringParams{
		Network: network, TvdbStatus: tv.Status, AirTime: tv.AirsTime, AirTimezone: tv.AirsTimezone, ID: id,
	})
}

// fileEp is a file covering an episode of a Version.
type fileEp struct {
	version, episode int64
	score            sql.NullInt64
}

// heldMap maps a Version id to the episodes it holds a file for, and to the
// Score of that file.
type heldMap map[int64]map[int64]*int

func heldOf(rows []fileEp) heldMap {
	out := heldMap{}
	for _, r := range rows {
		if out[r.version] == nil {
			out[r.version] = map[int64]*int{}
		}
		var sc *int
		if r.score.Valid {
			n := int(r.score.Int64)
			sc = &n
		}
		out[r.version][r.episode] = sc
	}
	return out
}

// unitsOf are one Series Version's episodes as Units at its added time;
// released is the Series' releasedOf.
func unitsOf(eps []db.Episode, released map[int64]*time.Time, held map[int64]*int, addedAt time.Time) []Unit {
	out := make([]Unit, 0, len(eps))
	for _, e := range eps {
		_, has := held[e.ID]
		out = append(out, Unit{Monitored: e.Monitored == 1, HasFile: has, Released: released[e.ID], AddedAt: addedAt})
	}
	return out
}

// Episodes lists a Series' episodes in aired order, each with a cell per Slot
// that has a Version.
func (s *Service) Episodes(ctx context.Context, titleID int64, view View) ([]Episode, error) {
	q := db.New(s.st.Read())
	t, err := q.GetTitle(ctx, titleID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if Kind(t.Kind) != Series {
		return nil, ErrNotASeries
	}
	versions, err := q.ListVersionsOfTitle(ctx, titleID)
	if err != nil {
		return nil, err
	}
	eps, err := q.ListEpisodesOfTitle(ctx, titleID)
	if err != nil {
		return nil, err
	}
	fe, err := q.ListFileEpisodesOfTitle(ctx, titleID)
	if err != nil {
		return nil, err
	}
	var rows []fileEp
	for _, r := range fe {
		rows = append(rows, fileEp{r.VersionID, r.EpisodeID, r.Score})
	}
	heldBy := heldOf(rows)
	filed, err := filedOfTitle(ctx, q, titleID)
	if err != nil {
		return nil, err
	}
	released := releasedOf(eps, filed, airClockOf(t))
	all, err := q.ListAllFileEpisodesOfTitle(ctx, titleID)
	if err != nil {
		return nil, err
	}
	// A file holding several episodes is one EpisodeFile shared by their cells.
	files := map[int64]*EpisodeFile{}
	fileOf := map[[2]int64]*EpisodeFile{}
	order := map[int64]int{}
	for i, e := range eps {
		order[e.ID] = i
	}
	for _, r := range all {
		f := files[r.FileID]
		if f == nil {
			f = &EpisodeFile{ID: r.FileID, Path: r.Path, Size: r.Size, ParsedRelease: r.ParsedRelease.String}
			files[r.FileID] = f
		}
		f.EpisodeIDs = append(f.EpisodeIDs, r.EpisodeID)
		fileOf[[2]int64{r.VersionID, r.EpisodeID}] = f
	}
	originals, err := originalSet(ctx, q)
	if err != nil {
		return nil, err
	}
	for _, f := range files {
		sort.Slice(f.EpisodeIDs, func(i, j int) bool { return order[f.EpisodeIDs[i]] < order[f.EpisodeIDs[j]] })
		f.Original = originals[f.ID]
	}
	out := make([]Episode, 0, len(eps))
	for _, e := range eps {
		ep := Episode{ID: e.ID, Season: int(e.Season), Number: int(e.Number), Name: e.Name, PrimaryName: e.PrimaryName, AirDate: parseDate(e.AirDate), Released: released[e.ID], Monitored: e.Monitored == 1,
			Placeholder: e.PlaceholderAt.Valid}
		if ep.PrimaryName == "" {
			ep.PrimaryName = ep.Name
		}
		for _, v := range versions {
			score, has := heldBy[v.ID][e.ID]
			st, _ := StateAt(Unit{Monitored: ep.Monitored, HasFile: has, Released: ep.Released, AddedAt: parseTime(v.AddedAt)}, view.Now)
			f := fileOf[[2]int64{v.ID, e.ID}]
			ep.Cells[slotOf(v.Slot)] = &EpisodeCell{State: st, Score: score, HasFile: f != nil, File: f}
		}
		out = append(out, ep)
	}
	return out, nil
}

// seriesOf loads a Title and checks it is a Series.
func (s *Service) seriesTx(ctx context.Context, q *db.Queries, id int64) error {
	t, err := q.GetTitle(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if Kind(t.Kind) != Series {
		return ErrNotASeries
	}
	return nil
}

func (s *Service) writeSeries(ctx context.Context, id int64, fn func(q *db.Queries) error) error {
	tx, err := s.st.Write().BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	q := db.New(tx)
	if err := s.seriesTx(ctx, q, id); err != nil {
		return err
	}
	if err := fn(q); err != nil {
		return err
	}
	if err := q.RefreshSeasonsMonitored(ctx, id); err != nil {
		return err
	}
	return tx.Commit()
}

// SetSeriesMonitor changes a Series' mode and applies it to every episode and
// season now, Specials excepted.
func (s *Service) SetSeriesMonitor(ctx context.Context, id int64, mode Monitor) error {
	if !mode.Valid() {
		return fmt.Errorf("library: %w %q", ErrUnknownMode, mode)
	}
	return s.writeSeries(ctx, id, func(q *db.Queries) error {
		_, err := applySeriesMode(ctx, q, id, mode, s.clock())
		return err
	})
}

// applySeriesMode sets a Series' mode and applies it to every episode, and
// reports whether that changed anything. The caller refreshes the seasons.
func applySeriesMode(ctx context.Context, q *db.Queries, id int64, mode Monitor, now time.Time) (bool, error) {
	t, err := q.GetTitle(ctx, id)
	if err != nil {
		return false, err
	}
	changed := t.SeriesMonitor.String != string(mode)
	if changed {
		if err := q.SetSeriesMonitor(ctx, db.SetSeriesMonitorParams{SeriesMonitor: nullStr(string(mode)), ID: id}); err != nil {
			return false, err
		}
	}
	eps, err := q.ListEpisodesOfTitle(ctx, id)
	if err != nil {
		return false, err
	}
	for _, e := range eps {
		on := boolInt(mode.MonitorsEpisode(int(e.Season), parseDate(e.AirDate), now))
		if on == e.Monitored {
			continue
		}
		changed = true
		if err := q.SetEpisodeMonitored(ctx, db.SetEpisodeMonitoredParams{Monitored: on, ID: e.ID}); err != nil {
			return false, err
		}
	}
	return changed, nil
}

// SetSeasonMonitored monitors or unmonitors a season and all its episodes.
func (s *Service) SetSeasonMonitored(ctx context.Context, id int64, season int, monitored bool) error {
	return s.writeSeries(ctx, id, func(q *db.Queries) error {
		seasons, err := q.ListSeasonsOfTitle(ctx, id)
		if err != nil {
			return err
		}
		found := false
		for _, se := range seasons {
			found = found || int(se.Number) == season
		}
		if !found {
			return ErrNotFound
		}
		if err := q.SetSeasonEpisodesMonitored(ctx, db.SetSeasonEpisodesMonitoredParams{Monitored: boolInt(monitored), TitleID: id, Season: int64(season)}); err != nil {
			return err
		}
		return q.SetSeasonMonitored(ctx, db.SetSeasonMonitoredParams{Monitored: boolInt(monitored), TitleID: id, Number: int64(season)})
	})
}

// SetEpisodesMonitored monitors or unmonitors episodes of a Series. An id that
// is not one of the Series' episodes is ErrNotFound and changes nothing.
func (s *Service) SetEpisodesMonitored(ctx context.Context, id int64, episodeIDs []int64, monitored bool) error {
	return s.writeSeries(ctx, id, func(q *db.Queries) error {
		eps, err := q.ListEpisodesOfTitle(ctx, id)
		if err != nil {
			return err
		}
		own := map[int64]bool{}
		for _, e := range eps {
			own[e.ID] = true
		}
		for _, eid := range episodeIDs {
			if !own[eid] {
				return ErrNotFound
			}
		}
		for _, eid := range episodeIDs {
			if err := q.SetEpisodeMonitored(ctx, db.SetEpisodeMonitoredParams{Monitored: boolInt(monitored), ID: eid}); err != nil {
				return err
			}
		}
		return nil
	})
}
