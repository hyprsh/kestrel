package profiles

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"slices"
	"strings"

	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/scoring/profiles/db"
	"github.com/hyprsh/kestrel/internal/settings"
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
	Enabled        *bool
	OriginalChoice *scoring.OriginalChoice
	// Name renames a custom Profile; a builtin one keeps its name.
	Name *string
	// Overlay replaces everything the household set on top of TRaSH (ADR 0023).
	Overlay *scoring.Overlay
}

// ErrNotFound is returned for a Profile key that does not exist.
var ErrNotFound = errors.New("profile not found")

// ErrInUse is returned when deleting a Profile that Versions still use.
var ErrInUse = errors.New("profile is in use")

// DefaultError is returned when disabling or deleting a Profile that Slots name as their default (ADR 0024):
// the default has to change first. Slots holds their ids.
type DefaultError struct {
	Profile string
	Slots   []string
}

func (e *DefaultError) Error() string {
	return fmt.Sprintf("the Profile %s is the default of the %s: choose another default first", e.Profile, strings.Join(e.Slots, " and "))
}

// notADefault is nil unless a Slot names the Profile as its default for a kind.
func notADefault(ctx context.Context, q *db.Queries, key string) error {
	rows, err := q.SlotsDefaulting(ctx, sql.NullString{String: key, Valid: true})
	if err != nil {
		return err
	}
	if len(rows) == 0 {
		return nil
	}
	e := &DefaultError{Profile: key}
	for _, r := range rows {
		e.Slots = append(e.Slots, "Slot "+r.Label)
	}
	return e
}

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
	cutoffs  *cutoffCache // BelowCutoff's last answer; shared by the Service and what InTx makes of it
	log      *slog.Logger // nil logs nothing
}

// InTx returns a Service whose settings and Profile writes run inside tx; the
// caller commits or rolls back.
func (s *Service) InTx(tx *sql.Tx) *Service {
	return &Service{st: s.st, settings: s.settings.InTx(tx), tx: tx, live: s.live, cutoffs: s.cutoffs, log: s.log}
}

// UseScoring makes the Service back Profiles with the live TRaSH snapshot
// instead of the embedded one. Call it before the Service is shared.
func (s *Service) UseScoring(h *scoring.Holder) { s.live = h }

// UseLogger makes the Service log what it changes on its own, such as a Profile a new Primary Language disables.
func (s *Service) UseLogger(l *slog.Logger) { s.log = l }

// New returns a Service over st. settings holds the language document.
func New(st *store.Store, s *settings.Settings) *Service {
	return &Service{st: st, settings: s, cutoffs: &cutoffCache{}}
}

func fromRow(r db.Profile) (Profile, error) {
	rule, named, ok := ParseRule(r.LanguageRule)
	if !ok {
		return Profile{}, fmt.Errorf("profiles: %s has the language rule %q", r.Key, r.LanguageRule)
	}
	series, err := prefsOf(r.SeriesQualities)
	if err != nil {
		return Profile{}, fmt.Errorf("profiles: %s series_qualities: %w", r.Key, err)
	}
	movies, err := prefsOf(r.MovieQualities)
	if err != nil {
		return Profile{}, fmt.Errorf("profiles: %s movie_qualities: %w", r.Key, err)
	}
	return Profile{
		Key: r.Key, Name: r.Name, Any: r.Any == 1, Family: scoring.ReleaseFamily(r.ReleaseFamily), Rule: rule, Named: named,
		MinHeight: int(r.MinHeight), MaxHeight: int(r.MaxHeight),
		Enabled: r.Enabled == 1, OriginalChoice: scoring.OriginalChoice(r.OriginalLanguage),
		TrashMovies: r.TrashProfileMovies, TrashSeries: r.TrashProfileSeries,
		Custom: r.Custom == 1,
		Overlay: scoring.Overlay{
			MinScore: intOf(r.MinScore), UpgradeUntil: intOf(r.UpgradeUntil),
			Series:      scoring.KindOverlay{Qualities: series, Cutoff: r.SeriesCutoff.String},
			Movies:      scoring.KindOverlay{Qualities: movies, Cutoff: r.MovieCutoff.String},
			EpisodeSize: scoring.SizeLimit{Min: r.EpisodeMinSize.Int64, Max: r.EpisodeMaxSize.Int64},
			MovieSize:   scoring.SizeLimit{Min: r.MovieMinSize.Int64, Max: r.MovieMaxSize.Int64},
		},
	}, nil
}

