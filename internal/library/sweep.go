package library

import (
	"context"
	"database/sql"
	"slices"
	"time"

	"github.com/hyprsh/kestrel/internal/library/db"
	"github.com/hyprsh/kestrel/internal/slot"
)

// The sweeps' cadences.
const (
	oneDay = 24 * time.Hour
	// UpgradeEvery is how long a Filled Version waits between Upgrade searches.
	UpgradeEvery = 30 * oneDay
	// LongMissingEvery is how often a Long Missing Version is searched, forever.
	LongMissingEvery = 30 * oneDay
	// RetryAfter is when a search that could not be completed (an indexer failed, a
	// Grab could not be sent) is tried again.
	RetryAfter = 15 * time.Minute
)

// NextMissing is when a Version that is Wanted since `since` and was searched at
// `searched` is searched next: one day, three days and seven days after it
// became Wanted, then weekly, then every 30 days once it is Long Missing. It
// never gives up.
func NextMissing(since, searched time.Time) time.Time {
	age := searched.Sub(since)
	for _, m := range []time.Duration{oneDay, 3 * oneDay, 7 * oneDay} {
		if age < m {
			return since.Add(m)
		}
	}
	if age <= LongMissingAfter {
		return searched.Add(7 * oneDay)
	}
	return searched.Add(LongMissingEvery)
}

// WithCountry sets where the household's release-date country comes from;
// without it the sweeps read Movie release dates with no country in mind.
func (s *Service) WithCountry(f func(context.Context) string) *Service {
	s.country = f
	return s
}

// sweepRow is one search_state row with what the sweeps need to know of its Version.
type sweepRow struct {
	id, versionID, titleID   int64
	nextMissing, lastMissing *time.Time
	fresh                    bool // added in the UI or by a Request and not searched yet
	nextUpgrade, lastUpgrade *time.Time
	wanted                   bool
	since                    time.Time // when it became Wanted: the latest among a season's Wanted episodes
	released                 time.Time // when a Movie came out in the household's country; zero if unknown or a Series
	versionFilled            bool      // the Version as a whole is Filled: it is up for Upgrades
}

func optTime(n sql.NullString) *time.Time {
	if !n.Valid {
		return nil
	}
	t := parseTime(n.String)
	return &t
}

