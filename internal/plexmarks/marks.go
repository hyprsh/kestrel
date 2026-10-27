package plexmarks

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"time"

	"github.com/hyprsh/kestrel/internal/plexmarks/db"
	"github.com/hyprsh/kestrel/internal/plugin"
	mediaserver "github.com/hyprsh/kestrel/internal/plugin/mediaserver/v1"
	"github.com/hyprsh/kestrel/internal/requests"
	"github.com/hyprsh/kestrel/internal/store"
)

const (
	// Label is on every requested Title's item, and the smart collection of the
	// same name filters on it.
	Label = "Requested"
	// Collection is the name of the smart collection kept in each section.
	Collection = "Requested"
	// RequestedByPrefix starts the label that names a requester.
	RequestedByPrefix = "Requested by "
)

// Switches say what the marks do (api.PlexSwitches, as far as marking needs it).
type Switches struct {
	Labels      bool // the labels and the collection
	PosterBadge bool
	BadgeDays   int // how long the badge stays; at least 1
}

// Target is the Plex server marks are made on, reached with the owner's token.
type Target struct {
	InstanceID int64
	Server     mediaserver.Marker
	Conn       plugin.Connection
}

// Source is what marking needs of the requests module.
type Source interface {
	CompletedTitles(ctx context.Context) ([]requests.CompletedTitle, error)
}

// Deps are what New needs.
type Deps struct {
	Store  *store.Store
	Source Source
	// Switches reads the effective switches.
	Switches func(ctx context.Context) (Switches, error)
	// Target finds the Plex server; false when Plex sign-in names none that can be marked on.
	Target func(ctx context.Context) (Target, bool, error)
	Clock  func() time.Time
	Logger *slog.Logger
}

// Service is the "Marks in Plex" pass.
type Service struct{ d Deps }

// New returns a Service.
func New(d Deps) *Service {
	if d.Clock == nil {
		d.Clock = time.Now
	}
	if d.Logger == nil {
		d.Logger = slog.Default()
	}
	return &Service{d: d}
}

func ts(t time.Time) string { return t.UTC().Format(time.RFC3339) }

func parseTime(s sql.NullString) time.Time {
	t, _ := time.Parse(time.RFC3339, s.String)
	return t
}

func nullTime(t time.Time) sql.NullString { return sql.NullString{String: ts(t), Valid: true} }

// mark is a row with its labels decoded.
type mark struct {
	db.PlexMark
	ours []string // the labels Kestrel added
	dead bool     // Plex no longer has the item, and the row is gone
}

func (m *mark) item() mediaserver.Item {
	k := mediaserver.KindMovie
	if m.ItemKind == string(mediaserver.KindSeries) {
		k = mediaserver.KindSeries
	}
	return mediaserver.Item{ID: m.ItemID, SectionKey: m.SectionKey, Kind: k}
}

// badgeOn says the badge is on the poster (or going on).
func (m *mark) badgeOn() bool { return m.OriginalPoster.Valid }

// run is one pass in progress.
type run struct {
	*Service
	ctx  context.Context
	q    *db.Queries
	tgt  Target
	sw   Switches
	now  time.Time
	errs []error
}

// abort says the error ends the pass: Plex is out of reach, so the rest would
// fail the same way, and the next pass tries again.
func abort(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	var pe *plugin.Error
	return errors.As(err, &pe) && (pe.Code == plugin.CodeUnavailable || pe.Code == plugin.CodeAuth || pe.Code == plugin.CodeRateLimited)
}

func gone(err error) bool {
	var pe *plugin.Error
	return errors.As(err, &pe) && pe.Code == plugin.CodeNotFound
}

// Run marks every requested Title that is in Plex, takes marks back where a
// switch is off or the Title is no longer requested, and keeps the collection.
// It is idempotent: a pass that finds everything marked changes nothing.
func (s *Service) Run(ctx context.Context) error {
	sw, err := s.d.Switches(ctx)
	if err != nil {
		return err
	}
	tgt, ok, err := s.d.Target(ctx)
	if err != nil || !ok {
		return err
	}
	r := &run{Service: s, ctx: ctx, q: db.New(s.d.Store.Write()), tgt: tgt, sw: sw, now: s.d.Clock()}
	rows, err := r.q.ListMarks(ctx)
	if err != nil {
		return err
	}
	var marks []*mark
	for _, row := range rows {
		if row.InstanceID != tgt.InstanceID {
			continue // another Plex's: this one cannot take it back
		}
		m := &mark{PlexMark: row}
		_ = json.Unmarshal([]byte(row.Labels), &m.ours)
		marks = append(marks, m)
	}
	var titles []requests.CompletedTitle
	if sw.Labels || sw.PosterBadge {
		if titles, err = s.d.Source.CompletedTitles(ctx); err != nil {
			return err
		}
	}
	if len(titles) == 0 && len(marks) == 0 {
		return nil
	}
	return r.pass(titles, marks)
}

