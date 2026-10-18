package profiles

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"

	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/scoring/profiles/db"
	"github.com/hyprsh/kestrel/internal/settings"
	"github.com/hyprsh/kestrel/internal/slot"
	"github.com/hyprsh/kestrel/internal/store"
)

// Language is the household's Primary Language as ISO 639-1: English, German
// or French (ADR 0005).
type Language string

const (
	English Language = "en"
	German  Language = "de"
	French  Language = "fr"
)

// Release is the *arr language the scoring and parsing stages use.
func (l Language) Release() release.Language {
	switch l {
	case German:
		return release.LangGerman
	case French:
		return release.LangFrench
	}
	return release.LangEnglish
}

// DefaultCountry is the release-date country prefilled for a Primary Language.
func (l Language) DefaultCountry() string {
	switch l {
	case German:
		return "DE"
	case French:
		return "FR"
	}
	return "US"
}

// Region is the household's language settings.
type Region struct {
	Primary Language
	// Country is the ISO 3166-1 alpha-2 release-date country: "released" is read for it.
	Country string
}

// RegionPatch changes the Region; nil fields stay.
type RegionPatch struct {
	Primary *Language
	Country *string
}

// Patch changes one Profile's settings; nil fields stay.
type Patch struct {
	Enabled          *bool
	OriginalFallback *bool
	DefaultMovies    *bool
	DefaultSeries    *bool
}

// ErrNotFound is returned for a Profile key that does not exist.
var ErrNotFound = errors.New("profile not found")

// ValidationError is a rejected write. Field is an API field name.
type ValidationError struct {
	Field, Code, Message string
}

func (e *ValidationError) Error() string { return e.Field + ": " + e.Message }

func invalid(field, msg string) *ValidationError {
	return &ValidationError{Field: field, Code: "invalid", Message: msg}
}

const (
	regionKey = "language_region"
)

type regionDoc struct {
	PrimaryLanguage    Language `json:"primary_language"`
	ReleaseDateCountry string   `json:"release_date_country"`
}

var countryRE = regexp.MustCompile(`^[A-Z]{2}$`)

// Service reads and writes the Profiles, and the Primary Language.
type Service struct {
	st       *store.Store
	settings *settings.Settings
	tx       *sql.Tx // set by InTx: writes join the caller's transaction
	live     *scoring.Holder
}

// InTx returns a Service whose settings and Profile writes run inside tx; the
// caller commits or rolls back.
func (s *Service) InTx(tx *sql.Tx) *Service {
	return &Service{st: s.st, settings: s.settings.InTx(tx), tx: tx, live: s.live}
}

// UseScoring makes the Service back Profiles with the live TRaSH snapshot
// instead of the embedded one. Call it before the Service is shared.
func (s *Service) UseScoring(h *scoring.Holder) { s.live = h }

// New returns a Service over st. settings holds the language document.
func New(st *store.Store, s *settings.Settings) *Service {
	return &Service{st: st, settings: s}
}

func fromRow(r db.Profile) Profile {
	sl, _ := slot.Parse(r.Slot) // the table CHECK keeps the value valid
	rule := scoring.PrimaryLanguage
	if r.LanguageRule == "original" {
		rule = scoring.OriginalLanguage
	}
	return Profile{
		Key: r.Key, Name: r.Name, Slot: sl, Any: r.Any == 1, Rule: rule,
		MinHeight: int(r.MinHeight), MaxHeight: int(r.MaxHeight),
		Enabled: r.Enabled == 1, OriginalFallback: r.OriginalFallback == 1,
		DefaultMovies: r.DefaultMovies == 1, DefaultSeries: r.DefaultSeries == 1,
		TrashMovies: r.TrashProfileMovies, TrashSeries: r.TrashProfileSeries,
	}
}

// List returns the six Profiles in display order.
func (s *Service) List(ctx context.Context) ([]Profile, error) {
	rows, err := db.New(s.st.Read()).ListProfiles(ctx)
	if err != nil {
		return nil, err
	}
	return convert(rows), nil
}

func convert(rows []db.Profile) []Profile {
	out := make([]Profile, len(rows))
	for i, r := range rows {
		out[i] = fromRow(r)
	}
	return out
}

func (s *Service) write(ctx context.Context, f func(*db.Queries) error) error {
	if s.tx != nil {
		return f(db.New(s.tx))
	}
	// One write connection: check-then-write inside a transaction cannot race.
	tx, err := s.st.Write().BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := f(db.New(tx)); err != nil {
		return err
	}
	return tx.Commit()
}

func b2i(b bool) int64 {
	if b {
		return 1
	}
	return 0
}

