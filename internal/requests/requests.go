// Package requests is Kestrel's native, source-neutral Request API (ADR 0004).
// A Request is an ask from outside Kestrel, such as a Silo user, for a Title in
// one or more Slots. It is accepted at once, adds the Title or only its missing
// Versions, never changes an existing Version, and carries who asked and from
// where. Per-Slot status is derived from the Version and its Grabs on every
// read and never stored.
//
// requests owns the requests, request_slots and request_seasons tables. It
// calls library, scoring/profiles, metadata and acquire's active Grabs; the
// caller (api) kicks the search sweep when Result.SearchDue says so.
package requests

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/requests/db"
	"github.com/hyprsh/kestrel/internal/resolution"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
	"github.com/hyprsh/kestrel/internal/settings/rootfolders"
	"github.com/hyprsh/kestrel/internal/store"
)

// Outcome is whether Kestrel took the Request on.
type Outcome string

const (
	Accepted Outcome = "accepted"
	Rejected Outcome = "rejected"
)

// Reason says why a Request was rejected.
type Reason string

const (
	NotOnTVDB        Reason = "not_on_tvdb"
	UnknownTitle     Reason = "unknown_title"
	NoEnabledProfile Reason = "no_enabled_profile"
)

// Status is where a requested Slot stands, derived on every read.
type Status string

const (
	Queued      Status = "queued"
	Downloading Status = "downloading"
	Completed   Status = "completed"
	Failed      Status = "failed"
)

// ValidationError is a malformed Request (the API answers 422).
type ValidationError struct{ Field, Code, Message string }

func (e *ValidationError) Error() string { return e.Field + ": " + e.Message }

func invalid(field, code, msg string) error { return &ValidationError{field, code, msg} }

// SlotInput is a Slot the Request names, with the Profile key it asks for, or "".
type SlotInput struct {
	Slot    resolution.Class
	Profile string
}

// Input is a Request as the source sends it.
type Input struct {
	Source          string
	SourceRequestID string
	RequesterID     string
	RequesterName   string
	Kind            library.Kind
	TMDBID, TVDBID  int
	IMDbID          string
	Slots           []SlotInput
	// Seasons is the Series seasons asked for; nil asks for the whole Series.
	Seasons []int
}

// Download is the live progress of a Slot's active Grab.
type Download struct {
	Phase      string
	BytesTotal int64
	BytesLeft  int64
	ETA        time.Duration
}

// SlotStatus is one requested Slot.
type SlotStatus struct {
	Slot resolution.Class
	// Profile is the Version's Profile (what the Request resolved to, or what
	// an existing Version already had); "" when the Request was rejected first.
	Profile   string
	VersionID int64 // 0 when there is no Version (rejected, or removed since)
	Status    Status
	Label     string
	Download  *Download
}

// Request is a stored Request with its current status.
type Request struct {
	ID              int64
	Source          string
	SourceRequestID string
	RequesterID     string
	RequesterName   string
	TitleID         int64 // 0 when rejected
	Outcome         Outcome
	Reason          Reason
	CreatedAt       time.Time
	Seasons         []int
	Slots           []SlotStatus
}

// Result is what Submit did.
type Result struct {
	Request Request
	// Created is false when the Request was a retry of one already stored.
	Created bool
	// SearchDue is true when Versions were added or seasons newly monitored:
	// the caller kicks the search sweep.
	SearchDue bool
}

// Deps are the modules requests calls.
type Deps struct {
	Store       *store.Store
	Clock       func() time.Time
	Library     *library.Service
	Profiles    *profiles.Service
	RootFolders *rootfolders.Service
	Meta        metadata.Provider
	TVDB        metadata.TVDBProvider
	// Grabs lists the active Grabs.
	Grabs interface {
		Active(ctx context.Context) ([]acquire.Active, error)
	}
}

// Service accepts and reports Requests.
type Service struct{ d Deps }

// New returns a Service.
func New(d Deps) *Service {
	if d.Clock == nil {
		d.Clock = time.Now
	}
	return &Service{d: d}
}

func ts(t time.Time) string { return t.UTC().Format(time.RFC3339) }

func slotName(c resolution.Class) string {
	switch c {
	case resolution.HD:
		return "hd"
	case resolution.UHD:
		return "uhd"
	}
	return "sd"
}

func slotOf(s string) resolution.Class {
	switch s {
	case "hd":
		return resolution.HD
	case "uhd":
		return resolution.UHD
	}
	return resolution.SD
}

