// Package instances stores the configured plugin instances of every contract
// and enforces the rules the contracts share: the config matches the plugin's
// manifest, secrets never leave through Public, and a contract's cap on enabled
// instances holds (one enabled download client in v1).
//
// It knows nothing of any particular contract, so a new contract needs no change here.
package instances

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/hyprsh/kestrel/internal/plugin"
	"github.com/hyprsh/kestrel/internal/plugin/instances/db"
	"github.com/hyprsh/kestrel/internal/store"
)

// ErrNotFound is returned for an instance id that does not exist.
var ErrNotFound = errors.New("plugin instance not found")

// ValidationError lists what was wrong with a write. Field names are API paths:
// "name", "plugin_id", "enabled", "config.<key>".
type ValidationError struct {
	Problems []plugin.FieldProblem
}

func (e *ValidationError) Error() string {
	var parts []string
	for _, p := range e.Problems {
		parts = append(parts, p.Field+": "+p.Message)
	}
	return "invalid plugin instance: " + strings.Join(parts, "; ")
}

func invalid(field, code, msg string) *ValidationError {
	return &ValidationError{Problems: []plugin.FieldProblem{{Field: field, Code: code, Message: msg}}}
}

// Instance is one stored instance. Config holds every field, secrets included:
// hand it to plugins through Connection, to clients only through Public.
type Instance struct {
	ID       int64
	Contract string
	PluginID string
	Name     string
	Enabled  bool
	Priority int
	Config   map[string]any
	// Declared marks an instance the Config File declares (ADR 0014).
	Declared bool
}

// Connection is what a plugin call receives for this instance.
func (i Instance) Connection() plugin.Connection {
	return plugin.Connection{ID: i.ID, Config: i.Config}
}

// New describes an instance to create. Enabled defaults to true.
type New struct {
	PluginID string
	Name     string
	Enabled  *bool
	Priority int
	Config   map[string]any
}

// Patch changes an instance. Config is merged key by key: a value sets the key,
// a nil value clears it (back to the default, if the field has one), an absent
// key stays. That is how a secret is kept (omit it), replaced or cleared.
type Patch struct {
	Name     *string
	Enabled  *bool
	Priority *int
	Config   map[string]any
}

// Service reads and writes instances.
type Service struct {
	st  *store.Store
	reg *plugin.Registry
}

// NewService returns a Service over st for the plugins in reg.
func NewService(st *store.Store, reg *plugin.Registry) *Service {
	return &Service{st: st, reg: reg}
}

// Registry returns the plugins this service validates against.
func (s *Service) Registry() *plugin.Registry { return s.reg }

func fromRow(r db.PluginInstance) (Instance, error) {
	var cfg map[string]any
	if err := json.Unmarshal([]byte(r.Config), &cfg); err != nil || cfg == nil {
		cfg = map[string]any{}
	}
	return Instance{
		ID: r.ID, Contract: r.Contract, PluginID: r.PluginID, Name: r.Name,
		Enabled: r.Enabled == 1, Priority: int(r.Priority), Config: cfg, Declared: r.Declared == 1,
	}, nil
}

// List returns every instance, ordered by contract, priority and id.
func (s *Service) List(ctx context.Context) ([]Instance, error) {
	rows, err := db.New(s.st.Read()).ListInstances(ctx)
	if err != nil {
		return nil, err
	}
	return convert(rows)
}

// Enabled returns the enabled instances of a contract by priority, the way a host
// picks which to call.
func (s *Service) Enabled(ctx context.Context, contract string) ([]Instance, error) {
	rows, err := db.New(s.st.Read()).ListEnabledInstances(ctx, contract)
	if err != nil {
		return nil, err
	}
	return convert(rows)
}

func convert(rows []db.PluginInstance) ([]Instance, error) {
	out := make([]Instance, 0, len(rows))
	for _, r := range rows {
		i, err := fromRow(r)
		if err != nil {
			return nil, err
		}
		out = append(out, i)
	}
	return out, nil
}

// Get returns one instance, or ErrNotFound.
func (s *Service) Get(ctx context.Context, id int64) (Instance, error) {
	r, err := db.New(s.st.Read()).GetInstance(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return Instance{}, ErrNotFound
	}
	if err != nil {
		return Instance{}, err
	}
	return fromRow(r)
}

// Create validates and stores a new instance.
func (s *Service) Create(ctx context.Context, in New) (Instance, error) {
	p, contract, ok := s.reg.Lookup(in.PluginID)
	if !ok {
		return Instance{}, invalid("plugin_id", "invalid", "no such plugin")
	}
	m := p.Describe()
	var problems []plugin.FieldProblem
	name := strings.TrimSpace(in.Name)
	if name == "" {
		problems = append(problems, plugin.FieldProblem{Field: "name", Code: "required", Message: "Name is required"})
	}
	cfg := m.WithDefaults(dropNil(in.Config))
	problems = append(problems, configProblems(m, cfg)...)
	if len(problems) > 0 {
		return Instance{}, &ValidationError{Problems: problems}
	}
	inst := Instance{Contract: contract.ID, PluginID: m.ID, Name: name, Enabled: in.Enabled == nil || *in.Enabled, Priority: in.Priority, Config: cfg}

	err := s.write(ctx, func(q *db.Queries) error {
		if inst.Enabled {
			if err := capCheck(ctx, q, contract, 0); err != nil {
				return err
			}
		}
		raw, _ := json.Marshal(inst.Config)
		id, err := q.InsertInstance(ctx, db.InsertInstanceParams{
			Contract: inst.Contract, PluginID: inst.PluginID, Name: inst.Name,
			Enabled: boolInt(inst.Enabled), Priority: int64(inst.Priority), Config: string(raw),
		})
		inst.ID = id
		return err
	})
	return inst, err
}

