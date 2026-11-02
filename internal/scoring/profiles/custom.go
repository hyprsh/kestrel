package profiles

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/scoring/profiles/db"
)

// Create makes a custom Profile named name as a copy of the Profile copyKey: the same language rule,
// resolutions, TRaSH backing and settings on top of TRaSH. It starts enabled. A rejection is a
// *ValidationError, or ErrNotFound for a copyKey that does not exist.
func (s *Service) Create(ctx context.Context, name, copyKey string) (Profile, error) {
	name = strings.TrimSpace(name)
	var out Profile
	err := s.write(ctx, func(q *db.Queries) error {
		rows, err := q.ListProfiles(ctx)
		if err != nil {
			return err
		}
		var src *db.Profile
		for i := range rows {
			if rows[i].Key == copyKey {
				src = &rows[i]
			}
		}
		if src == nil {
			return ErrNotFound
		}
		if err := checkName(name, "", rows); err != nil {
			return err
		}
		top, err := q.MaxProfileSort(ctx)
		if err != nil {
			return err
		}
		var b [4]byte
		_, _ = rand.Read(b[:])
		key := "custom-" + hex.EncodeToString(b[:])
		if err := q.InsertCustomProfile(ctx, db.InsertCustomProfileParams{
			Key: key, Name: name, Sort: toInt64(top) + 1, Any: src.Any, ReleaseFamily: src.ReleaseFamily, LanguageRule: src.LanguageRule,
			MinHeight: src.MinHeight, MaxHeight: src.MaxHeight, OriginalFallback: src.OriginalFallback,
			TrashProfileMovies: src.TrashProfileMovies, TrashProfileSeries: src.TrashProfileSeries, OriginalLanguage: src.OriginalLanguage,
			SeriesQualities: src.SeriesQualities, MovieQualities: src.MovieQualities, SeriesCutoff: src.SeriesCutoff, MovieCutoff: src.MovieCutoff,
			UpgradeUntil: src.UpgradeUntil, MinScore: src.MinScore, MovieMinSize: src.MovieMinSize, MovieMaxSize: src.MovieMaxSize,
			EpisodeMinSize: src.EpisodeMinSize, EpisodeMaxSize: src.EpisodeMaxSize,
		}); err != nil {
			return err
		}
		rows, err = q.ListProfiles(ctx)
		if err != nil {
			return err
		}
		for _, r := range rows {
			if r.Key == key {
				out, err = fromRow(r)
				return err
			}
		}
		return ErrNotFound
	})
	return out, err
}

func toInt64(v interface{}) int64 {
	switch n := v.(type) {
	case int64:
		return n
	case int:
		return int64(n)
	case float64:
		return int64(n)
	}
	return 0
}

// Delete removes a custom Profile. A builtin Profile cannot be deleted, and neither can one a Version still uses
// (ErrInUse) or a Slot names as its default (*DefaultError); a rejection for the first is a *ValidationError.
func (s *Service) Delete(ctx context.Context, key string) error {
	return s.write(ctx, func(q *db.Queries) error {
		rows, err := q.ListProfiles(ctx)
		if err != nil {
			return err
		}
		var cur *db.Profile
		for i := range rows {
			if rows[i].Key == key {
				cur = &rows[i]
			}
		}
		switch {
		case cur == nil:
			return ErrNotFound
		case cur.Custom != 1:
			return invalid("key", "A builtin Profile cannot be deleted")
		}
		if err := notADefault(ctx, q, key); err != nil {
			return err
		}
		n, err := q.ProfileVersionCount(ctx, key)
		if err != nil {
			return err
		}
		if n > 0 {
			return ErrInUse
		}
		_, err = q.DeleteCustomProfile(ctx, key)
		return err
	})
}

// Version names a Version by its Title.
type Version struct{ TitleID, VersionID int64 }

// Versions lists the Versions under the Profile.
func (s *Service) Versions(ctx context.Context, key string) ([]Version, error) {
	rows, err := db.New(s.st.Read()).VersionsUnderProfile(ctx, key)
	if err != nil {
		return nil, err
	}
	out := make([]Version, len(rows))
	for i, r := range rows {
		out[i] = Version{TitleID: r.TitleID, VersionID: r.VersionID}
	}
	return out, nil
}

// Cutoffs says how many files are below their Profile's cutoff: files that fit their Version, whose Profile
// limits upgrades for the Title's kind (a cutoff quality or an Upgrade-until Score) and that have not reached it.
type Cutoffs struct {
	// ByProfile counts them per Profile key; a Profile with none is absent.
	ByProfile map[string]int
	Total     int
	// ByVersion counts, per Version, the episodes that wait for an Upgrade (a Movie's file counts as one).
	ByVersion map[int64]int
}