func notFound(err error) bool {
	var me *metadata.Error
	return errors.As(err, &me) && me.Code == metadata.CodeNotFound
}

// ErrNotFound is a Request that does not exist.
var ErrNotFound = errors.New("request not found")

// ErrNoRootFolder means no Root folder is configured for the Title's kind.
var ErrNoRootFolder = errors.New("no Root folder is configured")

// target is the Title a Request is about, existing or yet to add.
type target struct {
	existing *library.Detail
	movie    metadata.MovieDetails
	series   metadata.SeriesDetails
	tvdb     metadata.TVDBSeries
	rel      metadata.ReleaseDates
	seasons  map[int]bool
}

// Submit takes a Request on. A retry of a stored (source, source_request_id)
// returns the stored one. A Request Kestrel cannot serve is stored as rejected.
func (s *Service) Submit(ctx context.Context, in Input) (Result, error) {
	q := db.New(s.d.Store.Read())
	var prior *db.Request
	if row, err := q.GetRequestBySource(ctx, db.GetRequestBySourceParams{Source: in.Source, SourceRequestID: in.SourceRequestID}); err == nil {
		if row.Outcome != string(Rejected) {
			r, err := s.view(ctx, row)
			return Result{Request: r}, err
		}
		// A rejection may have a cause that was fixed since (a Profile enabled,
		// a Title TheTVDB now has): evaluate it again, keeping the stored one
		// while it is still rejected.
		prior = &row
	} else if !errors.Is(err, sql.ErrNoRows) {
		return Result{}, err
	}

	all, err := s.d.Profiles.List(ctx)
	if err != nil {
		return Result{}, err
	}
	if err := validate(in, all); err != nil {
		return Result{}, err
	}

	tgt, reason, err := s.resolveTitle(ctx, in)
	if err != nil {
		return Result{}, err
	}
	if reason != "" {
		return s.store(ctx, in, prior, 0, nil, reason, false)
	}
	if in.Seasons != nil {
		for _, n := range in.Seasons {
			if !tgt.seasons[n] {
				return Result{}, invalid("seasons", "not_found", fmt.Sprintf("The Series has no season %d", n))
			}
		}
	}

	region, _, err := s.d.Profiles.Region(ctx)
	if err != nil {
		return Result{}, err
	}
	kids, _, err := s.d.Profiles.Kids(ctx)
	if err != nil {
		return Result{}, err
	}
	certCountry, cert := tgt.rel.Certification(region.Country)
	isKids := kids.Applies(certCountry, cert)
	kind := release.KindMovie
	if in.Kind == library.Series {
		kind = release.KindSeries
	}

	have := map[resolution.Class]bool{}
	if tgt.existing != nil {
		for _, v := range tgt.existing.Versions {
			have[v.Slot] = true
		}
	}
	var specs []library.VersionSpec
	chosen := map[resolution.Class]string{}
	for _, sl := range in.Slots {
		if have[sl.Slot] {
			continue // accepted unchanged
		}
		key := sl.Profile
		if key == "" {
			r, err := profiles.Resolve(all, kind, sl.Slot, isKids)
			if errors.Is(err, profiles.ErrNoEnabledProfile) {
				return s.store(ctx, in, prior, 0, nil, NoEnabledProfile, false)
			}
			if err != nil {
				return Result{}, err
			}
			key = r.Key
		} else if p := profileByKey(all, key); !p.Enabled {
			return s.store(ctx, in, prior, 0, nil, NoEnabledProfile, false)
		}
		chosen[sl.Slot] = key
		specs = append(specs, library.VersionSpec{Slot: sl.Slot, Profile: key})
	}

	titleID, searchDue, err := s.apply(ctx, in, tgt, specs, region)
	if err != nil {
		return Result{}, err
	}
	d, err := s.d.Library.Get(ctx, titleID, library.View{Country: region.Country, Now: s.d.Clock()})
	if err != nil {
		return Result{}, err
	}
	versionOf := map[resolution.Class]library.Version{}
	for _, v := range d.Versions {
		versionOf[v.Slot] = v
	}
	var slots []slotRow
	for _, sl := range in.Slots {
		v := versionOf[sl.Slot]
		slots = append(slots, slotRow{slot: sl.Slot, profile: v.Profile, versionID: v.ID})
	}
	res, err := s.store(ctx, in, prior, titleID, slots, "", true)
	res.SearchDue = searchDue
	return res, err
}

