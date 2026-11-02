// Package slots stores the Slots of a library (ADR 0024) and applies the rules
// of package slot to every change, whether it comes from the API or from a
// Config File's `slots` section.
package slots

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/hyprsh/kestrel/internal/slot"
	"github.com/hyprsh/kestrel/internal/slot/slots/db"
	"github.com/hyprsh/kestrel/internal/store"
)

// ErrNotFound is returned for an id that is no Slot.
var ErrNotFound = errors.New("slot not found")

// Service reads and writes the Slots.
type Service struct {
	st        *store.Store
	tx        *sql.Tx // set by InTx: writes join the caller's transaction, which notifies nobody
	onRelabel func(context.Context, slot.Slot)
	onChange  func()
}

// New returns a Service over st.
func New(st *store.Store) *Service { return &Service{st: st} }

// InTx returns a Service whose writes run inside tx; the caller commits or rolls back, and calls Notify after a commit.
func (s *Service) InTx(tx *sql.Tx) *Service {
	c := *s
	c.tx = tx
	return &c
}

// Notify runs what OnChange set, for a change made through InTx once it is committed.
func (s *Service) Notify() { s.changed() }

// OnRelabel sets what runs for each Slot whose label was changed, after the
// change is saved: it renames the Slot's files (ADR 0003). The API and a Config
// File both change labels through this Service, so one hook covers both.
func (s *Service) OnRelabel(f func(ctx context.Context, id slot.Slot)) { s.onRelabel = f }

// OnChange sets what runs after any change to the Slots is saved (a Slot added,
// changed, reordered or removed, by the API or a Config File), so the screens
// that show a Slot can refetch.
func (s *Service) OnChange(f func()) { s.onChange = f }

func (s *Service) changed() {
	if s.onChange != nil {
		s.onChange()
	}
}

func (s *Service) relabeled(ctx context.Context, ids []slot.Slot) {
	if s.onRelabel == nil {
		return
	}
	for _, id := range ids {
		s.onRelabel(ctx, id)
	}
}

// Create is a new Slot. It goes last in the order, and its id comes from the label.
type Create struct {
	Label string
	// DefaultMovies and DefaultSeries are Profile keys; empty is none.
	DefaultMovies, DefaultSeries string
	OnForNew                     bool
}

// Patch changes a Slot; nil fields stay. An empty default clears it. The id never changes.
type Patch struct {
	Label                        *string
	DefaultMovies, DefaultSeries *string
	OnForNew                     *bool
	// Position is the 0-based place the Slot moves to; the others shift.
	Position *int
}

// Declared is one Slot of a Config File. An empty ID means the Slot of that
// label if there is one, else a new Slot whose id comes from the label.
type Declared struct {
	ID                           slot.Slot
	Label                        string
	DefaultMovies, DefaultSeries string
	OnForNew                     bool
}

func recordOf(r db.Slot) slot.Record {
	return slot.Record{ID: slot.Slot(r.ID), Label: r.Label, DefaultMovies: r.DefaultMovies.String, DefaultSeries: r.DefaultSeries.String, OnForNew: r.OnForNew == 1, Position: int(r.Position)}
}

func nullText(s string) sql.NullString { return sql.NullString{String: s, Valid: s != ""} }

func b2i(b bool) int64 {
	if b {
		return 1
	}
	return 0
}

// List is the Slots in order.
func (s *Service) List(ctx context.Context) ([]slot.Record, error) {
	return list(ctx, db.New(s.st.Read()))
}

func list(ctx context.Context, q *db.Queries) ([]slot.Record, error) {
	rows, err := q.ListSlots(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]slot.Record, len(rows))
	for i, r := range rows {
		out[i] = recordOf(r)
	}
	return out, nil
}

// Known reports whether id is the id of a Slot.
func (s *Service) Known(ctx context.Context, id slot.Slot) (bool, error) {
	all, err := s.List(ctx)
	if err != nil {
		return false, err
	}
	return slices.ContainsFunc(all, func(r slot.Record) bool { return r.ID == id }), nil
}