// sweepRows reads every search_state row of a monitored Title and works out, at
// now, whether it is Wanted and since when. Unmonitored Titles get no rows.
func (s *Service) sweepRows(ctx context.Context, now time.Time) ([]sweepRow, error) {
	q := db.New(s.st.Read())
	states, err := q.ListSearchStates(ctx)
	if err != nil {
		return nil, err
	}
	if len(states) == 0 {
		return nil, nil
	}
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
	misfits, err := misfitSet(ctx, q)
	if err != nil {
		return nil, err
	}
	country := ""
	if s.country != nil {
		country = s.country(ctx)
	}

	titleOf := map[int64]db.Title{}
	for _, t := range titles {
		titleOf[t.ID] = t
	}
	versionOf := map[int64]db.Version{}
	for _, v := range versions {
		versionOf[v.ID] = v
	}
	hasFile := map[int64]bool{}
	for _, f := range files {
		hasFile[f.VersionID] = hasFile[f.VersionID] || !misfits[f.ID]
	}
	datesOf := map[int64][]db.TitleReleaseDate{}
	for _, d := range dates {
		datesOf[d.TitleID] = append(datesOf[d.TitleID], d)
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
	firstFiled, err := q.ListFirstFiled(ctx)
	if err != nil {
		return nil, err
	}
	filed := filedOf(firstFiled)
	releasedBy := map[int64]map[int64]*time.Time{} // per Title: releasedOf over all its episodes

	var out []sweepRow
	for _, st := range states {
		v, ok := versionOf[st.VersionID]
		if !ok {
			continue
		}
		t := titleOf[v.TitleID]
		if t.Monitored != 1 || (st.Season.Valid == (Kind(t.Kind) == Movie)) {
			continue
		}
		r := sweepRow{
			id: st.ID, versionID: st.VersionID, titleID: v.TitleID,
			nextMissing: optTime(st.NextMissingAt), lastMissing: optTime(st.LastMissingAt),
			nextUpgrade: optTime(st.NextUpgradeAt), lastUpgrade: optTime(st.LastUpgradeAt),
			fresh: st.Fresh == 1 && !st.LastMissingAt.Valid,
		}
		added := parseTime(v.AddedAt)
		if Kind(t.Kind) == Movie {
			u := Unit{Monitored: true, HasFile: hasFile[v.ID], AddedAt: added}
			if released, ok := releaseDatesOf(datesOf[t.ID]).Released(country); ok {
				u.Released = &released
				r.released = released
			}
			state, since := StateAt(u, now)
			r.versionFilled = state == Filled
			if state == Wanted {
				r.wanted, r.since = true, *since
			}
		} else {
			released, ok := releasedBy[t.ID]
			if !ok {
				released = releasedOf(epsOf[t.ID], filed)
				releasedBy[t.ID] = released
			}
			var season []db.Episode
			for _, e := range epsOf[t.ID] {
				if e.Season == st.Season.Int64 {
					season = append(season, e)
				}
			}
			for _, u := range unitsOf(season, released, heldBy[v.ID], added) {
				if state, since := StateAt(u, now); state == Wanted {
					if !r.wanted || since.After(r.since) {
						r.since = *since
					}
					r.wanted = true
				}
			}
			state, _ := SeriesState(unitsOf(epsOf[t.ID], released, heldBy[v.ID], added), now)
			r.versionFilled = state == Filled
		}
		out = append(out, r)
	}
	return out, nil
}

// recency is how recently the row's content came out: a Movie's release date,
// else when it became Wanted (a Series season: its latest aired episode).
func (r sweepRow) recency() time.Time {
	if !r.released.IsZero() {
		return r.released
	}
	return r.since
}

// dueAt is when a Wanted row is next searched. A Wanted episode that appeared
// after the last search (one just aired) restarts the early cadence: the row is
// searched a day after it became Wanted, whatever was scheduled.
func (r sweepRow) dueAt() (time.Time, bool) {
	if !r.wanted || r.nextMissing == nil {
		return time.Time{}, false
	}
	at := *r.nextMissing
	if r.lastMissing != nil && r.since.After(*r.lastMissing) {
		if early := r.since.Add(oneDay); early.Before(at) {
			at = early
		}
	}
	return at, true
}

// DueMissing lists the Versions of monitored Titles with something Wanted whose
// next missing search is due at now. The order is the sweep's, for a budget that
// may run out: Versions a Request added first, then the most recently released.
// A Series Version has a search_state row per season and is listed once,
// however many seasons are due.
func (s *Service) DueMissing(ctx context.Context, now time.Time) ([]Due, error) {
	rows, err := s.sweepRows(ctx, now)
	if err != nil {
		return nil, err
	}
	requested, err := s.requestAdded(ctx)
	if err != nil {
		return nil, err
	}
	type entry struct {
		Due
		released  time.Time
		requested bool
		fresh     bool
	}
	var found []entry
	index := map[int64]int{}
	for _, r := range rows {
		at, ok := r.dueAt()
		if !ok || at.After(now) {
			continue
		}
		if i, seen := index[r.versionID]; seen {
			if k := r.recency(); k.After(found[i].released) {
				found[i].released = k
			}
			found[i].fresh = found[i].fresh && r.fresh
			continue
		}
		index[r.versionID] = len(found)
		found = append(found, entry{Due{VersionID: r.versionID, TitleID: r.titleID}, r.recency(), requested[r.versionID], r.fresh})
	}
	slices.SortStableFunc(found, func(a, b entry) int {
		if a.requested != b.requested {
			if a.requested {
				return -1
			}
			return 1
		}
		return b.released.Compare(a.released)
	})
	out := make([]Due, len(found))
	for i, f := range found {
		out[i] = f.Due
		out[i].Fresh = f.fresh
	}
	return out, nil
}

// requestAdded is the Versions a Request added (requests keeps the link).
func (s *Service) requestAdded(ctx context.Context) (map[int64]bool, error) {
	rows, err := s.st.Read().QueryContext(ctx, `SELECT DISTINCT version_id FROM request_slots WHERE version_id IS NOT NULL`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]bool{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = true
	}
	return out, rows.Err()
}

// MarkMissingSearched records that a Version was searched for what it is missing
// at `at` and schedules each of its Wanted rows (a Series Version has one per
// season) by the cadence. A search that could not finish (failed) is tried again
// after RetryAfter. A completed search also counts as the Version's Upgrade
// search: its next one is UpgradeEvery away.
func (s *Service) MarkMissingSearched(ctx context.Context, versionID int64, at time.Time, failed bool) error {
	rows, err := s.sweepRows(ctx, at)
	if err != nil {
		return err
	}
	q := db.New(s.st.Write())
	for _, r := range rows {
		if r.versionID != versionID || !r.wanted {
			continue
		}
		next := at.Add(RetryAfter)
		if !failed {
			next = NextMissing(r.since, at)
		}
		if err := q.MarkSearchStateMissing(ctx, db.MarkSearchStateMissingParams{
			LastMissingAt: sql.NullString{String: ts(at), Valid: true}, NextMissingAt: sql.NullString{String: ts(next), Valid: true}, ID: r.id,
		}); err != nil {
			return err
		}
		if !failed {
			if err := q.SetSearchStateNextUpgrade(ctx, db.SetSearchStateNextUpgradeParams{
				NextUpgradeAt: sql.NullString{String: ts(at.Add(UpgradeEvery)), Valid: true}, ID: r.id,
			}); err != nil {
				return err
			}
		}
	}
	return nil
}

// DueUpgrades lists the Filled Versions of monitored Titles whose next Upgrade
// search is due at now, the one searched longest ago first (never-searched ones
// first of all). limit > 0 keeps that many.
func (s *Service) DueUpgrades(ctx context.Context, now time.Time, limit int) ([]Due, error) {
	rows, err := s.sweepRows(ctx, now)
	if err != nil {
		return nil, err
	}
	type entry struct {
		Due
		next time.Time
		last *time.Time
	}
	var found []entry
	index := map[int64]int{}
	for _, r := range rows {
		if !r.versionFilled || r.nextUpgrade == nil || r.nextUpgrade.After(now) {
			continue
		}
		if i, seen := index[r.versionID]; seen {
			if r.nextUpgrade.Before(found[i].next) {
				found[i].next = *r.nextUpgrade
			}
			if r.lastUpgrade != nil && (found[i].last == nil || r.lastUpgrade.Before(*found[i].last)) {
				found[i].last = r.lastUpgrade
			}
			continue
		}
		index[r.versionID] = len(found)
		found = append(found, entry{Due{VersionID: r.versionID, TitleID: r.titleID}, *r.nextUpgrade, r.lastUpgrade})
	}
	slices.SortStableFunc(found, func(a, b entry) int {
		switch {
		case a.last == nil && b.last == nil:
			return a.next.Compare(b.next)
		case a.last == nil:
			return -1
		case b.last == nil:
			return 1
		}
		return a.last.Compare(*b.last)
	})
	if limit > 0 && len(found) > limit {
		found = found[:limit]
	}
	out := make([]Due, len(found))
	for i, f := range found {
		out[i] = f.Due
	}
	return out, nil
}

// MarkUpgradeSearched records an Upgrade search of a Version at `at`: the next one
// is UpgradeEvery later, or after RetryAfter when the search could not finish.
func (s *Service) MarkUpgradeSearched(ctx context.Context, versionID int64, at time.Time, failed bool) error {
	next := at.Add(UpgradeEvery)
	if failed {
		next = at.Add(RetryAfter)
	}
	return db.New(s.st.Write()).MarkUpgradeSearched(ctx, db.MarkUpgradeSearchedParams{
		LastUpgradeAt: sql.NullString{String: ts(at), Valid: true}, NextUpgradeAt: sql.NullString{String: ts(next), Valid: true}, VersionID: versionID,
	})
}

// SearchAllWanted makes every Wanted row due now ("Search all Wanted") and
// returns how many Versions that is; the caller kicks the sweep.
func (s *Service) SearchAllWanted(ctx context.Context) (int, error) {
	versions, err := s.searchWanted(ctx, func(int64) bool { return true })
	if err != nil {
		return 0, err
	}
	n := 0
	for _, vs := range versions {
		n += len(vs)
	}
	return n, nil
}

// SearchAfterPause makes due now what the sweep searched while Grabs were
// paused, since `since`, so the next sweep can grab it: every Wanted row and
// every Upgrade search made since then. The caller kicks the sweep.
func (s *Service) SearchAfterPause(ctx context.Context, since time.Time) error {
	if _, err := s.SearchAllWanted(ctx); err != nil {
		return err
	}
	return db.New(s.st.Write()).SetUpgradesDueSince(ctx, db.SetUpgradesDueSinceParams{
		NextUpgradeAt: sql.NullString{String: ts(s.clock()), Valid: true},
		LastUpgradeAt: sql.NullString{String: ts(since), Valid: true},
	})
}

// SearchWanted makes the Wanted rows of the given Titles due now and returns,
// per Title, how many of its Versions that is; a Title with nothing Wanted is
// left out. The caller kicks the sweep.
func (s *Service) SearchWanted(ctx context.Context, titleIDs []int64) (map[int64]int, error) {
	want := make(map[int64]bool, len(titleIDs))
	for _, id := range titleIDs {
		want[id] = true
	}
	versions, err := s.searchWanted(ctx, func(id int64) bool { return want[id] })
	if err != nil {
		return nil, err
	}
	out := make(map[int64]int, len(versions))
	for id, vs := range versions {
		out[id] = len(vs)
	}
	return out, nil
}

// searchWanted makes the Wanted rows of the Titles that pass due now and
// returns the Versions it touched by Title.
func (s *Service) searchWanted(ctx context.Context, title func(int64) bool) (map[int64]map[int64]bool, error) {
	now := s.clock()
	rows, err := s.sweepRows(ctx, now)
	if err != nil {
		return nil, err
	}
	q := db.New(s.st.Write())
	versions := map[int64]map[int64]bool{}
	for _, r := range rows {
		if !r.wanted || !title(r.titleID) {
			continue
		}
		if err := q.SetSearchStateNextMissing(ctx, db.SetSearchStateNextMissingParams{
			NextMissingAt: sql.NullString{String: ts(now), Valid: true}, ID: r.id,
		}); err != nil {
			return nil, err
		}
		if versions[r.titleID] == nil {
			versions[r.titleID] = map[int64]bool{}
		}
		versions[r.titleID][r.versionID] = true
	}
	return versions, nil
}

// LongMissingItem is a Version that has been Wanted for more than LongMissingAfter.
type LongMissingItem struct {
	TitleID     int64
	VersionID   int64
	Title       string
	Slot        slot.Slot
	Profile     string
	WantedSince time.Time
}

// LongMissing lists every Long Missing Version, most recently Wanted first.
func (s *Service) LongMissing(ctx context.Context, view View) ([]LongMissingItem, error) {
	rows, err := s.List(ctx, view, Filter{})
	if err != nil {
		return nil, err
	}
	var out []LongMissingItem
	for _, r := range rows {
		for class, sl := range r.Slots {
			if sl != nil && sl.LongMissing && sl.WantedSince != nil {
				out = append(out, LongMissingItem{
					TitleID: r.ID, VersionID: sl.VersionID, Title: r.Title, Slot: slot.Slot(class), Profile: sl.Profile, WantedSince: *sl.WantedSince,
				})
			}
		}
	}
	slices.SortStableFunc(out, func(a, b LongMissingItem) int {
		if c := b.WantedSince.Compare(a.WantedSince); c != 0 {
			return c
		}
		return int(a.VersionID - b.VersionID)
	})
	return out, nil
}