func profileByKey(all []profiles.Profile, key string) profiles.Profile {
	for _, p := range all {
		if p.Key == key {
			return p
		}
	}
	return profiles.Profile{}
}

func validate(in Input, all []profiles.Profile) error {
	if in.Source == "" {
		return invalid("source", "required", "Say where the Request comes from")
	}
	if in.SourceRequestID == "" {
		return invalid("source_request_id", "required", "The source's own id for the Request is required")
	}
	if in.Kind != library.Movie && in.Kind != library.Series {
		return invalid("title.kind", "invalid", "A Title is a movie or a series")
	}
	if in.TMDBID == 0 && in.TVDBID == 0 {
		return invalid("title", "required", "Name the Title by its tmdb_id or tvdb_id")
	}
	if len(in.Slots) == 0 {
		return invalid("slots", "required", "Name at least one Slot")
	}
	seen := map[resolution.Class]bool{}
	for i, sl := range in.Slots {
		field := fmt.Sprintf("slots[%d]", i)
		if seen[sl.Slot] {
			return invalid(field+".slot", "duplicate", "A Slot holds one Version")
		}
		seen[sl.Slot] = true
		if sl.Profile == "" {
			continue
		}
		// A disabled Profile still fills a Request that names it.
		switch _, err := profiles.Pick(all, sl.Profile, sl.Slot); {
		case errors.Is(err, profiles.ErrNoSuchProfile):
			return invalid(field+".profile", "not_found", "No such Profile")
		case errors.Is(err, profiles.ErrWrongSlot):
			return invalid(field+".profile", "wrong_slot", "That Profile belongs to another Slot")
		}
	}
	if in.Seasons != nil {
		if in.Kind != library.Series {
			return invalid("seasons", "not_a_series", "Only a Series has seasons")
		}
		for _, n := range in.Seasons {
			if n < 0 {
				return invalid("seasons", "invalid", "Seasons are numbered from 0")
			}
		}
	}
	return nil
}

// resolveTitle finds the Title in the Library or fetches it. A reason means
// Kestrel cannot serve the Request.
func (s *Service) resolveTitle(ctx context.Context, in Input) (target, Reason, error) {
	var t target
	view := library.View{Now: s.d.Clock()}
	region, _, err := s.d.Profiles.Region(ctx)
	if err != nil {
		return t, "", err
	}
	view.Country = region.Country
	id, ok, err := s.d.Library.Find(ctx, in.Kind, in.TMDBID, in.TVDBID)
	if err != nil {
		return t, "", err
	}
	if ok {
		d, err := s.d.Library.Get(ctx, id, view)
		if err != nil {
			return t, "", err
		}
		t.existing, t.rel, t.seasons = &d, d.ReleaseDates, map[int]bool{}
		for _, se := range d.Seasons {
			t.seasons[se.Number] = true
		}
		return t, "", nil
	}
	if in.TMDBID == 0 {
		return t, UnknownTitle, nil
	}
	if in.Kind == library.Movie {
		m, err := s.d.Meta.Movie(ctx, in.TMDBID)
		if notFound(err) {
			return t, UnknownTitle, nil
		}
		if err != nil {
			return t, "", err
		}
		t.movie, t.rel = m, m.ReleaseDates
		return t, "", nil
	}
	sd, err := s.d.Meta.Series(ctx, in.TMDBID)
	if notFound(err) {
		return t, UnknownTitle, nil
	}
	if err != nil {
		return t, "", err
	}
	known := sd.TVDBID
	if known == 0 {
		known = in.TVDBID
	}
	tvdbID, err := metadata.TVDBIDOf(ctx, s.d.TVDB, known, sd.IMDbID)
	if err != nil {
		return t, "", err
	}
	if tvdbID == 0 {
		return t, NotOnTVDB, nil
	}
	tv, err := s.d.TVDB.Series(ctx, tvdbID)
	if notFound(err) {
		return t, NotOnTVDB, nil
	}
	if err != nil {
		return t, "", err
	}
	t.series, t.tvdb, t.rel, t.seasons = sd, tv, sd.Ratings, map[int]bool{}
	for _, e := range tv.Episodes {
		t.seasons[e.Season] = true
	}
	return t, "", nil
}