// Update applies a patch to an instance.
func (s *Service) Update(ctx context.Context, id int64, patch Patch) (Instance, error) {
	var out Instance
	err := s.write(ctx, func(q *db.Queries) error {
		row, err := q.GetInstance(ctx, id)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		inst, _ := fromRow(row)
		p, contract, ok := s.reg.Lookup(inst.PluginID)
		if !ok {
			return invalid("plugin_id", "invalid", "this instance's plugin is no longer built in")
		}
		m := p.Describe()

		var problems []plugin.FieldProblem
		if patch.Name != nil {
			if inst.Name = strings.TrimSpace(*patch.Name); inst.Name == "" {
				problems = append(problems, plugin.FieldProblem{Field: "name", Code: "required", Message: "Name is required"})
			}
		}
		if patch.Enabled != nil {
			inst.Enabled = *patch.Enabled
		}
		if patch.Priority != nil {
			inst.Priority = *patch.Priority
		}
		inst.Config = m.WithDefaults(mergeConfig(inst.Config, patch.Config))
		problems = append(problems, configProblems(m, inst.Config)...)
		if len(problems) > 0 {
			return &ValidationError{Problems: problems}
		}
		if inst.Enabled && !(row.Enabled == 1) {
			if err := capCheck(ctx, q, contract, id); err != nil {
				return err
			}
		}
		raw, _ := json.Marshal(inst.Config)
		if _, err := q.UpdateInstance(ctx, db.UpdateInstanceParams{
			Name: inst.Name, Enabled: boolInt(inst.Enabled), Priority: int64(inst.Priority), Config: string(raw), ID: id,
		}); err != nil {
			return err
		}
		out = inst
		return nil
	})
	return out, err
}

// Delete removes an instance, or returns ErrNotFound.
func (s *Service) Delete(ctx context.Context, id int64) error {
	return s.write(ctx, func(q *db.Queries) error {
		n, err := q.DeleteInstance(ctx, id)
		if err != nil {
			return err
		}
		if n == 0 {
			return ErrNotFound
		}
		return nil
	})
}

// Resolve builds the connection for a Test or ListOptions call on a form that may
// be unsaved: stored config of instanceID (0 for none) with patch merged over it,
// defaults filled in. With validate set it also checks the config against the
// manifest, which a Test wants and a live dropdown, called mid-edit, does not.
func (s *Service) Resolve(ctx context.Context, pluginID string, instanceID int64, patch map[string]any, validate bool) (plugin.Plugin, plugin.Connection, error) {
	p, _, ok := s.reg.Lookup(pluginID)
	if !ok {
		return nil, plugin.Connection{}, invalid("plugin_id", "invalid", "no such plugin")
	}
	base := map[string]any{}
	if instanceID != 0 {
		inst, err := s.Get(ctx, instanceID)
		if err != nil {
			return nil, plugin.Connection{}, err
		}
		if inst.PluginID != pluginID {
			return nil, plugin.Connection{}, invalid("plugin_id", "invalid", "the instance belongs to a different plugin")
		}
		base = inst.Config
	}
	m := p.Describe()
	cfg := m.WithDefaults(mergeConfig(base, patch))
	if validate {
		if probs := configProblems(m, cfg); len(probs) > 0 {
			return nil, plugin.Connection{}, &ValidationError{Problems: probs}
		}
	}
	return p, plugin.Connection{ID: instanceID, Config: cfg}, nil
}

// Public splits an instance's config for the API: the non-secret settings, and
// the keys of the secrets that are set. Secret values never leave this function.
func (s *Service) Public(i Instance) (config map[string]any, secretsSet []string) {
	config, secretsSet = map[string]any{}, []string{}
	p, _, ok := s.reg.Lookup(i.PluginID)
	if !ok {
		return config, secretsSet
	}
	for _, f := range p.Describe().Fields {
		v, has := i.Config[f.Key]
		if f.Type == plugin.FieldSecret {
			if s, _ := v.(string); has && s != "" {
				secretsSet = append(secretsSet, f.Key)
			}
			continue
		}
		if has {
			config[f.Key] = v
		} else {
			config[f.Key] = nil
		}
	}
	return config, secretsSet
}

// ---- helpers ----

func (s *Service) write(ctx context.Context, f func(*db.Queries) error) error {
	// The store has a single write connection, so check-then-write inside one
	// transaction cannot race another writer.
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

func capCheck(ctx context.Context, q *db.Queries, c plugin.Contract, selfID int64) error {
	if c.MaxEnabled == 0 {
		return nil
	}
	n, err := q.CountOtherEnabled(ctx, db.CountOtherEnabledParams{Contract: c.ID, ID: selfID})
	if err != nil {
		return err
	}
	if int(n) >= c.MaxEnabled {
		return invalid("enabled", "conflict", fmt.Sprintf("only %d %s instance can be enabled at a time: disable the other first", c.MaxEnabled, c.ID))
	}
	return nil
}

func configProblems(m plugin.Manifest, cfg map[string]any) []plugin.FieldProblem {
	probs := m.CheckConfig(cfg)
	for i := range probs {
		probs[i].Field = "config." + probs[i].Field
	}
	return probs
}

func dropNil(in map[string]any) map[string]any {
	out := make(map[string]any, len(in))
	for k, v := range in {
		if v != nil {
			out[k] = v
		}
	}
	return out
}

func mergeConfig(base, patch map[string]any) map[string]any {
	out := make(map[string]any, len(base)+len(patch))
	for k, v := range base {
		out[k] = v
	}
	for k, v := range patch {
		if v == nil {
			delete(out, k)
		} else {
			out[k] = v
		}
	}
	return out
}

func boolInt(b bool) int64 {
	if b {
		return 1
	}
	return 0
}
