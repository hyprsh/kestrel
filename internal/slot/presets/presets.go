// Package presets holds the Slot presets of the setup wizard (ADR 0026) and applies one in a single transaction:
// it replaces the Slots, brings in each Slot's default Profiles as recipes, and sets the defaults.
package presets

import (
	"context"
	"errors"
	"fmt"

	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
	"github.com/hyprsh/kestrel/internal/slot"
	"github.com/hyprsh/kestrel/internal/slot/slots"
	"github.com/hyprsh/kestrel/internal/store"
)

// ID names a preset.
type ID string

const (
	OneCopy               ID = "one-copy"
	StandardPlus4K        ID = "standard-plus-4k"
	StreamingRemuxArchive ID = "streaming-remux-archive"
	LanguagePlusOriginal  ID = "language-plus-original"
)

// ErrNotFound is returned for an id that is no preset.
var ErrNotFound = errors.New("no such preset")

// ErrHasVersions is returned when a preset is applied to a library that holds a Version: a preset replaces the Slots.
var ErrHasVersions = errors.New("the library holds a Version")

// Slot is a Slot of a preset: its label, the recipe of each default (nil for none) and whether new Titles get it.
type Slot struct {
	Label          string
	Movies, Series *profiles.Recipe
	OnForNew       bool
}

// Preset is a named set of Slots.
type Preset struct {
	ID    ID
	Name  string
	Slots []Slot
}

func recipe(family scoring.ReleaseFamily, res profiles.Resolution, rule string) *profiles.Recipe {
	return &profiles.Recipe{Family: family, Resolution: res, Rule: rule}
}

// All is the presets for a household whose Primary Language is named lang ("German"), in the order the wizard shows
// them. This is the one place that says what they are.
func All(lang string) []Preset {
	hd := func() *profiles.Recipe { return recipe(scoring.FamilyBlurayWeb, profiles.ResHD, "primary") }
	uhd := func() *profiles.Recipe { return recipe(scoring.FamilyBlurayWeb, profiles.ResUHD, "primary") }
	return []Preset{
		{ID: OneCopy, Name: "One copy", Slots: []Slot{
			{Label: "Standard", Movies: hd(), Series: hd(), OnForNew: true},
		}},
		{ID: StandardPlus4K, Name: "Standard + 4K", Slots: []Slot{
			{Label: "Standard", Movies: hd(), Series: hd(), OnForNew: true},
			{Label: "4K", Movies: uhd(), Series: uhd()},
		}},
		{ID: StreamingRemuxArchive, Name: "Streaming + Remux archive", Slots: []Slot{
			{Label: "Standard", Movies: hd(), Series: hd(), OnForNew: true},
			{Label: "Remux", Movies: recipe(scoring.FamilyRemuxWeb, profiles.ResUHD, "primary")},
		}},
		{ID: LanguagePlusOriginal, Name: lang + " + Original", Slots: []Slot{
			{Label: lang, Movies: hd(), Series: hd(), OnForNew: true},
			{Label: "Original", Movies: recipe(scoring.FamilyBlurayWeb, profiles.ResHD, "original"), Series: recipe(scoring.FamilyBlurayWeb, profiles.ResHD, "original"), OnForNew: true},
		}},
	}
}

// Service applies presets.
type Service struct {
	st       *store.Store
	profiles *profiles.Service
	slots    *slots.Service
}

// New returns a Service over the Profiles and Slots.
func New(st *store.Store, p *profiles.Service, s *slots.Service) *Service {
	return &Service{st: st, profiles: p, slots: s}
}

// List is the presets for the household's Primary Language, empty once the library holds a Version.
func (s *Service) List(ctx context.Context) ([]Preset, error) {
	has, err := s.slots.HasVersions(ctx)
	if err != nil || has {
		return nil, err
	}
	region, _, err := s.profiles.Region(ctx)
	if err != nil {
		return nil, err
	}
	return All(region.Primary.Release().Name), nil
}

// Apply replaces the Slots with the preset's, in one transaction: each default Profile the household has no Profile
// for is imported, each one is enabled, and the Slots take their defaults and switches. Any failure leaves the Slots
// and the Profiles as they were. It returns ErrNotFound for an unknown id and ErrHasVersions once a Version exists;
// a recipe that cannot be backed is the Profiles' *ValidationError.
func (s *Service) Apply(ctx context.Context, id ID) ([]slot.Record, error) {
	region, _, err := s.profiles.Region(ctx)
	if err != nil {
		return nil, err
	}
	var chosen *Preset
	for _, p := range All(region.Primary.Release().Name) {
		if p.ID == id {
			chosen = &p
		}
	}
	if chosen == nil {
		return nil, ErrNotFound
	}
	tx, err := s.st.Write().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	ps, sl := s.profiles.InTx(tx), s.slots.InTx(tx)
	// The check is made inside the transaction, so a Version committed since the preset was chosen still stops it.
	if has, err := sl.HasVersions(ctx); err != nil {
		return nil, err
	} else if has {
		return nil, ErrHasVersions
	}
	keys := map[profiles.Recipe]string{}
	key := func(r *profiles.Recipe) (string, error) {
		if r == nil {
			return "", nil
		}
		if k, ok := keys[*r]; ok {
			return k, nil
		}
		p, err := ps.Ensure(ctx, *r)
		if err != nil {
			return "", fmt.Errorf("%s: %w", r.Name(), err)
		}
		keys[*r] = p.Key
		return p.Key, nil
	}
	want := make([]slots.Declared, len(chosen.Slots))
	for i, sp := range chosen.Slots {
		d := slots.Declared{Label: sp.Label, OnForNew: sp.OnForNew}
		if d.DefaultMovies, err = key(sp.Movies); err != nil {
			return nil, err
		}
		if d.DefaultSeries, err = key(sp.Series); err != nil {
			return nil, err
		}
		want[i] = d
	}
	if err := sl.Replace(ctx, want); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	s.slots.Notify()
	return s.slots.List(ctx)
}
