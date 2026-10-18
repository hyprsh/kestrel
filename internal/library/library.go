// Package library owns the Titles Kestrel manages: their metadata, Versions
// (one per Slot, each under a Profile), files, and the search state that says
// when a Version is next searched. Movies are built; Series join with seasons
// and episodes in the schema already, so a Series Version is the same table row
// as a Movie Version and only its files and search_state rows differ.
//
// library is read and written through the Service. It calls `metadata` for
// types and the release-date fallback and never calls providers itself: the
// caller fetches and hands over the details.
package library

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/hyprsh/kestrel/internal/library/db"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/resolution"
	"github.com/hyprsh/kestrel/internal/store"
)

// Kind is Movie or Series.
type Kind string

const (
	Movie  Kind = "movie"
	Series Kind = "series"
)

// State is what a Version looks like in the Library.
type State string

const (
	Wanted      State = "wanted"      // monitored, released, no file
	Filled      State = "filled"      // has a file
	Downloading State = "downloading" // a Grab is active (set once Grabs exist)
	Unmonitored State = "unmonitored"
	Unreleased  State = "unreleased"
)

// LongMissingAfter is how long a Version stays Wanted before it is Long Missing.
const LongMissingAfter = 90 * 24 * time.Hour

var (
	// ErrNotFound is returned for a Title that does not exist.
	ErrNotFound = errors.New("title not found")
	// ErrNoVersions rejects an add that names no Slot.
	ErrNoVersions = errors.New("a Title needs at least one Version")
	// ErrDuplicateSlot rejects an add that names a Slot twice.
	ErrDuplicateSlot = errors.New("a Slot holds one Version")
)

// ExistsError means the Title is already in the Library.
type ExistsError struct{ ID int64 }

func (e *ExistsError) Error() string { return fmt.Sprintf("already in the library as title %d", e.ID) }

// View is who is looking and when: the release-date country decides whether a
// Movie is released, Now is the clock.
type View struct {
	Country string
	Now     time.Time
}

// Filter narrows List. The zero Filter keeps everything.
type Filter struct {
	Kind Kind
	// Text matches titles and aliases, ignoring case.
	Text string
	// Wanted keeps the Titles with a Wanted Version; LongMissing those with a Long Missing one.
	Wanted, LongMissing bool
	// ByWantedSince puts the Titles Wanted longest first, those not Wanted last,
	// instead of the newest-added first order.
	ByWantedSince bool
}

// VersionSpec names a Slot and the Profile (by key) that fills it.
type VersionSpec struct {
	Slot    resolution.Class
	Profile string
}

// AddMovie is a Movie to add: the provider's details plus the household's choices.
type AddMovie struct {
	Details metadata.MovieDetails
	// PrimaryLanguage (ISO 639-1) picks the Primary-Language title.
	PrimaryLanguage string
	Versions        []VersionSpec
	RootFolder      string
}

// SlotState is one Slot of a listed Title.
type SlotState struct {
	VersionID   int64
	Profile     string
	State       State
	LongMissing bool
	// WantedSince is set while the Version is Wanted.
	WantedSince *time.Time
}

// Row is a compact Library row.
type Row struct {
	ID           int64
	Kind         Kind
	Title        string
	PrimaryTitle string
	Year         int // 0 when unknown
	// Slots is indexed by resolution.Class; nil where the Title has no Version.
	Slots [3]*SlotState
	// WantedSince is the earliest Wanted-since of its Wanted Versions.
	WantedSince *time.Time
	AddedAt     time.Time
}

// File is the file a Version holds.
type File struct {
	ID          int64
	Path        string
	Size        int64
	ReleaseName string
	Score       *int
	// ParsedRelease and Probe are JSON snapshots written by Imports; "" when none.
	ParsedRelease string
	Probe         string
	ImportedAt    time.Time
	// Misfit says the file no longer fits its Version's Profile (a Profile
	// switch): the Version counts as Wanted and any fitting Release replaces it.
	Misfit bool
}

