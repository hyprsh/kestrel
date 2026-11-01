package profiles

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"strings"

	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/scoring/profiles/db"
)

// Create makes a custom Profile named name as a copy of the Profile copyKey: the same Slot, language rule,
// resolutions, TRaSH backing and settings on top of TRaSH. It starts enabled and is no default. A rejection is a
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
			Key: key, Name: name, Sort: toInt64(top) + 1, Slot: src.Slot, Any: src.Any, LanguageRule: src.LanguageRule,
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
// (ErrInUse); a rejection for the first is a *ValidationError.
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
}

// BelowCutoff counts the files below their Profile's cutoff under the active snapshot.
func (s *Service) BelowCutoff(ctx context.Context) (Cutoffs, error) {
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
	out := Cutoffs{ByProfile: map[string]int{}}
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
		}
	}
	return out, nil
}
