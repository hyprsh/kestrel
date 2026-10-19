package instances

import (
	"bytes"
	"cmp"
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"github.com/hyprsh/kestrel/internal/plugin"
	"github.com/hyprsh/kestrel/internal/plugin/instances/db"
)

// Declared is one plugin instance as the Config File declares it (ADR 0014).
// Config holds the values the file gives, secrets resolved; the manifest's
// defaults fill the rest, as on Create.
type Declared struct {
	Name     string
	PluginID string
	Enabled  bool
	Priority int
	Config   map[string]any
}

// DeclaredError is a declared instance the store or the plugins reject.
// Instance is the declared name; Field is an API path such as "config.url".
type DeclaredError struct {
	Instance string
	Field    string
	Message  string
}

func (e *DeclaredError) Error() string {
	return fmt.Sprintf("%q: %s: %s", e.Instance, e.Field, e.Message)
}

// step is one declared instance and the stored row it becomes, if any.
type step struct {
	want     Instance
	cur      *Instance // nil: create it
	contract plugin.Contract
}

// plan is what Declare does: delete the declared instances that left the
// file, then write each declared one.
type plan struct {
	deletes []Instance
	steps   []step
}

// CheckDeclared applies Create's rules to the declared instances and checks
// them against the store, writing nothing: every plugin exists and every
// config passes its manifest; a name the UI already uses belongs to exactly
// one instance of the same plugin, which is then taken over; and no
// contract's cap on enabled instances is exceeded once the declared instances
// join the enabled instances created in the UI. A rejection is a
// *DeclaredError.
func (s *Service) CheckDeclared(ctx context.Context, want []Declared) error {
	_, err := s.plan(ctx, db.New(s.st.Read()), want)
	return err
}

// Declare brings the store to the declared instances, after checking them
// as CheckDeclared does: it creates the missing ones, takes over a UI
// instance of the same name and plugin (keeping its id), updates the ones
// that differ in place, and deletes the declared instances no longer
// declared, as a delete in the UI does. Instances created in the UI are never
// touched otherwise. An unchanged instance is not written, so the same
// declaration twice writes nothing. It returns the declared instances.
func (s *Service) Declare(ctx context.Context, want []Declared) ([]Instance, error) {
	var out []Instance
	err := s.write(ctx, func(q *db.Queries) error {
		p, err := s.plan(ctx, q, want)
		if err != nil {
			return err
		}
		for _, d := range p.deletes {
			if _, err := q.DeleteInstance(ctx, d.ID); err != nil {
				return err
			}
		}
		// Switch instances off before others on, so a contract's cap holds
		// at every write.
		steps := slices.Clone(p.steps)
		slices.SortStableFunc(steps, func(a, b step) int {
			return cmp.Compare(boolInt(a.want.Enabled), boolInt(b.want.Enabled))
		})
		for _, st := range steps {
			inst := st.want
			raw, _ := json.Marshal(inst.Config)
			switch {
			case st.cur == nil:
				id, err := q.InsertInstance(ctx, db.InsertInstanceParams{
					Contract: inst.Contract, PluginID: inst.PluginID, Name: inst.Name,
					Enabled: boolInt(inst.Enabled), Priority: int64(inst.Priority), Config: string(raw), Declared: 1,
				})
				if err != nil {
					return err
				}
				inst.ID = id
			case !same(*st.cur, inst):
				if _, err := q.DeclareInstance(ctx, db.DeclareInstanceParams{
					Name: inst.Name, Enabled: boolInt(inst.Enabled), Priority: int64(inst.Priority), Config: string(raw), ID: inst.ID,
				}); err != nil {
					return err
				}
			}
			out = append(out, inst)
		}
		return nil
	})
	return out, err
}

// Undeclare hands every declared instance back to the UI, for a start whose
// Config File leaves plugin_instances out: the instances keep what the file
// last set, and a file that declares the section again treats them as
// instances created in the UI, taking them over by name. With no declared
// instance it writes nothing.
func (s *Service) Undeclare(ctx context.Context) error {
	return s.write(ctx, func(q *db.Queries) error {
		_, err := q.UndeclareInstances(ctx)
		return err
	})
}