// Version is one Slot of a Title in detail.
type Version struct {
	ID          int64
	Slot        resolution.Class
	Profile     string
	State       State
	LongMissing bool
	WantedSince *time.Time
	File        *File // Movies; nil until an Import fills it
	AddedAt     time.Time
}

// Alias is an alternative title or translation.
type Alias struct {
	Title    string
	Country  string
	Language string
}

// Detail is a Title with everything the detail pane shows.
type Detail struct {
	ID               int64
	Kind             Kind
	TMDBID           int // 0 when unknown
	TVDBID           int
	IMDbID           string
	Title            string
	OriginalTitle    string
	PrimaryTitle     string
	Year             int
	OriginalLanguage string
	Overview         string
	Runtime          int
	PosterPath       string
	Monitored        bool
	MetadataFrozen   bool
	RootFolder       string
	Folder           string
	AddedAt          time.Time
	RefreshedAt      time.Time
	ReleaseDates     metadata.ReleaseDates
	Aliases          []Alias
	Versions         []Version // in Slot order
	// SeriesMonitor and Seasons are set for a Series.
	SeriesMonitor Monitor
	Seasons       []Season
}

// Service reads and writes the Library.
type Service struct {
	st    *store.Store
	clock func() time.Time
	// country is the household's release-date country; see WithCountry.
	country func(context.Context) string
}

// New returns a Service. clock is the time source (time.Now in production).
func New(st *store.Store, clock func() time.Time) *Service {
	if clock == nil {
		clock = time.Now
	}
	return &Service{st: st, clock: clock}
}

func ts(t time.Time) string { return t.UTC().Format(time.RFC3339) }

func parseTime(s string) time.Time {
	t, _ := time.Parse(time.RFC3339, s)
	return t
}

func slotName(c resolution.Class) string { return strings.ToLower(c.String()) }

func slotOf(name string) resolution.Class {
	switch name {
	case "hd":
		return resolution.HD
	case "uhd":
		return resolution.UHD
	}
	return resolution.SD
}

func nullInt(n int) sql.NullInt64 { return sql.NullInt64{Int64: int64(n), Valid: n != 0} }

func nullStr(s string) sql.NullString { return sql.NullString{String: s, Valid: s != ""} }

// AddMovie adds a Movie with its Versions in one transaction and returns its
// id. Each Version starts Wanted: its search_state row is due now. A Movie
// already in the Library is an *ExistsError.
func (s *Service) AddMovie(ctx context.Context, a AddMovie) (int64, error) {
	if len(a.Versions) == 0 {
		return 0, ErrNoVersions
	}
	seen := map[resolution.Class]bool{}
	for _, v := range a.Versions {
		if seen[v.Slot] {
			return 0, ErrDuplicateSlot
		}
		seen[v.Slot] = true
	}
	d := a.Details
	primary := d.TitleIn(a.PrimaryLanguage)
	if primary == "" {
		primary = d.Title
	}
	now := ts(s.clock())

	tx, err := s.st.Write().BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	q := db.New(tx)

	existing, err := q.FindTitlesByTMDB(ctx, string(Movie))
	if err != nil {
		return 0, err
	}
	for _, e := range existing {
		if e.TmdbID.Int64 == int64(d.TMDBID) {
			return 0, &ExistsError{ID: e.ID}
		}
	}
	id, err := insertMovie(ctx, q, a, primary, now)
	if err != nil {
		return 0, err
	}
	for _, v := range a.Versions {
		vid, err := q.InsertVersion(ctx, db.InsertVersionParams{TitleID: id, Slot: slotName(v.Slot), ProfileKey: v.Profile, AddedAt: now})
		if err != nil {
			return 0, fmt.Errorf("library: add the %s Version under %q: %w", v.Slot, v.Profile, err)
		}
		// Due now: the first sweep after the add searches it.
		if err := q.InsertSearchState(ctx, db.InsertSearchStateParams{
			VersionID: vid, NextMissingAt: sql.NullString{String: now, Valid: true}, NextUpgradeAt: sql.NullString{String: now, Valid: true}, Fresh: 1,
		}); err != nil {
			return 0, err
		}
	}
	return id, tx.Commit()
}