// apply adds the Title or its missing Versions and sets the season monitoring.
func (s *Service) apply(ctx context.Context, in Input, t target, specs []library.VersionSpec, region profiles.Region) (titleID int64, searchDue bool, err error) {
	lib := s.d.Library
	titleID = 0
	if t.existing != nil {
		titleID = t.existing.ID
	} else {
		roots, _, err := s.d.RootFolders.Get(ctx)
		if err != nil {
			return 0, false, err
		}
		root, err := roots.Pick(in.Kind == library.Series, "")
		if errors.Is(err, rootfolders.ErrNoneSet) {
			return 0, false, ErrNoRootFolder
		}
		if err != nil {
			return 0, false, err
		}
		if in.Kind == library.Movie {
			titleID, err = lib.AddMovie(ctx, library.AddMovie{Details: t.movie, PrimaryLanguage: string(region.Primary), Versions: specs, RootFolder: root})
		} else {
			mode := library.MonitorAll
			if in.Seasons != nil {
				mode = library.MonitorNone
			}
			titleID, err = lib.AddSeries(ctx, library.AddSeries{TMDB: t.series, TVDB: t.tvdb, PrimaryLanguage: string(region.Primary), Monitor: mode, Versions: specs, RootFolder: root})
		}
		var exists *library.ExistsError
		if errors.As(err, &exists) { // a concurrent add won the race
			d, gerr := lib.Get(ctx, exists.ID, library.View{Country: region.Country, Now: s.d.Clock()})
			if gerr != nil {
				return 0, false, gerr
			}
			t.existing, titleID = &d, d.ID
			have := map[resolution.Class]bool{}
			for _, v := range d.Versions {
				have[v.Slot] = true
			}
			var left []library.VersionSpec
			for _, sp := range specs {
				if !have[sp.Slot] {
					left = append(left, sp)
				}
			}
			specs, err = left, nil
		} else if err != nil {
			return 0, false, err
		} else {
			searchDue = true
			specs = nil
		}
	}
	for _, sp := range specs {
		if _, err := lib.AddVersion(ctx, titleID, sp); err != nil && !errors.Is(err, library.ErrSlotTaken) {
			return 0, false, err
		} else if err == nil {
			searchDue = true
		}
	}
	if in.Kind != library.Series {
		return titleID, searchDue, nil
	}

	// Seasons: a Request only ever adds monitoring.
	var added []int
	if t.existing != nil {
		switch {
		case in.Seasons == nil:
			if t.existing.SeriesMonitor != library.MonitorAll {
				if err := lib.SetSeriesMonitor(ctx, titleID, library.MonitorAll); err != nil {
					return 0, false, err
				}
			}
			for _, se := range t.existing.Seasons {
				if !se.Monitored && se.Number != 0 {
					added = append(added, se.Number)
				}
			}
		default:
			for _, se := range t.existing.Seasons {
				if slices.Contains(in.Seasons, se.Number) && !se.Monitored {
					if err := lib.SetSeasonMonitored(ctx, titleID, se.Number, true); err != nil {
						return 0, false, err
					}
					added = append(added, se.Number)
				}
			}
		}
	} else if in.Seasons != nil {
		for _, n := range in.Seasons {
			if err := lib.SetSeasonMonitored(ctx, titleID, n, true); err != nil {
				return 0, false, err
			}
		}
	}
	if len(added) > 0 && t.existing != nil {
		for _, v := range t.existing.Versions {
			if err := lib.RequestSeasonSearch(ctx, v.ID, added); err != nil {
				return 0, false, err
			}
		}
		searchDue = true
	}
	return titleID, searchDue, nil
}

type slotRow struct {
	slot      resolution.Class
	profile   string
	versionID int64
}