// plan checks want against the plugins and the rows q reads, and works out
// the writes that bring the store to it.
func (s *Service) plan(ctx context.Context, q *db.Queries, want []Declared) (plan, error) {
	rows, err := q.ListInstances(ctx)
	if err != nil {
		return plan{}, err
	}
	stored, err := convert(rows)
	if err != nil {
		return plan{}, err
	}
	var p plan
	kept := map[int64]bool{} // stored rows a declared instance becomes
	for _, w := range want {
		name := strings.TrimSpace(w.Name)
		reject := func(field, format string, args ...any) (plan, error) {
			return plan{}, &DeclaredError{Instance: name, Field: field, Message: fmt.Sprintf(format, args...)}
		}
		pl, contract, ok := s.reg.Lookup(w.PluginID)
		if !ok {
			return reject("plugin_id", "no such plugin")
		}
		m := pl.Describe()
		if name == "" {
			return reject("name", "Name is required")
		}
		cfg := m.WithDefaults(dropNil(w.Config))
		if probs := configProblems(m, cfg); len(probs) > 0 {
			return reject(probs[0].Field, "%s", probs[0].Message)
		}
		inst := Instance{Contract: contract.ID, PluginID: m.ID, Name: name, Enabled: w.Enabled, Priority: w.Priority, Config: cfg, Declared: true}

		var cur *Instance
		var named []*Instance // undeclared rows with the name
		for i := range stored {
			r := &stored[i]
			switch {
			case r.Name != name || kept[r.ID]:
			case r.Declared && r.PluginID == m.ID && cur == nil:
				cur = r
			case !r.Declared:
				named = append(named, r)
			}
		}
		if cur == nil && len(named) > 0 {
			switch {
			case len(named) > 1:
				return reject("name", "%d instances created in the UI have this name: rename or delete all but one so it can be taken over", len(named))
			case named[0].PluginID != m.ID:
				return reject("plugin_id", "an instance created in the UI has this name but is a %s instance: rename or delete it", named[0].PluginID)
			}
			cur = named[0]
		}
		if cur != nil {
			inst.ID = cur.ID
			kept[cur.ID] = true
		}
		p.steps = append(p.steps, step{want: inst, cur: cur, contract: contract})
	}
	for _, r := range stored {
		if r.Declared && !kept[r.ID] {
			p.deletes = append(p.deletes, r)
		}
	}
	return p, s.capCheckDeclared(p, stored, kept)
}

// capCheckDeclared checks each contract's cap on enabled instances against
// the declared instances and the enabled ones the UI keeps.
func (s *Service) capCheckDeclared(p plan, stored []Instance, kept map[int64]bool) error {
	for _, st := range p.steps {
		c := st.contract
		if c.MaxEnabled == 0 || !st.want.Enabled {
			continue
		}
		var declared, ui []string
		for _, o := range p.steps {
			if o.contract.ID == c.ID && o.want.Enabled {
				declared = append(declared, fmt.Sprintf("%q", o.want.Name))
			}
		}
		for _, r := range stored {
			if r.Contract == c.ID && r.Enabled && !r.Declared && !kept[r.ID] {
				ui = append(ui, fmt.Sprintf("%q", r.Name))
			}
		}
		if len(declared) > c.MaxEnabled {
			return &DeclaredError{Instance: st.want.Name, Field: "enabled", Message: fmt.Sprintf(
				"only %d %s instance can be enabled at a time, and the file enables %s", c.MaxEnabled, c.ID, strings.Join(declared, ", "))}
		}
		if len(declared)+len(ui) > c.MaxEnabled {
			return &DeclaredError{Instance: st.want.Name, Field: "enabled", Message: fmt.Sprintf(
				"only %d %s instance can be enabled at a time, and %s, created in the UI, is enabled: disable it in the UI or declare this instance disabled",
				c.MaxEnabled, c.ID, strings.Join(ui, ", "))}
		}
	}
	return nil
}

// same reports whether a stored instance already is the declared one.
func same(cur, want Instance) bool {
	a, _ := json.Marshal(cur.Config)
	b, _ := json.Marshal(want.Config)
	return cur.Declared && cur.Name == want.Name && cur.Enabled == want.Enabled && cur.Priority == want.Priority && bytes.Equal(a, b)
}