// insertMovie writes a Movie's Title row with its aliases, translations and
// release dates, and returns its id. Versions are the caller's.
func insertMovie(ctx context.Context, q *db.Queries, a AddMovie, primary, now string) (int64, error) {
	d := a.Details
	id, err := q.InsertTitle(ctx, db.InsertTitleParams{
		Kind: string(Movie), TmdbID: nullInt(d.TMDBID), ImdbID: nullStr(d.IMDbID),
		Title: d.Title, OriginalTitle: d.OriginalTitle, PrimaryTitle: primary,
		Year: nullInt(d.Year), OriginalLanguage: d.OriginalLanguage, Overview: d.Overview,
		Runtime: nullInt(d.Runtime), PosterPath: nullStr(d.PosterPath), Monitored: 1,
		RootFolder: a.RootFolder, AddedAt: now, RefreshedAt: now,
	})
	if err != nil {
		return 0, err
	}
	for _, al := range d.Aliases {
		if err := q.InsertAlias(ctx, db.InsertAliasParams{TitleID: id, Alias: al.Title, Country: al.Country}); err != nil {
			return 0, err
		}
	}
	for _, tr := range d.Translations {
		if tr.Title == "" {
			continue
		}
		if err := q.InsertAlias(ctx, db.InsertAliasParams{TitleID: id, Alias: tr.Title, Country: tr.Country, Language: tr.Language}); err != nil {
			return 0, err
		}
	}
	for _, r := range d.ReleaseDates {
		if err := q.InsertReleaseDate(ctx, db.InsertReleaseDateParams{
			TitleID: id, Country: r.Country, Type: int64(r.Type), Date: ts(r.Date), Certification: r.Certification,
		}); err != nil {
			return 0, err
		}
	}
	return id, nil
}

// InLibrary maps the TMDB ids that are already Titles of kind to their Title ids.
func (s *Service) InLibrary(ctx context.Context, kind Kind, tmdbIDs []int) (map[int]int64, error) {
	rows, err := db.New(s.st.Read()).FindTitlesByTMDB(ctx, string(kind))
	if err != nil {
		return nil, err
	}
	want := map[int64]bool{}
	for _, id := range tmdbIDs {
		want[int64(id)] = true
	}
	out := map[int]int64{}
	for _, r := range rows {
		if want[r.TmdbID.Int64] {
			out[int(r.TmdbID.Int64)] = r.ID
		}
	}
	return out, nil
}

// releaseDates groups stored release dates by Title.
func releaseDatesOf(rows []db.TitleReleaseDate) metadata.ReleaseDates {
	var out metadata.ReleaseDates
	for _, r := range rows {
		out = append(out, metadata.ReleaseDate{Country: r.Country, Type: metadata.ReleaseType(r.Type), Date: parseTime(r.Date), Certification: r.Certification})
	}
	return out
}

// stateOf is a Movie Version's state. wantedSince is set when it is Wanted.
func stateOf(monitored, hasFile bool, rel metadata.ReleaseDates, addedAt time.Time, v View) (State, *time.Time) {
	u := Unit{Monitored: monitored, HasFile: hasFile, AddedAt: addedAt}
	if released, ok := rel.Released(v.Country); ok {
		u.Released = &released
	}
	return StateAt(u, v.Now)
}