// store writes the Request and returns its current view. A retry racing this
// one wins on the unique key and its stored Request is returned instead. prior
// is the stored rejection this one re-evaluates: it stands while the Request is
// rejected again, and gives way to an accepted one.
func (s *Service) store(ctx context.Context, in Input, prior *db.Request, titleID int64, slots []slotRow, reason Reason, accepted bool) (Result, error) {
	if prior != nil && !accepted {
		r, err := s.view(ctx, *prior)
		return Result{Request: r}, err
	}
	if !accepted {
		for _, sl := range in.Slots {
			slots = append(slots, slotRow{slot: sl.Slot, profile: sl.Profile})
		}
	}
	tx, err := s.d.Store.Write().BeginTx(ctx, nil)
	if err != nil {
		return Result{}, err
	}
	defer tx.Rollback()
	q := db.New(tx)
	if prior != nil {
		if err := q.DeleteRequest(ctx, prior.ID); err != nil {
			return Result{}, err
		}
	}
	outcome := string(Accepted)
	var rr sql.NullString
	if !accepted {
		outcome, rr = string(Rejected), sql.NullString{String: string(reason), Valid: true}
	}
	id, err := q.InsertRequest(ctx, db.InsertRequestParams{
		Source: in.Source, SourceRequestID: in.SourceRequestID, RequesterID: in.RequesterID, RequesterName: in.RequesterName,
		TitleID: sql.NullInt64{Int64: titleID, Valid: titleID != 0}, Outcome: outcome, RejectReason: rr, CreatedAt: ts(s.d.Clock()),
	})
	if err != nil {
		tx.Rollback()
		if row, gerr := db.New(s.d.Store.Read()).GetRequestBySource(ctx, db.GetRequestBySourceParams{Source: in.Source, SourceRequestID: in.SourceRequestID}); gerr == nil {
			r, verr := s.view(ctx, row)
			return Result{Request: r}, verr
		}
		return Result{}, err
	}
	for _, sl := range slots {
		if err := q.InsertRequestSlot(ctx, db.InsertRequestSlotParams{
			RequestID: id, Slot: slotName(sl.slot), ProfileKey: sql.NullString{String: sl.profile, Valid: sl.profile != ""},
			VersionID: sql.NullInt64{Int64: sl.versionID, Valid: sl.versionID != 0},
		}); err != nil {
			return Result{}, err
		}
	}
	for _, n := range in.Seasons {
		if err := q.InsertRequestSeason(ctx, db.InsertRequestSeasonParams{RequestID: id, Season: int64(n)}); err != nil {
			return Result{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return Result{}, err
	}
	r, err := s.Get(ctx, id)
	return Result{Request: r, Created: true}, err
}

// Get returns one Request with its current status.
func (s *Service) Get(ctx context.Context, id int64) (Request, error) {
	row, err := db.New(s.d.Store.Read()).GetRequest(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return Request{}, ErrNotFound
	}
	if err != nil {
		return Request{}, err
	}
	return s.view(ctx, row)
}

// Filter narrows List.
type Filter struct {
	Source  string
	TitleID int64
	// IDs, when set, are the only Requests returned (a bulk read).
	IDs []int64
	// Before is a keyset cursor: only Requests with a smaller id.
	Before int64
	Limit  int
}

// List returns Requests newest first.
func (s *Service) List(ctx context.Context, f Filter) ([]Request, error) {
	var rows []db.Request
	if len(f.IDs) > 0 {
		for _, id := range f.IDs {
			row, err := db.New(s.d.Store.Read()).GetRequest(ctx, id)
			if errors.Is(err, sql.ErrNoRows) {
				continue
			}
			if err != nil {
				return nil, err
			}
			rows = append(rows, row)
		}
	} else {
		before := f.Before
		if before == 0 {
			before = 1 << 62
		}
		var err error
		rows, err = db.New(s.d.Store.Read()).ListRequests(ctx, db.ListRequestsParams{Before: before, Source: f.Source, TitleID: f.TitleID, Max: int64(f.Limit)})
		if err != nil {
			return nil, err
		}
	}
	out := make([]Request, 0, len(rows))
	c := s.cache()
	for _, row := range rows {
		r, err := s.viewWith(ctx, row, c)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, nil
}

// Origin is who asked for a Title and from where.
type Origin struct {
	ID            int64
	Source        string
	RequesterName string
	CreatedAt     time.Time
}

// OriginsOf lists the accepted Requests that brought or touched a Title, oldest first.
func (s *Service) OriginsOf(ctx context.Context, titleID int64) ([]Origin, error) {
	rows, err := db.New(s.d.Store.Read()).ListRequestsByTitle(ctx, sql.NullInt64{Int64: titleID, Valid: true})
	if err != nil {
		return nil, err
	}
	out := make([]Origin, len(rows))
	for i, r := range rows {
		t, _ := time.Parse(time.RFC3339, r.CreatedAt)
		out[i] = Origin{ID: r.ID, Source: r.Source, RequesterName: r.RequesterName, CreatedAt: t}
	}
	return out, nil
}

// cache holds what one read of several Requests loads once.
type cache struct {
	active  []acquire.Active
	loaded  bool
	details map[int64]*library.Detail
	eps     map[int64][]library.Episode
}

func (s *Service) cache() *cache {
	return &cache{details: map[int64]*library.Detail{}, eps: map[int64][]library.Episode{}}
}

func (s *Service) view(ctx context.Context, row db.Request) (Request, error) {
	return s.viewWith(ctx, row, s.cache())
}

func (s *Service) viewWith(ctx context.Context, row db.Request, c *cache) (Request, error) {
	q := db.New(s.d.Store.Read())
	created, _ := time.Parse(time.RFC3339, row.CreatedAt)
	r := Request{
		ID: row.ID, Source: row.Source, SourceRequestID: row.SourceRequestID, RequesterID: row.RequesterID, RequesterName: row.RequesterName,
		TitleID: row.TitleID.Int64, Outcome: Outcome(row.Outcome), Reason: Reason(row.RejectReason.String), CreatedAt: created,
	}
	seasons, err := q.ListSeasonsOfRequest(ctx, row.ID)
	if err != nil {
		return r, err
	}
	for _, n := range seasons {
		r.Seasons = append(r.Seasons, int(n))
	}
	slots, err := q.ListSlotsOfRequest(ctx, row.ID)
	if err != nil {
		return r, err
	}
	for _, sl := range slots {
		st := SlotStatus{Slot: slotOf(sl.Slot), Profile: sl.ProfileKey.String, VersionID: sl.VersionID.Int64}
		if r.Outcome == Rejected {
			st.Status, st.Label = Failed, reasonLabel(r.Reason)
		} else if err := s.derive(ctx, &r, &st, c); err != nil {
			return r, err
		}
		r.Slots = append(r.Slots, st)
	}
	return r, nil
}

func reasonLabel(r Reason) string {
	switch r {
	case NotOnTVDB:
		return "Not on TheTVDB"
	case UnknownTitle:
		return "Unknown title"
	case NoEnabledProfile:
		return "No enabled Profile"
	}
	return "Rejected"
}

// derive sets a Slot's status from its Version, files and active Grabs.
func (s *Service) derive(ctx context.Context, r *Request, st *SlotStatus, c *cache) error {
	if st.VersionID == 0 || r.TitleID == 0 {
		st.VersionID = 0
		st.Status, st.Label = Failed, "Removed"
		return nil
	}
	d := c.details[r.TitleID]
	if d == nil {
		region, _, err := s.d.Profiles.Region(ctx)
		if err != nil {
			return err
		}
		got, err := s.d.Library.Get(ctx, r.TitleID, library.View{Country: region.Country, Now: s.d.Clock()})
		if errors.Is(err, library.ErrNotFound) {
			st.VersionID = 0
			st.Status, st.Label = Failed, "Removed"
			return nil
		}
		if err != nil {
			return err
		}
		d = &got
		c.details[r.TitleID] = d
	}
	var v *library.Version
	for i := range d.Versions {
		if d.Versions[i].ID == st.VersionID {
			v = &d.Versions[i]
		}
	}
	if v == nil {
		st.VersionID = 0
		st.Status, st.Label = Failed, "Removed"
		return nil
	}
	st.Profile = v.Profile // the Version's own Profile, which a Request never changes

	complete := v.State == library.Filled
	if d.Kind == library.Series {
		eps, ok := c.eps[d.ID]
		if !ok {
			var err error
			eps, err = s.d.Library.Episodes(ctx, d.ID, library.View{Now: s.d.Clock()})
			if err != nil {
				return err
			}
			c.eps[d.ID] = eps
		}
		now := s.d.Clock()
		aired, held := 0, 0
		for _, e := range eps {
			if len(r.Seasons) == 0 && e.Season == 0 || len(r.Seasons) > 0 && !slices.Contains(r.Seasons, e.Season) {
				continue
			}
			if e.AirDate == nil || e.AirDate.After(now) {
				continue
			}
			aired++
			if cell := e.Cells[st.Slot]; cell != nil && cell.State == library.Filled {
				held++
			}
		}
		complete = aired > 0 && held == aired
	}
	if complete {
		st.Status, st.Label = Completed, "Completed"
		return nil
	}

	if !c.loaded {
		active, err := s.d.Grabs.Active(ctx)
		if err != nil {
			return err
		}
		c.active, c.loaded = active, true
	}
	for _, a := range c.active {
		if a.VersionID == st.VersionID {
			st.Status, st.Label = Downloading, "Downloading"
			st.Download = &Download{Phase: string(a.Phase), BytesTotal: a.BytesTotal, BytesLeft: a.BytesLeft, ETA: a.ETA}
			return nil
		}
	}
	st.Status, st.Label = Queued, "Searching"
	if v.State == library.Unreleased {
		st.Label = "Not released yet"
	}
	return nil
}