func prefsOf(raw sql.NullString) ([]scoring.QualityPref, error) {
	if !raw.Valid || raw.String == "" {
		return nil, nil
	}
	var out []scoring.QualityPref
	return out, json.Unmarshal([]byte(raw.String), &out)
}

func intOf(n sql.NullInt64) *int {
	if !n.Valid {
		return nil
	}
	v := int(n.Int64)
	return &v
}

func nullInt(v *int) sql.NullInt64 {
	if v == nil {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: int64(*v), Valid: true}
}

// nullBytes stores a size bound; 0 is no bound and stored as NULL.
func nullBytes(v int64) sql.NullInt64 { return sql.NullInt64{Int64: v, Valid: v > 0} }

func nullText(v string) sql.NullString { return sql.NullString{String: v, Valid: v != ""} }

func nullPrefs(prefs []scoring.QualityPref) sql.NullString {
	if len(prefs) == 0 {
		return sql.NullString{}
	}
	raw, _ := json.Marshal(prefs)
	return sql.NullString{String: string(raw), Valid: true}
}

func overlayParams(key string, o scoring.Overlay) db.SetProfileOverlayParams {
	return db.SetProfileOverlayParams{
		SeriesQualities: nullPrefs(o.Series.Qualities), MovieQualities: nullPrefs(o.Movies.Qualities),
		SeriesCutoff: nullText(o.Series.Cutoff), MovieCutoff: nullText(o.Movies.Cutoff),
		UpgradeUntil: nullInt(o.UpgradeUntil), MinScore: nullInt(o.MinScore),
		MovieMinSize: nullBytes(o.MovieSize.Min), MovieMaxSize: nullBytes(o.MovieSize.Max),
		EpisodeMinSize: nullBytes(o.EpisodeSize.Min), EpisodeMaxSize: nullBytes(o.EpisodeSize.Max),
		Key: key,
	}
}

// List returns the six Profiles in display order.
func (s *Service) List(ctx context.Context) ([]Profile, error) {
	rows, err := db.New(s.st.Read()).ListProfiles(ctx)
	if err != nil {
		return nil, err
	}
	return convert(rows)
}

func convert(rows []db.Profile) ([]Profile, error) {
	out := make([]Profile, len(rows))
	for i, r := range rows {
		p, err := fromRow(r)
		if err != nil {
			return nil, err
		}
		out[i] = p
	}
	return out, nil
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
// (PRD Settled 1 and ADR 0024): Original-Language Profiles always
// reject Original-only Releases, and a Profile that a Slot names as its default cannot be disabled
// until that default changes (*DefaultError).
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
				if cur, err = fromRow(r); err != nil {
					return err
				}
				found = true
			}
		}
		if !found {
			return ErrNotFound
		}
		next := cur
		if p.Enabled != nil {
			next.Enabled = *p.Enabled
		}
		if p.OriginalChoice != nil {
			next.OriginalChoice = *p.OriginalChoice
		}
		if p.Name != nil {
			name := strings.TrimSpace(*p.Name)
			if !cur.Custom {
				if name != cur.Name {
					return invalid("name", "Only a custom Profile can be renamed")
				}
			} else if name != cur.Name {
				if err := checkName(name, key, rows); err != nil {
					return err
				}
				if err := q.SetProfileName(ctx, db.SetProfileNameParams{Name: name, Key: key}); err != nil {
					return err
				}
				next.Name = name
			}
		}
		if p.Overlay != nil {
			ov, err := s.checkOverlay(ctx, next, *p.Overlay)
			if err != nil {
				return err
			}
			if err := q.SetProfileOverlay(ctx, overlayParams(key, ov)); err != nil {
				return err
			}
			next.Overlay = ov
		}
		if err := checkOwn(next.Rule, State{Enabled: next.Enabled, OriginalChoice: next.OriginalChoice}, ""); err != nil {
			return err
		}
		if cur.Enabled && !next.Enabled {
			if err := notADefault(ctx, q, key); err != nil {
				return err
			}
		}
		if !cur.Enabled && next.Enabled {
			// A Profile is enabled only where its recipe has a backing profile.
			region, _, err := s.Region(ctx)
			if err != nil {
				return err
			}
			if _, _, err := next.Backing(region.Primary); err != nil {
				return invalid("enabled", err.Error()+" under the Primary Language "+region.Primary.Release().Name)
			}
		}
		if err := q.SetProfileEnabled(ctx, db.SetProfileEnabledParams{Enabled: b2i(next.Enabled), Key: key}); err != nil {
			return err
		}
		if err := q.SetProfileOriginalChoice(ctx, db.SetProfileOriginalChoiceParams{
			OriginalLanguage: string(next.OriginalChoice), OriginalFallback: b2i(next.OriginalChoice.DeprecatedFlag()), Key: key,
		}); err != nil {
			return err
		}
		out = next
		return nil
	})
	return out, err
}