// List returns the Library's Titles, newest first, as compact rows.
func (s *Service) List(ctx context.Context, view View, f Filter) ([]Row, error) {
	q := db.New(s.st.Read())
	titles, err := q.ListTitles(ctx)
	if err != nil {
		return nil, err
	}
	versions, err := q.ListVersions(ctx)
	if err != nil {
		return nil, err
	}
	files, err := q.ListFiles(ctx)
	if err != nil {
		return nil, err
	}
	dates, err := q.ListAllReleaseDates(ctx)
	if err != nil {
		return nil, err
	}
	allEps, err := q.ListEpisodes(ctx)
	if err != nil {
		return nil, err
	}
	fileEps, err := q.ListFileEpisodes(ctx)
	if err != nil {
		return nil, err
	}
	epsOf := map[int64][]db.Episode{}
	for _, e := range allEps {
		epsOf[e.TitleID] = append(epsOf[e.TitleID], e)
	}
	var fe []fileEp
	for _, r := range fileEps {
		fe = append(fe, fileEp{r.VersionID, r.EpisodeID, r.Score})
	}
	heldBy := heldOf(fe)
	var aliases []db.ListAliasesForSearchRow
	if f.Text != "" {
		if aliases, err = q.ListAliasesForSearch(ctx); err != nil {
			return nil, err
		}
	}

	misfits, err := misfitSet(ctx, q)
	if err != nil {
		return nil, err
	}
	hasFile := map[int64]bool{}
	for _, fl := range files {
		hasFile[fl.VersionID] = hasFile[fl.VersionID] || !misfits[fl.ID]
	}
	byTitle := map[int64][]db.Version{}
	for _, v := range versions {
		byTitle[v.TitleID] = append(byTitle[v.TitleID], v)
	}
	datesOf := map[int64][]db.TitleReleaseDate{}
	for _, d := range dates {
		datesOf[d.TitleID] = append(datesOf[d.TitleID], d)
	}
	matchesText := map[int64]bool{}
	text := strings.ToLower(f.Text)
	for _, a := range aliases {
		if strings.Contains(strings.ToLower(a.Alias), text) {
			matchesText[a.TitleID] = true
		}
	}

	var out []Row
	for _, t := range titles {
		if f.Kind != "" && Kind(t.Kind) != f.Kind {
			continue
		}
		if f.Text != "" && !matchesText[t.ID] &&
			!strings.Contains(strings.ToLower(t.Title), text) && !strings.Contains(strings.ToLower(t.PrimaryTitle), text) &&
			!strings.Contains(strings.ToLower(t.OriginalTitle), text) {
			continue
		}
		rel := releaseDatesOf(datesOf[t.ID])
		row := Row{ID: t.ID, Kind: Kind(t.Kind), Title: t.Title, PrimaryTitle: t.PrimaryTitle, Year: int(t.Year.Int64), AddedAt: parseTime(t.AddedAt)}
		for _, v := range byTitle[t.ID] {
			var st State
			var since *time.Time
			if row.Kind == Series {
				st, since = SeriesState(unitsOf(epsOf[t.ID], heldBy[v.ID], parseTime(v.AddedAt)), view.Now)
			} else {
				st, since = stateOf(t.Monitored == 1, hasFile[v.ID], rel, parseTime(v.AddedAt), view)
			}
			row.Slots[slotOf(v.Slot)] = &SlotState{VersionID: v.ID, Profile: v.ProfileKey, State: st, LongMissing: IsLongMissing(st, since, view.Now), WantedSince: since}
			if since != nil && (row.WantedSince == nil || since.Before(*row.WantedSince)) {
				row.WantedSince = since
			}
		}
		if f.Wanted && !slices.ContainsFunc(row.Slots[:], func(sl *SlotState) bool { return sl != nil && sl.State == Wanted }) {
			continue
		}
		if f.LongMissing && !slices.ContainsFunc(row.Slots[:], func(sl *SlotState) bool { return sl != nil && sl.LongMissing }) {
			continue
		}
		out = append(out, row)
	}
	if f.ByWantedSince {
		sort.SliceStable(out, func(i, j int) bool {
			a, b := out[i].WantedSince, out[j].WantedSince
			switch {
			case a == nil || b == nil:
				return a != nil && b == nil
			}
			return a.Before(*b)
		})
	}
	return out, nil
}

// TitleOfVersion returns the id of the Title a Version belongs to, or ErrNotFound.
func (s *Service) TitleOfVersion(ctx context.Context, versionID int64) (int64, error) {
	id, err := db.New(s.st.Read()).GetTitleOfVersion(ctx, versionID)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrNotFound
	}
	return id, err
}