// Patch changes one Profile. A rejected patch changes nothing. The rules
// (PRD Settled 1 and 8): Original-Language Profiles never take
// original_fallback; a Slot has at most one default per kind, so a new default
// replaces the old; the Standard Slot always keeps exactly one default per kind, so unsetting
// or disabling it is refused until another Standard Profile is the default; a
// disabled Profile is no default, and disabling clears its flags.
func (s *Service) Patch(ctx context.Context, key string, p Patch) (Profile, error) {
	var out Profile
	err := s.write(ctx, func(q *db.Queries) error {
		rows, err := q.ListProfiles(ctx)
		if err != nil {
			return err
		}
		var cur Profile
		found := false
		for _, r := range rows {
			if r.Key == key {
				cur, found = fromRow(r), true
			}
		}
		if !found {
			return ErrNotFound
		}
		next := cur
		if p.Enabled != nil {
			next.Enabled = *p.Enabled
		}
		if p.OriginalFallback != nil {
			next.OriginalFallback = *p.OriginalFallback
		}
		if p.DefaultMovies != nil {
			next.DefaultMovies = *p.DefaultMovies
		}
		if p.DefaultSeries != nil {
			next.DefaultSeries = *p.DefaultSeries
		}
		if next.OriginalFallback && next.Rule == scoring.OriginalLanguage {
			return invalid("original_fallback", "An Original-Language Profile already requires the Original Language, so it has no fallback")
		}
		// Disabling clears the flags, unless the patch itself sets one on a disabled Profile.
		if !next.Enabled {
			if p.DefaultMovies != nil && *p.DefaultMovies {
				return invalid("default_movies", "A disabled Profile cannot be a default")
			}
			if p.DefaultSeries != nil && *p.DefaultSeries {
				return invalid("default_series", "A disabled Profile cannot be a default")
			}
			next.DefaultMovies, next.DefaultSeries = false, false
		}
		if cur.Slot == slot.Standard {
			if cur.DefaultMovies && !next.DefaultMovies {
				return standardDefaultError(p, "default_movies", "movies")
			}
			if cur.DefaultSeries && !next.DefaultSeries {
				return standardDefaultError(p, "default_series", "series")
			}
		}

		slotKey := cur.Slot.Key()
		if next.DefaultMovies && !cur.DefaultMovies {
			if err := q.ClearSlotDefaultMovies(ctx, slotKey); err != nil {
				return err
			}
		}
		if next.DefaultSeries && !cur.DefaultSeries {
			if err := q.ClearSlotDefaultSeries(ctx, slotKey); err != nil {
				return err
			}
		}
		if err := q.SetProfileEnabled(ctx, db.SetProfileEnabledParams{Enabled: b2i(next.Enabled), Key: key}); err != nil {
			return err
		}
		if err := q.SetProfileOriginalFallback(ctx, db.SetProfileOriginalFallbackParams{OriginalFallback: b2i(next.OriginalFallback), Key: key}); err != nil {
			return err
		}
		if err := q.SetProfileDefaultMovies(ctx, db.SetProfileDefaultMoviesParams{DefaultMovies: b2i(next.DefaultMovies), Key: key}); err != nil {
			return err
		}
		if err := q.SetProfileDefaultSeries(ctx, db.SetProfileDefaultSeriesParams{DefaultSeries: b2i(next.DefaultSeries), Key: key}); err != nil {
			return err
		}
		out = next
		return nil
	})
	return out, err
}

func standardDefaultError(p Patch, field, kind string) error {
	if p.Enabled != nil && !*p.Enabled && (field == "default_movies" && p.DefaultMovies == nil || field == "default_series" && p.DefaultSeries == nil) {
		field = "enabled"
	}
	return invalid(field, "The Standard Slot always has a default for "+kind+": make another Standard Profile the default first")
}

// Region returns the language settings and whether they were ever saved.
// Unsaved, it is English with the US as release-date country.
func (s *Service) Region(ctx context.Context) (Region, bool, error) {
	raw, ok, err := s.settings.Get(ctx, regionKey)
	if err != nil {
		return Region{}, false, err
	}
	if !ok {
		return Region{Primary: English, Country: English.DefaultCountry()}, false, nil
	}
	var d regionDoc
	if err := json.Unmarshal(raw, &d); err != nil {
		return Region{}, false, fmt.Errorf("profiles: stored %s is invalid: %w", regionKey, err)
	}
	return Region{Primary: d.PrimaryLanguage, Country: d.ReleaseDateCountry}, true, nil
}

// SetRegion saves the language settings. Changing the Primary Language without
// naming a country moves the country to the new language's default; naming one
// keeps it. A new Primary Language re-points the eight Profiles to their
// backing TRaSH profiles (Settled 5). Re-scoring the stored files is the
// caller's job (trash.Service.ChangeLanguage); nothing is renamed or searched.
func (s *Service) SetRegion(ctx context.Context, p RegionPatch) (Region, error) {
	cur, _, err := s.Region(ctx)
	if err != nil {
		return Region{}, err
	}
	next := cur
	if p.Primary != nil {
		switch *p.Primary {
		case English, German, French:
		default:
			return Region{}, invalid("primary_language", "Primary Language must be en, de or fr")
		}
		next.Primary = *p.Primary
		if p.Country == nil && next.Primary != cur.Primary {
			next.Country = next.Primary.DefaultCountry()
		}
	}
	if p.Country != nil {
		if !countryRE.MatchString(*p.Country) {
			return Region{}, invalid("release_date_country", "Use a two-letter uppercase country code such as US, DE or FR")
		}
		next.Country = *p.Country
	}
	var snap *scoring.Snapshot
	if s.live != nil {
		snap = s.live.Current()
	} else if snap, err = scoring.Embedded(); err != nil {
		return Region{}, err
	}
	err = s.write(ctx, func(q *db.Queries) error {
		rows, err := q.ListProfiles(ctx)
		if err != nil {
			return err
		}
		for _, p := range convert(rows) {
			sp, err := snap.Profile(p.Spec(next.Primary.Release()))
			if err != nil {
				return fmt.Errorf("profiles: back %s under %s: %w", p.Key, next.Primary, err)
			}
			if err := q.SetProfileTrash(ctx, db.SetProfileTrashParams{
				TrashProfileMovies: sp.BackingProfile(release.KindMovie),
				TrashProfileSeries: sp.BackingProfile(release.KindSeries),
				Key:                p.Key,
			}); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return Region{}, err
	}
	raw, _ := json.Marshal(regionDoc{PrimaryLanguage: next.Primary, ReleaseDateCountry: next.Country})
	if err := s.settings.Put(ctx, regionKey, raw); err != nil {
		return Region{}, err
	}
	return next, nil
}