// checkOwn applies the rules that hold within one Profile, for Patch and
// CheckAll: original_language is reject, offer or accept, and an
// Original-Language Profile always rejects (it already requires the Original
// Language). prefix goes before each field.
func checkOwn(rule scoring.LanguageRule, s State, prefix string) error {
	if !s.OriginalChoice.Valid() {
		return invalid(prefix+"original_language", "Choose reject, offer or accept")
	}
	if s.OriginalChoice != scoring.OriginalReject && rule == scoring.OriginalLanguage {
		return invalid(prefix+"original_language", "An Original-Language Profile already requires the Original Language, so it has no Original-Language choice")
	}
	return nil
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

// RestoreRegion puts back what Region reported earlier: the old Primary
// Language and country and the Profiles backed under them, and, if they were
// never saved (saved is false), no stored language settings at all, so the
// setup wizard's Primary Language section is to do again.
func (s *Service) RestoreRegion(ctx context.Context, before Region, saved bool) error {
	if _, err := s.setRegion(ctx, RegionPatch{Primary: &before.Primary, Country: &before.Country}, false); err != nil {
		return err
	}
	if saved {
		return nil
	}
	return s.settings.Delete(ctx, regionKey)
}

// CheckRegion applies SetRegion's rules to a whole Region without saving it.
// A rejection is a *ValidationError.
func CheckRegion(r Region) error {
	if err := checkPrimary(r.Primary); err != nil {
		return err
	}
	if err := checkCountry(r.Country); err != nil {
		return err
	}
	return nil
}

func checkPrimary(l Language) *ValidationError {
	switch l {
	case English, German, French:
		return nil
	}
	return invalid("primary_language", "Primary Language must be en, de or fr")
}

func checkCountry(c string) *ValidationError {
	if !countryRE.MatchString(c) {
		return invalid("release_date_country", "Use a two-letter uppercase country code such as US, DE or FR")
	}
	return nil
}

// SetRegion saves the language settings. Changing the Primary Language without
// naming a country moves the country to the new language's default; naming one
// keeps it. A new Primary Language re-points the eight Profiles to their
// backing TRaSH profiles (Settled 5). Re-scoring the stored files is the
// caller's job (trash.Service.ChangeLanguage); nothing is renamed or searched.
func (s *Service) SetRegion(ctx context.Context, p RegionPatch) (Region, error) {
	return s.setRegion(ctx, p, true)
}

// setRegion is SetRegion; without check it skips the backing rule, as RestoreRegion puts back what was.
func (s *Service) setRegion(ctx context.Context, p RegionPatch, check bool) (Region, error) {
	cur, _, err := s.Region(ctx)
	if err != nil {
		return Region{}, err
	}
	next := cur
	if p.Primary != nil {
		if err := checkPrimary(*p.Primary); err != nil {
			return Region{}, err
		}
		next.Primary = *p.Primary
		if p.Country == nil && next.Primary != cur.Primary {
			next.Country = next.Primary.DefaultCountry()
		}
	}
	if p.Country != nil {
		if err := checkCountry(*p.Country); err != nil {
			return Region{}, err
		}
		next.Country = *p.Country
	}
	var disabled []Profile
	err = s.write(ctx, func(q *db.Queries) error {
		disabled = nil
		rows, err := q.ListProfiles(ctx)
		if err != nil {
			return err
		}
		all, err := convert(rows)
		if err != nil {
			return err
		}
		if check {
			if err := checkBacked(ctx, q, all, next.Primary); err != nil {
				return err
			}
		}
		for _, p := range all {
			// A Profile applies to the kinds that have a backing profile under the new language. One nothing uses
			// may have none: it is disabled and backed by nothing until it can be enabled again.
			movies, series, err := p.Backing(next.Primary)
			if err != nil && p.Enabled {
				if err := q.SetProfileEnabled(ctx, db.SetProfileEnabledParams{Enabled: 0, Key: p.Key}); err != nil {
					return err
				}
				disabled = append(disabled, p)
			}
			if err := q.SetProfileTrash(ctx, db.SetProfileTrashParams{
				TrashProfileMovies: movies, TrashProfileSeries: series, Key: p.Key,
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
	if s.log != nil {
		for _, p := range disabled {
			s.log.Info("the Profile is disabled: nothing uses it and the new Primary Language has no backing profile for its recipe", "profile", p.Key, "name", p.Name, "primary_language", string(next.Primary))
		}
	}
	return next, nil
}

// checkBacked is nil when every Profile that is used for a kind has a backing profile for it under the Primary
// Language, enabled or not: a Profile is used for a kind by a Slot that names it as its default for the kind, or
// by a Version of a Title of the kind. Else it is a *ValidationError on primary_language naming each Profile
// that would lose the backing profile of a kind it is used for (ADR 0026). A Profile nothing uses may lose it.
func checkBacked(ctx context.Context, q *db.Queries, all []Profile, primary Language) error {
	used := map[string]map[release.Kind]string{} // key -> kind -> what uses it
	use := func(key string, kind release.Kind, by string) {
		if key == "" {
			return
		}
		if used[key] == nil {
			used[key] = map[release.Kind]string{}
		}
		if used[key][kind] == "" {
			used[key][kind] = by
		}
	}
	slots, err := q.SlotDefaultProfiles(ctx)
	if err != nil {
		return err
	}
	for _, r := range slots {
		use(r.DefaultMovies.String, release.KindMovie, "the default of the Slot "+r.Label)
		use(r.DefaultSeries.String, release.KindSeries, "the default of the Slot "+r.Label)
	}
	versions, err := q.VersionProfileKinds(ctx)
	if err != nil {
		return err
	}
	for _, v := range versions {
		kind := release.KindMovie
		if v.Kind == "series" {
			kind = release.KindSeries
		}
		use(v.ProfileKey, kind, "used by a Version")
	}
	var lost []string
	for _, p := range all {
		for _, kind := range []release.Kind{release.KindMovie, release.KindSeries} {
			by, ok := used[p.Key][kind]
			if !ok {
				continue
			}
			if err := p.LacksBacking(primary, kind); err != nil {
				name := "Movies"
				if kind == release.KindSeries {
					name = "Series"
				}
				lost = append(lost, fmt.Sprintf("%s (%s) has no TRaSH profile for %s and is %s", p.Name, p.recipeName(primary), name, by))
			}
		}
	}
	if len(lost) == 0 {
		return nil
	}
	return invalid("primary_language", "Kestrel has no TRaSH profile for "+primary.Release().Name+" to back: "+strings.Join(lost, "; ")+
		". Change what uses them first")
}

// CheckPrimary applies SetRegion's backing rule to a Primary Language without saving anything: a *ValidationError
// naming each Profile that would lose its backing profile for a kind it is used for (ADR 0026). The API asks it
// before it queues a change.
func (s *Service) CheckPrimary(ctx context.Context, primary Language) error {
	all, err := s.List(ctx)
	if err != nil {
		return err
	}
	return checkBacked(ctx, db.New(s.st.Read()), all, primary)
}

const maxNameLength = 40

// checkName applies the rules for the name of a custom Profile: some text, not too long, unique among all Profiles.
func checkName(name, key string, rows []db.Profile) error {
	switch {
	case name == "":
		return invalid("name", "Give the Profile a name")
	case len([]rune(name)) > maxNameLength:
		return invalid("name", fmt.Sprintf("A name is at most %d characters", maxNameLength))
	}
	for _, r := range rows {
		if r.Key != key && strings.EqualFold(r.Name, name) {
			return invalid("name", "Another Profile has that name")
		}
	}
	return nil
}

func (s *Service) snapshot() (*scoring.Snapshot, error) {
	if s.live != nil {
		return s.live.Current(), nil
	}
	return scoring.Embedded()
}

// resolve resolves a Profile under the Primary Language against the active snapshot, with its overlay or with the
// given one.
func (s *Service) resolve(ctx context.Context, p Profile, overlay *scoring.Overlay) (*scoring.Profile, error) {
	region, _, err := s.Region(ctx)
	if err != nil {
		return nil, err
	}
	snap, err := s.snapshot()
	if err != nil {
		return nil, err
	}
	spec := p.Spec(region.Primary.Release())
	spec.Overlay = overlay
	return snap.Profile(spec)
}

// Resolve is the Profile as scoring sees it under the active snapshot and the Primary Language.
func (s *Service) Resolve(ctx context.Context, p Profile) (*scoring.Profile, error) {
	return s.resolve(ctx, p, p.overlay())
}

// checkOverlay applies the rules for what is set on a Profile and returns it normalised: a quality list that is
// TRaSH's own is dropped, and a cutoff must be one of the accepted qualities.
func (s *Service) checkOverlay(ctx context.Context, p Profile, o scoring.Overlay) (scoring.Overlay, error) {
	if o.EpisodeSize.Min < 0 || o.EpisodeSize.Max < 0 || o.MovieSize.Min < 0 || o.MovieSize.Max < 0 {
		return o, invalid("overlay.sizes", "A size cannot be negative")
	}
	for _, l := range []struct {
		field string
		lim   scoring.SizeLimit
	}{{"overlay.episode_size", o.EpisodeSize}, {"overlay.movie_size", o.MovieSize}} {
		if l.lim.Min > 0 && l.lim.Max > 0 && l.lim.Min > l.lim.Max {
			return o, invalid(l.field, "The smallest size is above the largest")
		}
	}
	trash, err := s.resolve(ctx, p, nil)
	if err != nil {
		return o, err
	}
	for _, k := range []struct {
		field string
		kind  release.Kind
		ko    *scoring.KindOverlay
	}{{"overlay.series", release.KindSeries, &o.Series}, {"overlay.movies", release.KindMovie, &o.Movies}} {
		base := trash.TrashLadder(k.kind)
		known := map[string]bool{}
		for _, q := range base {
			known[q.Name] = true
		}
		seen := map[string]bool{}
		for _, q := range k.ko.Qualities {
			switch {
			case !known[q.Name]:
				return o, invalid(k.field+".qualities", "Unknown quality "+q.Name)
			case seen[q.Name]:
				return o, invalid(k.field+".qualities", q.Name+" is listed twice")
			}
			seen[q.Name] = true
		}
		if len(k.ko.Qualities) > 0 {
			if !slices.ContainsFunc(k.ko.Qualities, func(q scoring.QualityPref) bool { return q.Accepted }) {
				return o, invalid(k.field+".qualities", "Accept at least one quality")
			}
			// Qualities the list leaves out are TRaSH's, so the list that is TRaSH's own changes nothing.
			if full := fill(k.ko.Qualities, base); slices.Equal(full, base) {
				k.ko.Qualities = nil
			}
		}
		if k.ko.Cutoff != "" {
			ladder := base
			if len(k.ko.Qualities) > 0 {
				ladder = fill(k.ko.Qualities, base)
			}
			if !slices.ContainsFunc(ladder, func(q scoring.QualityPref) bool { return q.Name == k.ko.Cutoff && q.Accepted }) {
				return o, invalid(k.field+".cutoff", k.ko.Cutoff+" is not one of the accepted qualities")
			}
		}
	}
	return o, nil
}

// fill is prefs followed by the qualities of base that prefs leave out, as TRaSH has them.
func fill(prefs, base []scoring.QualityPref) []scoring.QualityPref {
	out := slices.Clone(prefs)
	for _, q := range base {
		if !slices.ContainsFunc(prefs, func(x scoring.QualityPref) bool { return x.Name == q.Name }) {
			out = append(out, q)
		}
	}
	return out
}