// Get returns one Title in detail.
func (s *Service) Get(ctx context.Context, id int64, view View) (Detail, error) {
	q := db.New(s.st.Read())
	t, err := q.GetTitle(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return Detail{}, ErrNotFound
	}
	if err != nil {
		return Detail{}, err
	}
	versions, err := q.ListVersionsOfTitle(ctx, id)
	if err != nil {
		return Detail{}, err
	}
	files, err := q.ListFilesOfTitle(ctx, id)
	if err != nil {
		return Detail{}, err
	}
	dates, err := q.ListReleaseDatesOfTitle(ctx, id)
	if err != nil {
		return Detail{}, err
	}
	aliases, err := q.ListAliasesOfTitle(ctx, id)
	if err != nil {
		return Detail{}, err
	}

	d := Detail{
		ID: t.ID, Kind: Kind(t.Kind), TMDBID: int(t.TmdbID.Int64), TVDBID: int(t.TvdbID.Int64), IMDbID: t.ImdbID.String,
		Title: t.Title, OriginalTitle: t.OriginalTitle, PrimaryTitle: t.PrimaryTitle, Year: int(t.Year.Int64),
		OriginalLanguage: t.OriginalLanguage, Overview: t.Overview, Runtime: int(t.Runtime.Int64), PosterPath: t.PosterPath.String,
		Monitored: t.Monitored == 1, MetadataFrozen: t.MetadataFrozen == 1, RootFolder: t.RootFolder, Folder: t.Folder.String,
		AddedAt: parseTime(t.AddedAt), RefreshedAt: parseTime(t.RefreshedAt),
	}
	d.ReleaseDates = releaseDatesOf(dates)
	for _, a := range aliases {
		d.Aliases = append(d.Aliases, Alias{Title: a.Alias, Country: a.Country, Language: a.Language})
	}
	misfits, err := misfitSet(ctx, q)
	if err != nil {
		return Detail{}, err
	}
	fileOf := map[int64]*File{}
	for _, f := range files {
		fl := &File{Misfit: misfits[f.ID], ID: f.ID, Path: f.Path, Size: f.Size, ReleaseName: f.ReleaseName, ParsedRelease: f.ParsedRelease.String, Probe: f.Probe.String, ImportedAt: parseTime(f.ImportedAt)}
		if f.Score.Valid {
			n := int(f.Score.Int64)
			fl.Score = &n
		}
		fileOf[f.VersionID] = fl
	}
	var epsOf []db.Episode
	heldBy := heldMap{}
	if d.Kind == Series {
		d.SeriesMonitor = Monitor(t.SeriesMonitor.String)
		seasons, err := q.ListSeasonsOfTitle(ctx, id)
		if err != nil {
			return Detail{}, err
		}
		for _, se := range seasons {
			d.Seasons = append(d.Seasons, Season{Number: int(se.Number), Monitored: se.Monitored == 1})
		}
		if epsOf, err = q.ListEpisodesOfTitle(ctx, id); err != nil {
			return Detail{}, err
		}
		fes, err := q.ListFileEpisodesOfTitle(ctx, id)
		if err != nil {
			return Detail{}, err
		}
		var fe []fileEp
		for _, r := range fes {
			fe = append(fe, fileEp{r.VersionID, r.EpisodeID, r.Score})
		}
		heldBy = heldOf(fe)
		fileOf = map[int64]*File{} // a Series Version holds a file per episode; the heat map shows them
	}
	for _, v := range versions {
		fl := fileOf[v.ID]
		var st State
		var since *time.Time
		if d.Kind == Series {
			st, since = SeriesState(unitsOf(epsOf, heldBy[v.ID], parseTime(v.AddedAt)), view.Now)
		} else {
			st, since = stateOf(d.Monitored, fl != nil && !fl.Misfit, d.ReleaseDates, parseTime(v.AddedAt), view)
		}
		d.Versions = append(d.Versions, Version{
			ID: v.ID, Slot: slotOf(v.Slot), Profile: v.ProfileKey, State: st, LongMissing: IsLongMissing(st, since, view.Now),
			WantedSince: since, File: fl, AddedAt: parseTime(v.AddedAt),
		})
	}
	sort.SliceStable(d.Versions, func(i, j int) bool { return d.Versions[i].Slot < d.Versions[j].Slot })
	return d, nil
}
