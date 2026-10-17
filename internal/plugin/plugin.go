// Package plugin holds what every plugin contract shares: the typed Error, the
// Describe manifest and its config-schema checks, the Connection a call gets,
// and the explicit Registry the binary fills at start-up (ADR 0008).
//
// A contract (download_client.v1, indexer.v1, ...) is a Go interface in its own
// versioned package. It embeds Plugin and adds data-only methods. Adding a
// contract changes nothing here: declare a Contract, implement adapters, and
// register them in cmd/kestrel.
package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"time"
)

// Code classifies a plugin failure. The list is closed within a major version
// of the contracts; hosts branch on it, never on Message.
type Code string

const (
	CodeAuth        Code = "auth"         // credentials rejected
	CodeUnavailable Code = "unavailable"  // unreachable, timed out or answered nonsense
	CodeRateLimited Code = "rate_limited" // back off for RetryAfter
	CodeInvalid     Code = "invalid"      // the request or config is wrong
	CodeNotFound    Code = "not_found"    // the thing asked about does not exist
)

// Error is the one error type a plugin returns across the contract. It is plain
// data so it can cross a process boundary unchanged.
type Error struct {
	Code       Code          `json:"code"`
	Message    string        `json:"message"`
	RetryAfter time.Duration `json:"retry_after,omitempty"`
}

func (e *Error) Error() string { return string(e.Code) + ": " + e.Message }

// Is matches any *Error with the same Code, so errors.Is(err, &Error{Code: c}) works.
func (e *Error) Is(target error) bool {
	t, ok := target.(*Error)
	return ok && t.Code == e.Code
}

// Errorf builds an Error.
func Errorf(code Code, format string, args ...any) *Error {
	return &Error{Code: code, Message: fmt.Sprintf(format, args...)}
}

// AsError returns the *Error inside err, or wraps any other error as unavailable.
// It returns nil for a nil err.
func AsError(err error) *Error {
	if err == nil {
		return nil
	}
	var pe *Error
	if errors.As(err, &pe) {
		return pe
	}
	return &Error{Code: CodeUnavailable, Message: err.Error()}
}

// Connection is everything a stateless plugin gets with each call. Config holds
// the instance's settings with its secrets merged in, JSON-typed (numbers may be
// float64).
type Connection struct {
	ID     int64          `json:"id"`
	Config map[string]any `json:"config"`
}

// String returns the string setting key, or "".
func (c Connection) String(key string) string { s, _ := c.Config[key].(string); return s }

// Int returns the integer setting key, or 0.
func (c Connection) Int(key string) int {
	switch v := c.Config[key].(type) {
	case float64:
		return int(v)
	case int:
		return v
	case int64:
		return int(v)
	}
	return 0
}

// Bool returns the boolean setting key, or false.
func (c Connection) Bool(key string) bool { b, _ := c.Config[key].(bool); return b }

// TestResult is what a successful Test reports; failures are Errors.
type TestResult struct {
	Message string `json:"message"`
}

// Option is one choice of a select field or a live dropdown.
type Option struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

// Plugin is the part of every contract that is the same: its manifest, a live
// connection test, and optional live dropdown values for a field (SABnzbd's
// categories). A contract interface embeds it.
type Plugin interface {
	Describe() Manifest
	Test(ctx context.Context, conn Connection) (TestResult, error)
	// ListOptions returns live choices for a manifest field with Live set, or an
	// invalid Error for any other key.
	ListOptions(ctx context.Context, conn Connection, field string) ([]Option, error)
}

// FieldType is how the UI draws a config field and how the host validates it.
type FieldType string

const (
	FieldText   FieldType = "text"
	FieldURL    FieldType = "url"
	FieldSecret FieldType = "secret"
	FieldInt    FieldType = "int"
	FieldBool   FieldType = "bool"
	FieldSelect FieldType = "select"
)

// Field is one entry of a plugin's config schema. The UI draws its form from these.
type Field struct {
	Key      string    `json:"key"`
	Label    string    `json:"label"`
	Type     FieldType `json:"type"`
	Required bool      `json:"required"`
	Default  any       `json:"default"`
	Help     string    `json:"help"`
	// Options are the fixed choices of a select field.
	Options []Option `json:"options"`
	// Live marks a field whose choices come from ListOptions once the connection works.
	Live bool `json:"live"`
}

// Manifest is a plugin's self-description.
type Manifest struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Contract string `json:"contract"`
	Version  string `json:"version"`
	// Capabilities are contract-specific facts, e.g. {"protocols": ["usenet"]}.
	Capabilities map[string][]string `json:"capabilities"`
	Fields       []Field             `json:"fields"`
}

// Validate checks the manifest is well formed.
func (m Manifest) Validate() error {
	if m.ID == "" || m.Name == "" || m.Contract == "" {
		return errors.New("manifest needs id, name and contract")
	}
	seen := map[string]bool{}
	for _, f := range m.Fields {
		if f.Key == "" || f.Label == "" {
			return fmt.Errorf("plugin %s: field needs key and label", m.ID)
		}
		if seen[f.Key] {
			return fmt.Errorf("plugin %s: duplicate field %q", m.ID, f.Key)
		}
		seen[f.Key] = true
		switch f.Type {
		case FieldText, FieldURL, FieldSecret, FieldInt, FieldBool, FieldSelect:
		default:
			return fmt.Errorf("plugin %s: field %q has unknown type %q", m.ID, f.Key, f.Type)
		}
		if f.Default != nil {
			if p := checkValue(f, f.Default); p != "" {
				return fmt.Errorf("plugin %s: default of %q: %s", m.ID, f.Key, p)
			}
		}
	}
	return nil
}