func (r *run) pass(titles []requests.CompletedTitle, marks []*mark) error {
	byTitle := map[int64]requests.CompletedTitle{}
	for _, t := range titles {
		byTitle[t.TitleID] = t
	}
	sections := map[string]bool{} // every section a mark was in, for the collection
	for _, m := range marks {
		sections[m.SectionKey] = true
	}

	var err error
	// 1. Take back what a switch or a gone Request no longer asks for.
	for _, m := range marks {
		if _, requested := byTitle[m.TitleID]; err == nil {
			err = r.takeBack(m, requested)
		}
	}
	// 2. Find the items of Titles not marked yet. One not in Plex yet waits for the next pass.
	if err == nil && (r.sw.Labels || r.sw.PosterBadge) {
		var added []*mark
		if added, err = r.find(titles, marks); err == nil {
			for _, m := range added {
				sections[m.SectionKey] = true
			}
			marks = append(marks, added...)
		}
	}
	// 3. Labels and badges.
	for _, m := range marks {
		t, requested := byTitle[m.TitleID]
		if err != nil || !requested || m.dead {
			continue
		}
		if r.sw.Labels {
			err = r.label(m, t)
		}
		if err == nil && r.sw.PosterBadge {
			err = r.badge(m)
		}
	}
	// 4. The collection of each section.
	for key := range sections {
		if err != nil {
			break
		}
		err = r.collection(key, marks)
	}
	// 5. Forget the marks nothing is left of.
	for _, m := range marks {
		if err == nil && !m.dead && len(m.ours) == 0 && !m.BadgeAt.Valid {
			err = r.q.DeleteMark(r.ctx, m.TitleID)
		}
	}
	if err != nil && !abort(err) {
		r.errs = append(r.errs, err)
		err = nil
	}
	if err != nil {
		return err
	}
	return errors.Join(r.errs...)
}

// fail records a per-Title failure and goes on, unless Plex is out of reach.
func (r *run) fail(m *mark, what string, err error) error {
	if abort(err) {
		return err
	}
	r.Logger().Warn("marking a Title in Plex failed", "title", m.TitleID, "step", what, "err", err)
	r.errs = append(r.errs, fmt.Errorf("title %d: %s: %w", m.TitleID, what, err))
	return nil
}

func (r *run) Logger() *slog.Logger { return r.d.Logger }

// itemGone forgets a mark whose item Plex no longer has. A later pass finds the
// Title's new item, if it has one, and marks it afresh.
func (r *run) itemGone(m *mark) error {
	m.dead = true
	m.ours, m.BadgeAt, m.OriginalPoster, m.BadgePoster = nil, sql.NullString{}, sql.NullString{}, sql.NullString{}
	return r.q.DeleteMark(r.ctx, m.TitleID)
}

func (r *run) setLabels(m *mark) error {
	raw, _ := json.Marshal(append([]string{}, m.ours...))
	if len(m.ours) == 0 {
		m.LabelledAt = sql.NullString{}
	}
	return r.q.SetMarkLabels(r.ctx, db.SetMarkLabelsParams{Labels: string(raw), LabelledAt: m.LabelledAt, TitleID: m.TitleID})
}

func (r *run) setBadge(m *mark) error {
	return r.q.SetMarkBadge(r.ctx, db.SetMarkBadgeParams{
		BadgeAt: m.BadgeAt, BadgeUntil: m.BadgeUntil, OriginalPoster: m.OriginalPoster, BadgePoster: m.BadgePoster, TitleID: m.TitleID,
	})
}

// takeBack removes what Kestrel added and a switch (or the end of the Request) no longer wants.
func (r *run) takeBack(m *mark, requested bool) error {
	if len(m.ours) > 0 && (!r.sw.Labels || !requested) {
		err := r.tgt.Server.RemoveLabels(r.ctx, r.tgt.Conn, m.item(), m.ours)
		switch {
		case gone(err):
			return r.itemGone(m)
		case err != nil:
			return r.fail(m, "removing labels", err)
		}
		m.ours = nil
		if err := r.setLabels(m); err != nil {
			return err
		}
	}
	if (m.BadgeAt.Valid) && (!r.sw.PosterBadge || !requested) {
		if m.badgeOn() {
			if err := r.restore(m); err != nil || m.badgeOn() || m.dead {
				return err
			}
		}
		// Switched off or no longer requested: a later badge starts afresh.
		m.BadgeAt, m.BadgeUntil = sql.NullString{}, sql.NullString{}
		return r.setBadge(m)
	}
	return nil
}