// cutoffCache keeps the last answer of BelowCutoff with the fingerprint of what it was computed from.
type cutoffCache struct {
	mu    sync.Mutex
	key   string
	val   Cutoffs
	valid bool
	scans atomic.Int64
	// version and snap are the database's data version and the scoring snapshot of the last fingerprint: while both stand
	// nothing it reads has changed, and the key is not computed again.
	version int64
	snap    any
}

// CutoffScans is how many times BelowCutoff has scanned the library's files rather than answered from its cache.
func (s *Service) CutoffScans() int64 { return s.cutoffs.scans.Load() }

// cutoffKey fingerprints everything BelowCutoff reads: the files, their Scores, parses, misfits and episodes (a few
// aggregates, no parsing), each Version's Profile, the Profiles themselves (their cutoffs, Upgrade-until Scores and qualities), the
// Primary Language and the scoring snapshot. Any change to any of them, from whichever module made it, changes the key.
func (s *Service) cutoffKey(ctx context.Context) (string, error) {
	q := db.New(s.st.Read())
	in, err := q.CutoffInputs(ctx)
	if err != nil {
		return "", err
	}
	versions, err := q.VersionProfileKeys(ctx)
	if err != nil {
		return "", err
	}
	rows, err := q.ListProfiles(ctx)
	if err != nil {
		return "", err
	}
	region, _, err := s.Region(ctx)
	if err != nil {
		return "", err
	}
	snap, err := s.snapshot()
	if err != nil {
		return "", err
	}
	h := sha256.New()
	fmt.Fprintf(h, "%+v\n%+v\n%+v\n%v\n%p", in, versions, rows, region.Primary, snap)
	return hex.EncodeToString(h.Sum(nil)), nil
}

// BelowCutoff counts the files below their Profile's cutoff under the active snapshot. The answer is kept in memory and
// recomputed on the next call after a file is imported, replaced or deleted, a Version changes Profile, or a Profile, its
// cutoff or Upgrade-until Score, the Primary Language or the scoring snapshot changes (see cutoffKey). It must be read, not changed.
func (s *Service) BelowCutoff(ctx context.Context) (Cutoffs, error) {
	version, err := s.st.DataVersion(ctx)
	if err != nil {
		return Cutoffs{}, err
	}
	snap, err := s.snapshot()
	if err != nil {
		return Cutoffs{}, err
	}
	c := s.cutoffs
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.valid && c.version == version && c.snap == any(snap) {
		return c.val, nil
	}
	key, err := s.cutoffKey(ctx)
	if err != nil {
		return Cutoffs{}, err
	}
	if c.valid && c.key == key {
		c.version, c.snap = version, snap
		return c.val, nil
	}
	c.scans.Add(1)
	val, err := s.scanCutoffs(ctx)
	if err != nil {
		return Cutoffs{}, err
	}
	c.key, c.val, c.valid, c.version, c.snap = key, val, true, version, snap
	return val, nil
}

// scanCutoffs reads every file and counts the ones below their Profile's cutoff.
func (s *Service) scanCutoffs(ctx context.Context) (Cutoffs, error) {
	all, err := s.List(ctx)
	if err != nil {
		return Cutoffs{}, err
	}
	rows, err := db.New(s.st.Read()).CutoffFiles(ctx)
	if err != nil {
		return Cutoffs{}, err
	}
	resolved := map[string]*scoring.Profile{}
	for _, p := range all {
		if sp, err := s.Resolve(ctx, p); err == nil {
			resolved[p.Key] = sp
		}
	}
	out := Cutoffs{ByProfile: map[string]int{}, ByVersion: map[int64]int{}}
	for _, r := range rows {
		p := resolved[r.ProfileKey]
		if p == nil {
			continue
		}
		kind := release.KindSeries
		if r.Kind == "movie" {
			kind = release.KindMovie
		}
		if !p.UpgradesLimited(kind) {
			continue
		}
		var parsed struct {
			Quality struct {
				Quality struct {
					Name string `json:"name"`
				} `json:"quality"`
			} `json:"quality"`
		}
		if r.ParsedRelease.Valid {
			_ = json.Unmarshal([]byte(r.ParsedRelease.String), &parsed)
		}
		if !p.AtCutoff(kind, parsed.Quality.Quality.Name, int(r.Score.Int64)) {
			out.ByProfile[r.ProfileKey]++
			out.Total++
			n := int(r.Episodes)
			if n < 1 {
				n = 1
			}
			out.ByVersion[r.VersionID] += n
		}
	}
	return out, nil
}