// Field returns the field with key.
func (m Manifest) Field(key string) (Field, bool) {
	for _, f := range m.Fields {
		if f.Key == key {
			return f, true
		}
	}
	return Field{}, false
}

// FieldProblem is one thing wrong with a config.
type FieldProblem struct {
	Field   string
	Code    string // required | invalid | unknown
	Message string
}

// WithDefaults returns a copy of cfg with each absent field's default filled in.
func (m Manifest) WithDefaults(cfg map[string]any) map[string]any {
	out := make(map[string]any, len(cfg))
	for k, v := range cfg {
		out[k] = v
	}
	for _, f := range m.Fields {
		if _, ok := out[f.Key]; !ok && f.Default != nil {
			out[f.Key] = f.Default
		}
	}
	return out
}

// CheckConfig validates a complete config (secrets merged in) against the schema.
// Problems come back in manifest field order, unknown keys last in key order.
func (m Manifest) CheckConfig(cfg map[string]any) []FieldProblem {
	var out []FieldProblem
	for _, f := range m.Fields {
		v, ok := cfg[f.Key]
		if !ok || v == nil || v == "" {
			if f.Required {
				out = append(out, FieldProblem{f.Key, "required", f.Label + " is required"})
			}
			continue
		}
		if msg := checkValue(f, v); msg != "" {
			out = append(out, FieldProblem{f.Key, "invalid", msg})
		}
	}
	var unknown []string
	for k := range cfg {
		if _, ok := m.Field(k); !ok {
			unknown = append(unknown, k)
		}
	}
	sort.Strings(unknown)
	for _, k := range unknown {
		out = append(out, FieldProblem{k, "unknown", "no such setting"})
	}
	return out
}

func checkValue(f Field, v any) string {
	switch f.Type {
	case FieldText, FieldSecret:
		if _, ok := v.(string); !ok {
			return f.Label + " must be text"
		}
	case FieldURL:
		s, ok := v.(string)
		if !ok {
			return f.Label + " must be a URL"
		}
		u, err := url.Parse(s)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return f.Label + " must be an http(s) URL"
		}
	case FieldInt:
		switch n := v.(type) {
		case float64:
			if n != float64(int64(n)) {
				return f.Label + " must be a whole number"
			}
		case int, int64:
		case json.Number:
			if _, err := n.Int64(); err != nil {
				return f.Label + " must be a whole number"
			}
		default:
			return f.Label + " must be a whole number"
		}
	case FieldBool:
		if _, ok := v.(bool); !ok {
			return f.Label + " must be true or false"
		}
	case FieldSelect:
		s, _ := v.(string)
		for _, o := range f.Options {
			if o.Value == s {
				return ""
			}
		}
		return f.Label + " must be one of the listed choices"
	}
	return ""
}

// Contract declares a versioned contract to the registry.
type Contract struct {
	// ID is the versioned name, e.g. "download_client.v1".
	ID string
	// MaxEnabled caps how many instances may be enabled at once; 0 means no cap.
	MaxEnabled int
}

// Registry is the explicit list of compiled-in plugins. cmd/kestrel fills it.
type Registry struct {
	plugins   map[string]Plugin
	contracts map[string]Contract // by plugin id
	order     []string
}

// NewRegistry returns an empty registry.
func NewRegistry() *Registry {
	return &Registry{plugins: map[string]Plugin{}, contracts: map[string]Contract{}}
}

// Register adds p under contract c. The manifest must be valid, name c, and
// carry an id no other plugin uses.
func (r *Registry) Register(c Contract, p Plugin) error {
	m := p.Describe()
	if err := m.Validate(); err != nil {
		return err
	}
	if m.Contract != c.ID {
		return fmt.Errorf("plugin %s declares contract %q, registered under %q", m.ID, m.Contract, c.ID)
	}
	if _, dup := r.plugins[m.ID]; dup {
		return fmt.Errorf("plugin id %q registered twice", m.ID)
	}
	r.plugins[m.ID] = p
	r.contracts[m.ID] = c
	r.order = append(r.order, m.ID)
	return nil
}

// Lookup finds a plugin and its contract by plugin id.
func (r *Registry) Lookup(id string) (Plugin, Contract, bool) {
	p, ok := r.plugins[id]
	return p, r.contracts[id], ok
}

// Contract returns the declared contract with id, if any plugin uses it.
func (r *Registry) Contract(id string) (Contract, bool) {
	for _, c := range r.contracts {
		if c.ID == id {
			return c, true
		}
	}
	return Contract{}, false
}

// Manifests lists every plugin's manifest, ordered by contract then id.
func (r *Registry) Manifests() []Manifest {
	out := make([]Manifest, 0, len(r.order))
	for _, id := range r.order {
		out = append(out, r.plugins[id].Describe())
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Contract != out[j].Contract {
			return out[i].Contract < out[j].Contract
		}
		return out[i].ID < out[j].ID
	})
	return out
}