// restore puts the original poster back, only if the item still shows the badge.
func (r *run) restore(m *mark) error {
	item := m.item()
	posters, err := r.tgt.Server.Posters(r.ctx, r.tgt.Conn, item)
	if gone(err) {
		return r.itemGone(m)
	}
	if err != nil {
		return r.fail(m, "reading posters", err)
	}
	showsBadge := m.BadgePoster.Valid && slices.ContainsFunc(posters, func(p mediaserver.Poster) bool {
		return p.Selected && p.Key == m.BadgePoster.String
	})
	if showsBadge {
		if err := r.tgt.Server.SelectPoster(r.ctx, r.tgt.Conn, item, m.OriginalPoster.String); err != nil && !gone(err) {
			return r.fail(m, "restoring the poster", err)
		}
	}
	m.OriginalPoster, m.BadgePoster = sql.NullString{}, sql.NullString{}
	return r.setBadge(m)
}

// find looks up the items of requested Titles with no mark yet and records them.
func (r *run) find(titles []requests.CompletedTitle, marks []*mark) ([]*mark, error) {
	marked := map[int64]bool{}
	for _, m := range marks {
		marked[m.TitleID] = true
	}
	var todo []requests.CompletedTitle
	var refs []mediaserver.ItemRef
	for _, t := range titles {
		if marked[t.TitleID] {
			continue
		}
		kind := mediaserver.KindMovie
		if t.Kind == "series" {
			kind = mediaserver.KindSeries
		}
		todo = append(todo, t)
		refs = append(refs, mediaserver.ItemRef{Kind: kind, Path: t.Folder, TMDBID: t.TMDBID, TVDBID: t.TVDBID})
	}
	if len(refs) == 0 {
		return nil, nil
	}
	found, err := r.tgt.Server.FindItems(r.ctx, r.tgt.Conn, refs)
	if err != nil {
		return nil, err
	}
	var out []*mark
	for _, f := range found {
		if f.Ref < 0 || f.Ref >= len(todo) {
			continue
		}
		t := todo[f.Ref]
		err := r.q.InsertMark(r.ctx, db.InsertMarkParams{
			TitleID: t.TitleID, InstanceID: r.tgt.InstanceID, SectionKey: f.Item.SectionKey, ItemID: f.Item.ID, ItemKind: string(f.Item.Kind),
		})
		if err != nil {
			return out, err
		}
		out = append(out, &mark{PlexMark: db.PlexMark{
			TitleID: t.TitleID, InstanceID: r.tgt.InstanceID, SectionKey: f.Item.SectionKey, ItemID: f.Item.ID, ItemKind: string(f.Item.Kind), Labels: "[]",
		}})
	}
	return out, nil
}

// wantedLabels is Requested and one Requested by <name> for each requester.
func wantedLabels(t requests.CompletedTitle) []string {
	out := []string{Label}
	for _, n := range t.Requesters {
		out = append(out, RequestedByPrefix+n)
	}
	return out
}

// label adds the labels the item lacks and takes off the ones of Kestrel's that are no longer wanted.
func (r *run) label(m *mark, t requests.CompletedTitle) error {
	want := wantedLabels(t)
	item := m.item()
	if stale := slices.DeleteFunc(slices.Clone(m.ours), func(l string) bool { return slices.Contains(want, l) }); len(stale) > 0 {
		if err := r.tgt.Server.RemoveLabels(r.ctx, r.tgt.Conn, item, stale); err != nil {
			if gone(err) {
				return r.itemGone(m)
			}
			return r.fail(m, "removing labels", err)
		}
		m.ours = slices.DeleteFunc(m.ours, func(l string) bool { return slices.Contains(stale, l) })
		if err := r.setLabels(m); err != nil {
			return err
		}
	}
	added, err := r.tgt.Server.AddLabels(r.ctx, r.tgt.Conn, item, want)
	if gone(err) {
		return r.itemGone(m)
	}
	if err != nil {
		return r.fail(m, "adding labels", err)
	}
	if len(added) == 0 {
		return nil
	}
	m.ours = append(m.ours, added...)
	if !m.LabelledAt.Valid {
		m.LabelledAt = nullTime(r.now)
	}
	return r.setLabels(m)
}