// write runs f in a transaction on the one write connection, so a check and
// the write it allows cannot race.
func (s *Service) write(ctx context.Context, f func(*db.Queries) error) error {
	if s.tx != nil {
		return f(db.New(s.tx))
	}
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

// profileKeys checks that each key names a Profile; field names the field in the error. With enabled
// the Profile must also be enabled, as a default is (ADR 0024): a Config File skips that here, because
// it declares the Profiles' settings in the same pass.
func profileKeys(ctx context.Context, q *db.Queries, field string, enabled bool, keys ...string) error {
	return checkProfileKeys(ctx, q, field, enabled, enabled, keys...)
}

// checkProfileKeys is profileKeys with the two checks apart: enabled that the Profile is enabled, and kinds that it applies to the
// kind of the field (default_movies or default_series): a Movies-only Profile cannot be a Series default.
func checkProfileKeys(ctx context.Context, q *db.Queries, field string, enabled, kinds bool, keys ...string) error {
	have, err := q.ProfileKeys(ctx)
	if err != nil {
		return err
	}
	on, err := q.EnabledProfileKeys(ctx)
	if err != nil {
		return err
	}
	applies, err := q.MoviesProfileKeys(ctx)
	if field == "default_series" {
		applies, err = q.SeriesProfileKeys(ctx)
	}
	if err != nil {
		return err
	}
	for _, k := range keys {
		switch {
		case k == "":
		case !slices.Contains(have, k):
			return &slot.RuleError{Field: field, Message: fmt.Sprintf("no such Profile %q", k)}
		case enabled && !slices.Contains(on, k):
			return &slot.RuleError{Field: field, Message: fmt.Sprintf("the Profile %q is disabled: a default must be enabled", k)}
		case kinds && !slices.Contains(applies, k):
			return &slot.RuleError{Field: field, Message: fmt.Sprintf("the Profile %q does not apply to %s: its TRaSH profile covers the other kind only", k, strings.TrimPrefix(field, "default_"))}
		}
	}
	return nil
}

// writeSet writes the Slots of set that differ from cur, with positions 0..n-1 in set's order.
// A Slot whose label changed keeps the old label as an alias, and a label a
// Slot takes stops being an alias of any Slot. It returns the Slots relabeled.
func writeSet(ctx context.Context, q *db.Queries, cur, set []slot.Record) ([]slot.Slot, error) {
	var relabeled []slot.Slot
	have := map[slot.Slot]slot.Record{}
	for _, r := range cur {
		have[r.ID] = r
	}
	for i, r := range set {
		r.Position = i
		old, ok := have[r.ID]
		switch {
		case !ok:
			if err := q.InsertSlot(ctx, db.InsertSlotParams{ID: string(r.ID), Label: r.Label, DefaultMovies: nullText(r.DefaultMovies), DefaultSeries: nullText(r.DefaultSeries), OnForNew: b2i(r.OnForNew), Position: int64(i)}); err != nil {
				return nil, err
			}
			if err := q.DeleteAliasesNamed(ctx, r.Label); err != nil {
				return nil, err
			}
		case old != r:
			if err := q.UpdateSlot(ctx, db.UpdateSlotParams{ID: string(r.ID), Label: r.Label, DefaultMovies: nullText(r.DefaultMovies), DefaultSeries: nullText(r.DefaultSeries), OnForNew: b2i(r.OnForNew), Position: int64(i)}); err != nil {
				return nil, err
			}
			if old.Label != r.Label {
				if err := q.DeleteAliasesNamed(ctx, r.Label); err != nil {
					return nil, err
				}
				if !strings.EqualFold(old.Label, r.Label) {
					if err := q.InsertSlotAlias(ctx, db.InsertSlotAliasParams{Slot: string(r.ID), Alias: old.Label}); err != nil {
						return nil, err
					}
				}
				relabeled = append(relabeled, r.ID)
			}
		}
	}
	return relabeled, nil
}

// Create adds a Slot last in the order.
func (s *Service) Create(ctx context.Context, in Create) (slot.Record, error) {
	var out slot.Record
	err := s.write(ctx, func(q *db.Queries) error {
		cur, err := list(ctx, q)
		if err != nil {
			return err
		}
		taken := make([]slot.Slot, len(cur))
		for i, r := range cur {
			taken[i] = r.ID
		}
		out = slot.Record{ID: slot.IDFor(in.Label, taken), Label: in.Label, DefaultMovies: in.DefaultMovies, DefaultSeries: in.DefaultSeries, OnForNew: in.OnForNew, Position: len(cur)}
		if err := slot.CheckSet(append(slices.Clone(cur), out)); err != nil {
			return err
		}
		if err := profileKeys(ctx, q, "default_movies", true, in.DefaultMovies); err != nil {
			return err
		}
		if err := profileKeys(ctx, q, "default_series", true, in.DefaultSeries); err != nil {
			return err
		}
		_, err = writeSet(ctx, q, cur, append(slices.Clone(cur), out))
		return err
	})
	if err == nil {
		s.changed()
	}
	return out, err
}

// Change updates a Slot, or with dryRun applies every rule and saves nothing,
// answering the Slot as it would stand. A rejected patch changes nothing. A new
// label keeps the old one as an alias, and the OnRelabel hook then renames the
// Slot's files. It also says how many files that rename touches: the files of
// the Slot's Versions when the patch gives a label other than the stored one,
// else nil.
func (s *Service) Change(ctx context.Context, id slot.Slot, p Patch, dryRun bool) (slot.Record, *int, error) {
	var renames *int
	if p.Label != nil {
		all, err := s.List(ctx)
		if err != nil {
			return slot.Record{}, nil, err
		}
		for _, cur := range all {
			if cur.ID == id && cur.Label != *p.Label {
				n, err := s.Files(ctx, id)
				if err != nil {
					return slot.Record{}, nil, err
				}
				renames = &n
			}
		}
	}
	out, relabeled, err := s.update(ctx, id, p, !dryRun)
	if err != nil {
		return slot.Record{}, nil, err
	}
	if !dryRun {
		s.changed()
		s.relabeled(ctx, relabeled)
	}
	return out, renames, nil
}

func (s *Service) update(ctx context.Context, id slot.Slot, p Patch, apply bool) (slot.Record, []slot.Slot, error) {
	var out slot.Record
	var relabeled []slot.Slot
	err := s.write(ctx, func(q *db.Queries) error {
		cur, err := list(ctx, q)
		if err != nil {
			return err
		}
		i := slices.IndexFunc(cur, func(r slot.Record) bool { return r.ID == id })
		if i < 0 {
			return ErrNotFound
		}
		r := cur[i]
		if p.Label != nil {
			r.Label = *p.Label
		}
		if p.DefaultMovies != nil {
			r.DefaultMovies = *p.DefaultMovies
		}
		if p.DefaultSeries != nil {
			r.DefaultSeries = *p.DefaultSeries
		}
		if p.OnForNew != nil {
			r.OnForNew = *p.OnForNew
		}
		set := slices.Clone(cur)
		set[i] = r
		if p.Position != nil {
			if *p.Position < 0 || *p.Position >= len(set) {
				return &slot.RuleError{Field: "position", Message: fmt.Sprintf("must be from 0 to %d", len(set)-1)}
			}
			set = slices.Delete(set, i, i+1)
			set = slices.Insert(set, *p.Position, r)
		}
		if err := slot.CheckSet(set); err != nil {
			return err
		}
		if err := profileKeys(ctx, q, "default_movies", true, r.DefaultMovies); err != nil {
			return err
		}
		if err := profileKeys(ctx, q, "default_series", true, r.DefaultSeries); err != nil {
			return err
		}
		out = r
		out.Position = slices.IndexFunc(set, func(x slot.Record) bool { return x.ID == id })
		if !apply {
			return nil
		}
		relabeled, err = writeSet(ctx, q, cur, set)
		return err
	})
	return out, relabeled, err
}

// Delete removes a Slot that no Version uses, as long as another Slot is left
// and one of the others is on for new Titles.
func (s *Service) Delete(ctx context.Context, id slot.Slot) error {
	err := s.write(ctx, func(q *db.Queries) error {
		cur, err := list(ctx, q)
		if err != nil {
			return err
		}
		i := slices.IndexFunc(cur, func(r slot.Record) bool { return r.ID == id })
		if i < 0 {
			return ErrNotFound
		}
		if err := slot.CheckSet(slices.Delete(slices.Clone(cur), i, i+1)); err != nil {
			return err
		}
		if err := notInUse(ctx, q, cur[i]); err != nil {
			return err
		}
		if _, err := q.DeleteSlot(ctx, string(id)); err != nil {
			return err
		}
		rest := slices.Delete(slices.Clone(cur), i, i+1)
		for j := range rest {
			rest[j].Position = j
		}
		_, err = writeSet(ctx, q, slices.Delete(slices.Clone(cur), i, i+1), rest)
		return err
	})
	if err == nil {
		s.changed()
	}
	return err
}

// notInUse is the rule that a Slot is removed only while no Version uses it.
func notInUse(ctx context.Context, q *db.Queries, r slot.Record) error {
	n, err := q.SlotVersionCount(ctx, string(r.ID))
	if err != nil {
		return err
	}
	if n > 0 {
		return &slot.RuleError{Conflict: true, Message: fmt.Sprintf("the Slot %q (%s) holds %d %s: remove them first", string(r.ID), r.Label, n, plural(n, "Version"))}
	}
	return nil
}

func plural(n int64, noun string) string {
	if n == 1 {
		return noun
	}
	return noun + "s"
}

// plan resolves a Config File's Slots against the stored ones: the Slots as
// they will stand, in the file's order, and the stored Slots the file drops.
func plan(cur []slot.Record, want []Declared) (set, dropped []slot.Record, err error) {
	byID := map[slot.Slot]slot.Record{}
	taken := make([]slot.Slot, 0, len(cur)+len(want))
	for _, r := range cur {
		byID[r.ID] = r
		taken = append(taken, r.ID)
	}
	used := map[slot.Slot]bool{}
	for i, d := range want {
		field := fmt.Sprintf("[%d]", i)
		id := d.ID
		if id == "" {
			if j := slices.IndexFunc(cur, func(r slot.Record) bool { return strings.EqualFold(r.Label, d.Label) }); j >= 0 && !used[cur[j].ID] {
				id = cur[j].ID
			} else {
				id = slot.IDFor(d.Label, taken)
				taken = append(taken, id)
			}
		} else if _, ok := slot.Parse(string(id)); !ok {
			return nil, nil, &slot.RuleError{Field: field + ".id", Message: fmt.Sprintf("%q is not a Slot id: lower-case letters, digits and single hyphens", id)}
		}
		if used[id] {
			return nil, nil, &slot.RuleError{Field: field + ".id", Message: fmt.Sprintf("%q is declared twice", id)}
		}
		used[id] = true
		set = append(set, slot.Record{ID: id, Label: d.Label, DefaultMovies: d.DefaultMovies, DefaultSeries: d.DefaultSeries, OnForNew: d.OnForNew, Position: i})
	}
	for _, r := range cur {
		if !used[r.ID] {
			dropped = append(dropped, r)
		}
	}
	return set, dropped, nil
}

// CheckDeclared applies the Slot rules to a Config File's Slots and writes
// nothing: the rules of the API, valid Profile keys, and that no Slot the file
// leaves out still holds Versions.
//
// A file that declares the Profiles brings them with it: declaredProfiles are their keys, which a default may name before
// they are stored (a fresh install has none, ADR 0026). Nil when the file declares none.
func (s *Service) CheckDeclared(ctx context.Context, want []Declared, declaredProfiles []string) error {
	return s.declare(ctx, want, false, false, declaredProfiles)
}

// CheckDefaultKinds is nil when each default a Config File names applies to its kind under the saved Profiles. A file that
// declares the Profiles checks that against the Profiles it declares, so it does not call this.
func (s *Service) CheckDefaultKinds(ctx context.Context, want []Declared) error {
	q := db.New(s.st.Read())
	for _, r := range want {
		if err := checkProfileKeys(ctx, q, "default_movies", false, true, r.DefaultMovies); err != nil {
			return err
		}
		if err := checkProfileKeys(ctx, q, "default_series", false, true, r.DefaultSeries); err != nil {
			return err
		}
	}
	return nil
}

// Declare brings the Slots to a Config File's: a Slot the file leaves out is
// removed if it is empty, and startup fails if it holds Versions. It writes
// only what differs, so the same file twice writes nothing.
func (s *Service) Declare(ctx context.Context, want []Declared) error {
	return s.declare(ctx, want, true, false, nil)
}

// Replace makes the Slots those of want, as Declare does, but with the rules of the API: each default must be an
// enabled Profile. It is how a setup preset replaces the Slots (ADR 0026), inside the caller's transaction (InTx).
func (s *Service) Replace(ctx context.Context, want []Declared) error {
	return s.declare(ctx, want, true, true, nil)
}

// HasVersions reports whether any Version exists: a preset replaces the Slots, which only a library without Versions allows.
func (s *Service) HasVersions(ctx context.Context) (bool, error) {
	var d db.DBTX = s.st.Read()
	if s.tx != nil {
		d = s.tx // a check made inside a transaction sees what the transaction sees
	}
	n, err := db.New(d).VersionCount(ctx)
	return n > 0, err
}

func (s *Service) declare(ctx context.Context, want []Declared, apply, enabled bool, declaredProfiles []string) error {
	var relabeled []slot.Slot
	err := s.write(ctx, func(q *db.Queries) error {
		cur, err := list(ctx, q)
		if err != nil {
			return err
		}
		set, dropped, err := plan(cur, want)
		if err != nil {
			return err
		}
		if err := slot.CheckSet(set); err != nil {
			return err
		}
		stored := func(field string, keys ...string) error {
			var missing []string
			for _, k := range keys {
				// A file that declares the Profiles has all of them: a stored one it leaves out goes.
				if declaredProfiles != nil && k != "" && !slices.Contains(declaredProfiles, k) {
					return &slot.RuleError{Field: field, Message: fmt.Sprintf("no such Profile %q: the file's profiles section does not declare it", k)}
				}
				if !slices.Contains(declaredProfiles, k) {
					missing = append(missing, k)
				}
			}
			return profileKeys(ctx, q, field, enabled, missing...)
		}
		for _, r := range set {
			if err := stored("default_movies", r.DefaultMovies); err != nil {
				return err
			}
			if err := stored("default_series", r.DefaultSeries); err != nil {
				return err
			}
		}
		for _, r := range dropped {
			if err := notInUse(ctx, q, r); err != nil {
				return fmt.Errorf("%w (the file leaves it out; keep it in the file, or remove its Versions first)", err)
			}
		}
		if !apply {
			return nil
		}
		for _, r := range dropped {
			if _, err := q.DeleteSlot(ctx, string(r.ID)); err != nil {
				return err
			}
		}
		relabeled, err = writeSet(ctx, q, cur, set)
		return err
	})
	if err == nil && apply && s.tx == nil {
		s.changed()
		s.relabeled(ctx, relabeled)
	}
	return err
}

// Aliases are the labels each Slot used to have, which Adoption still reads as that Slot.
func (s *Service) Aliases(ctx context.Context) (map[slot.Slot][]string, error) {
	rows, err := db.New(s.st.Read()).ListSlotAliases(ctx)
	if err != nil {
		return nil, err
	}
	out := map[slot.Slot][]string{}
	for _, r := range rows {
		out[slot.Slot(r.Slot)] = append(out[slot.Slot(r.Slot)], r.Alias)
	}
	return out, nil
}

// Files is how many files the Slot's Versions hold: what a new label renames.
func (s *Service) Files(ctx context.Context, id slot.Slot) (int, error) {
	n, err := db.New(s.st.Read()).SlotFileCount(ctx, string(id))
	return int(n), err
}

// TitleIDs are the Titles that have a Version in the Slot.
func (s *Service) TitleIDs(ctx context.Context, id slot.Slot) ([]int64, error) {
	return db.New(s.st.Read()).SlotTitleIDs(ctx, string(id))
}
