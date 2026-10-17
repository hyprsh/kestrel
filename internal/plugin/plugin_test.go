package plugin_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/plugin"
)

func TestErrorCarriesACodeThroughWrapping(t *testing.T) {
	err := fmt.Errorf("adding: %w", &plugin.Error{Code: plugin.CodeRateLimited, Message: "slow down", RetryAfter: 30 * time.Second})
	pe := plugin.AsError(err)
	if pe.Code != plugin.CodeRateLimited || pe.RetryAfter != 30*time.Second {
		t.Fatalf("got %+v", pe)
	}
	if !errors.Is(err, &plugin.Error{Code: plugin.CodeRateLimited}) {
		t.Fatal("errors.Is should match on code")
	}
	if errors.Is(err, &plugin.Error{Code: plugin.CodeAuth}) {
		t.Fatal("different code must not match")
	}
}

func TestPlainErrorsBecomeUnavailable(t *testing.T) {
	if pe := plugin.AsError(errors.New("boom")); pe.Code != plugin.CodeUnavailable || pe.Message != "boom" {
		t.Fatalf("got %+v", pe)
	}
	if plugin.AsError(nil) != nil {
		t.Fatal("nil stays nil")
	}
}

func TestErrorSurvivesJSON(t *testing.T) {
	in := plugin.Error{Code: plugin.CodeNotFound, Message: "gone", RetryAfter: time.Minute}
	b, _ := json.Marshal(in)
	var out plugin.Error
	if err := json.Unmarshal(b, &out); err != nil || !reflect.DeepEqual(in, out) {
		t.Fatalf("%v %+v", err, out)
	}
}

var manifest = plugin.Manifest{
	ID: "demo", Name: "Demo", Contract: "demo.v1", Version: "1",
	Fields: []plugin.Field{
		{Key: "url", Label: "URL", Type: plugin.FieldURL, Required: true},
		{Key: "api_key", Label: "API key", Type: plugin.FieldSecret, Required: true},
		{Key: "cat", Label: "Category", Type: plugin.FieldText, Default: "movies"},
		{Key: "port", Label: "Port", Type: plugin.FieldInt},
		{Key: "tls", Label: "TLS", Type: plugin.FieldBool},
		{Key: "mode", Label: "Mode", Type: plugin.FieldSelect, Options: []plugin.Option{{Value: "a", Label: "A"}, {Value: "b", Label: "B"}}},
	},
}

func TestManifestValidation(t *testing.T) {
	if err := manifest.Validate(); err != nil {
		t.Fatal(err)
	}
	bad := manifest
	bad.Fields = append([]plugin.Field{}, manifest.Fields...)
	bad.Fields = append(bad.Fields, plugin.Field{Key: "url", Label: "again", Type: plugin.FieldText})
	if bad.Validate() == nil {
		t.Fatal("duplicate field key should fail")
	}
	if (plugin.Manifest{ID: "x", Name: "X", Contract: "c.v1", Fields: []plugin.Field{{Key: "k", Label: "K", Type: "weird"}}}).Validate() == nil {
		t.Fatal("unknown field type should fail")
	}
	if (plugin.Manifest{Name: "X", Contract: "c.v1"}).Validate() == nil {
		t.Fatal("missing id should fail")
	}
}

func TestCheckConfig(t *testing.T) {
	cases := []struct {
		name   string
		cfg    map[string]any
		fields []string // fields with problems
	}{
		{"complete", map[string]any{"url": "http://sab:8080", "api_key": "k", "port": float64(8080), "tls": true, "mode": "a"}, nil},
		{"defaults and optionals may be absent", map[string]any{"url": "https://x", "api_key": "k"}, nil},
		{"required missing", map[string]any{"url": "http://x"}, []string{"api_key"}},
		{"required empty", map[string]any{"url": "", "api_key": "k"}, []string{"url"}},
		{"bad url", map[string]any{"url": "ftp://x", "api_key": "k"}, []string{"url"}},
		{"url needs a host", map[string]any{"url": "http://", "api_key": "k"}, []string{"url"}},
		{"int must be integral", map[string]any{"url": "http://x", "api_key": "k", "port": 1.5}, []string{"port"}},
		{"bool must be bool", map[string]any{"url": "http://x", "api_key": "k", "tls": "yes"}, []string{"tls"}},
		{"select must be an option", map[string]any{"url": "http://x", "api_key": "k", "mode": "z"}, []string{"mode"}},
		{"unknown key", map[string]any{"url": "http://x", "api_key": "k", "nope": 1}, []string{"nope"}},
		{"text must be string", map[string]any{"url": "http://x", "api_key": "k", "cat": 3.0}, []string{"cat"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var got []string
			for _, p := range manifest.CheckConfig(c.cfg) {
				got = append(got, p.Field)
			}
			if !reflect.DeepEqual(got, c.fields) {
				t.Fatalf("got %v want %v", got, c.fields)
			}
		})
	}
}

func TestWithDefaultsFillsOnlyAbsentKeys(t *testing.T) {
	got := manifest.WithDefaults(map[string]any{"url": "http://x"})
	if got["cat"] != "movies" || got["url"] != "http://x" {
		t.Fatalf("%v", got)
	}
	if manifest.WithDefaults(map[string]any{"cat": "tv"})["cat"] != "tv" {
		t.Fatal("explicit value must win")
	}
}

func TestConnectionAccessors(t *testing.T) {
	var c plugin.Connection
	if err := json.Unmarshal([]byte(`{"id":4,"config":{"url":"http://x","port":8080,"tls":true}}`), &c); err != nil {
		t.Fatal(err)
	}
	if c.String("url") != "http://x" || c.Int("port") != 8080 || !c.Bool("tls") || c.String("missing") != "" {
		t.Fatalf("%+v", c)
	}
}

type stub struct{ m plugin.Manifest }

func (s stub) Describe() plugin.Manifest { return s.m }
func (stub) Test(context.Context, plugin.Connection) (plugin.TestResult, error) {
	return plugin.TestResult{}, nil
}
func (stub) ListOptions(context.Context, plugin.Connection, string) ([]plugin.Option, error) {
	return nil, nil
}

func TestRegistry(t *testing.T) {
	contract := plugin.Contract{ID: "demo.v1", MaxEnabled: 1}
	r := plugin.NewRegistry()
	if err := r.Register(contract, stub{manifest}); err != nil {
		t.Fatal(err)
	}
	if err := r.Register(contract, stub{manifest}); err == nil {
		t.Fatal("duplicate plugin id should fail")
	}
	other := manifest
	other.ID, other.Contract = "other", "other.v1"
	if err := r.Register(contract, stub{other}); err == nil {
		t.Fatal("manifest contract must match the registered contract")
	}
	badManifest := manifest
	badManifest.ID, badManifest.Name = "bad", ""
	if err := r.Register(contract, stub{badManifest}); err == nil {
		t.Fatal("invalid manifest should fail")
	}
	p, c, ok := r.Lookup("demo")
	if !ok || p.Describe().ID != "demo" || c.MaxEnabled != 1 {
		t.Fatal("lookup failed")
	}
	if _, _, ok := r.Lookup("nope"); ok {
		t.Fatal("unknown id")
	}
	if ms := r.Manifests(); len(ms) != 1 || ms[0].ID != "demo" {
		t.Fatalf("%v", ms)
	}
}