// badge puts the badge on a poster that has none yet and takes it off once its days are over.
func (r *run) badge(m *mark) error {
	switch {
	case m.badgeOn() && m.BadgePoster.Valid:
		if r.now.Before(parseTime(m.BadgeUntil)) {
			return nil
		}
		return r.restore(m)
	case m.badgeOn(): // the badge went on, and Kestrel did not note which poster it is
		return r.adopt(m)
	case m.BadgeAt.Valid:
		return nil // its days are over: a Title is badged once
	}
	return r.stamp(m)
}

// stamp puts the badge on the poster. The original's key is recorded first, so
// a pass cut short between the upload and its note does not lose the original.
func (r *run) stamp(m *mark) error {
	item := m.item()
	posters, err := r.tgt.Server.Posters(r.ctx, r.tgt.Conn, item)
	if gone(err) {
		return r.itemGone(m)
	}
	if err != nil {
		return r.fail(m, "reading posters", err)
	}
	i := slices.IndexFunc(posters, func(p mediaserver.Poster) bool { return p.Selected })
	if i < 0 {
		return r.fail(m, "badging", errors.New("the item shows no poster Kestrel could put back"))
	}
	m.OriginalPoster = sql.NullString{String: posters[i].Key, Valid: true}
	m.BadgeAt = nullTime(r.now)
	m.BadgeUntil = nullTime(r.now.AddDate(0, 0, max(1, r.sw.BadgeDays)))
	m.BadgePoster = sql.NullString{}
	if err := r.setBadge(m); err != nil {
		return err
	}
	return r.upload(m)
}

// upload stamps the poster the item shows and uploads the result.
func (r *run) upload(m *mark) error {
	item := m.item()
	img, err := r.tgt.Server.PosterImage(r.ctx, r.tgt.Conn, item)
	if err == nil {
		var stamped []byte
		if stamped, err = StampJPEG(img.Data); err == nil {
			var up mediaserver.Poster
			if up, err = r.tgt.Server.UploadPoster(r.ctx, r.tgt.Conn, item, mediaserver.Image{ContentType: "image/jpeg", Data: stamped}); err == nil {
				m.BadgePoster = sql.NullString{String: up.Key, Valid: true}
				return r.setBadge(m)
			}
		}
	}
	// Nothing went on: forget the attempt, so the next pass makes it again.
	m.OriginalPoster, m.BadgeAt, m.BadgeUntil = sql.NullString{}, sql.NullString{}, sql.NullString{}
	if err2 := r.setBadge(m); err2 != nil {
		return err2
	}
	if gone(err) {
		return r.itemGone(m)
	}
	return r.fail(m, "stamping the poster", err)
}

// adopt finishes a stamp a pass did not: when the item shows another poster than
// the original, it is the badge; when it still shows the original, stamp again.
func (r *run) adopt(m *mark) error {
	posters, err := r.tgt.Server.Posters(r.ctx, r.tgt.Conn, m.item())
	if gone(err) {
		return r.itemGone(m)
	}
	if err != nil {
		return r.fail(m, "reading posters", err)
	}
	i := slices.IndexFunc(posters, func(p mediaserver.Poster) bool { return p.Selected })
	if i >= 0 && posters[i].Key != m.OriginalPoster.String {
		m.BadgePoster = sql.NullString{String: posters[i].Key, Valid: true}
		return r.setBadge(m)
	}
	return r.upload(m)
}

// collection keeps the smart collection in a section that holds a marked item,
// and removes the one Kestrel made from a section that holds none.
func (r *run) collection(section string, marks []*mark) error {
	marked := r.sw.Labels && slices.ContainsFunc(marks, func(m *mark) bool { return m.SectionKey == section && slices.Contains(m.ours, Label) })
	var err error
	if marked {
		err = r.tgt.Server.EnsureCollection(r.ctx, r.tgt.Conn, section, Collection, Label)
	} else {
		err = r.tgt.Server.RemoveCollection(r.ctx, r.tgt.Conn, section, Collection, Label)
	}
	if err != nil && !abort(err) {
		r.Logger().Warn("keeping the Requested collection in Plex failed", "section", section, "err", err)
		r.errs = append(r.errs, fmt.Errorf("section %s: collection: %w", section, err))
		return nil
	}
	return err
}
