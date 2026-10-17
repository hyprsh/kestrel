package instances_test

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/hyprsh/kestrel/internal/plugin"
	downloadclient "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1"
	"github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1/fake"
	"github.com/hyprsh/kestrel/internal/plugin/instances"
	"github.com/hyprsh/kestrel/internal/store"
)

// other is a second contract with no cap, standing in for indexer.v1: the
// service must handle it without knowing it.
var otherContract = plugin.Contract{ID: "other.v1"}

type other struct{}

func (other) Describe() plugin.Manifest {
	return plugin.Manifest{ID: "other", Name: "Other", Contract: "other.v1", Version: "1", Fields: []plugin.Field{
		{Key: "url", Label: "URL", Type: plugin.FieldURL, Required: true},
		{Key: "token", Label: "Token", Type: plugin.FieldSecret},
	}}
}
func (other) Test(context.Context, plugin.Connection) (plugin.TestResult, error) {
	return plugin.TestResult{}, nil
}
func (other) ListOptions(context.Context, plugin.Connection, string) ([]plugin.Option, error) {
	return nil, nil
}

func newService(t *testing.T) *instances.Service {
	t.Helper()
	st, err := store.Open(context.Background(), store.Options{Dir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	reg := plugin.NewRegistry()
	if err := reg.Register(downloadclient.Contract, fake.New("k")); err != nil {
		t.Fatal(err)
	}
	if err := reg.Register(otherContract, other{}); err != nil {
		t.Fatal(err)
	}
	return instances.NewService(st, reg)
}

func ptr[T any](v T) *T { return &v }

var ctx = context.Background()

func problemFields(t *testing.T, err error) []string {
	t.Helper()
	var ve *instances.ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("want a ValidationError, got %v", err)
	}
	var out []string
	for _, p := range ve.Problems {
		out = append(out, p.Field)
	}
	return out
}

func TestCreateStoresAndReadsBackWithDefaults(t *testing.T) {
	s := newService(t)
	in, err := s.Create(ctx, instances.New{PluginID: "fake", Name: " SAB ", Priority: 3, Config: map[string]any{"api_key": "k"}})
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.Get(ctx, in.ID)
	if err != nil {
		t.Fatal(err)
	}
	want := instances.Instance{ID: in.ID, Contract: "download_client.v1", PluginID: "fake", Name: "SAB", Enabled: true, Priority: 3,
		Config: map[string]any{"api_key": "k", "movie_category": "movies"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v\nwant %+v", got, want)
	}
	all, _ := s.List(ctx)
	if len(all) != 1 || all[0].ID != in.ID {
		t.Fatalf("list %+v", all)
	}
}

func TestCreateValidates(t *testing.T) {
	s := newService(t)
	cases := map[string]struct {
		in     instances.New
		fields []string
	}{
		"unknown plugin":   {instances.New{PluginID: "nope", Name: "x"}, []string{"plugin_id"}},
		"no name":          {instances.New{PluginID: "fake", Name: " ", Config: map[string]any{"api_key": "k"}}, []string{"name"}},
		"required secret":  {instances.New{PluginID: "fake", Name: "x"}, []string{"config.api_key"}},
		"unknown key":      {instances.New{PluginID: "fake", Name: "x", Config: map[string]any{"api_key": "k", "zzz": 1}}, []string{"config.zzz"}},
		"nil is not a set": {instances.New{PluginID: "fake", Name: "x", Config: map[string]any{"api_key": nil}}, []string{"config.api_key"}},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := s.Create(ctx, c.in)
			if got := problemFields(t, err); !reflect.DeepEqual(got, c.fields) {
				t.Fatalf("got %v want %v", got, c.fields)
			}
		})
	}
	if all, _ := s.List(ctx); len(all) != 0 {
		t.Fatal("a rejected create must store nothing")
	}
}

func TestOnlyOneEnabledDownloadClient(t *testing.T) {
	s := newService(t)
	first, err := s.Create(ctx, instances.New{PluginID: "fake", Name: "one", Config: map[string]any{"api_key": "k"}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.Create(ctx, instances.New{PluginID: "fake", Name: "two", Config: map[string]any{"api_key": "k"}})
	if got := problemFields(t, err); !reflect.DeepEqual(got, []string{"enabled"}) {
		t.Fatalf("second enabled instance: %v", got)
	}
	second, err := s.Create(ctx, instances.New{PluginID: "fake", Name: "two", Enabled: ptr(false), Config: map[string]any{"api_key": "k"}})
	if err != nil {
		t.Fatalf("a disabled second instance is fine: %v", err)
	}
	if _, err := s.Update(ctx, second.ID, instances.Patch{Enabled: ptr(true)}); problemFields(t, err)[0] != "enabled" {
		t.Fatalf("enabling a second instance must fail: %v", err)
	}
	if _, err := s.Update(ctx, first.ID, instances.Patch{Name: ptr("renamed")}); err != nil {
		t.Fatalf("editing the enabled one is fine: %v", err)
	}
	if _, err := s.Update(ctx, first.ID, instances.Patch{Enabled: ptr(false)}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Update(ctx, second.ID, instances.Patch{Enabled: ptr(true)}); err != nil {
		t.Fatalf("after disabling the first: %v", err)
	}
	enabled, _ := s.Enabled(ctx, "download_client.v1")
	if len(enabled) != 1 || enabled[0].ID != second.ID {
		t.Fatalf("enabled %+v", enabled)
	}
}

func TestAContractWithoutACapAllowsMany(t *testing.T) {
	s := newService(t)
	for i := range 3 {
		if _, err := s.Create(ctx, instances.New{PluginID: "other", Name: "n", Priority: 3 - i, Config: map[string]any{"url": "http://x"}}); err != nil {
			t.Fatal(err)
		}
	}
	en, _ := s.Enabled(ctx, "other.v1")
	if len(en) != 3 || en[0].Priority != 1 {
		t.Fatalf("enabled should be by priority: %+v", en)
	}
}

func TestUpdateKeepsReplacesAndClearsSecrets(t *testing.T) {
	s := newService(t)
	in, _ := s.Create(ctx, instances.New{PluginID: "other", Name: "n", Config: map[string]any{"url": "http://x", "token": "t1"}})

	got, err := s.Update(ctx, in.ID, instances.Patch{Config: map[string]any{"url": "http://y"}})
	if err != nil || got.Config["token"] != "t1" || got.Config["url"] != "http://y" {
		t.Fatalf("omitted secret must be kept: %+v %v", got.Config, err)
	}
	got, _ = s.Update(ctx, in.ID, instances.Patch{Config: map[string]any{"token": "t2"}})
	if got.Config["token"] != "t2" {
		t.Fatalf("replace: %+v", got.Config)
	}
	got, err = s.Update(ctx, in.ID, instances.Patch{Config: map[string]any{"token": nil}})
	if err != nil {
		t.Fatal(err)
	}
	if _, has := got.Config["token"]; has {
		t.Fatalf("nil must clear: %+v", got.Config)
	}
	stored, _ := s.Get(ctx, in.ID)
	if _, has := stored.Config["token"]; has {
		t.Fatal("clear must persist")
	}
	// Clearing a required secret is a validation error and changes nothing.
	f, _ := s.Create(ctx, instances.New{PluginID: "fake", Name: "f", Config: map[string]any{"api_key": "k"}})
	_, err = s.Update(ctx, f.ID, instances.Patch{Config: map[string]any{"api_key": nil}})
	if got := problemFields(t, err); !reflect.DeepEqual(got, []string{"config.api_key"}) {
		t.Fatalf("got %v", got)
	}
	if stored, _ := s.Get(ctx, f.ID); stored.Config["api_key"] != "k" {
		t.Fatal("a rejected update must change nothing")
	}
}

func TestPublicNeverCarriesSecrets(t *testing.T) {
	s := newService(t)
	in, _ := s.Create(ctx, instances.New{PluginID: "other", Name: "n", Config: map[string]any{"url": "http://x", "token": "hunter2"}})
	cfg, set := s.Public(in)
	if !reflect.DeepEqual(cfg, map[string]any{"url": "http://x"}) || !reflect.DeepEqual(set, []string{"token"}) {
		t.Fatalf("%v %v", cfg, set)
	}
	bare, _ := s.Create(ctx, instances.New{PluginID: "other", Name: "n", Config: map[string]any{"url": "http://x"}})
	if _, set := s.Public(bare); len(set) != 0 {
		t.Fatalf("no secret set, got %v", set)
	}
}

func TestResolveMergesStoredSecretsUnderTheForm(t *testing.T) {
	s := newService(t)
	in, _ := s.Create(ctx, instances.New{PluginID: "other", Name: "n", Config: map[string]any{"url": "http://x", "token": "t1"}})

	_, conn, err := s.Resolve(ctx, "other", in.ID, map[string]any{"url": "http://edited"}, true)
	if err != nil {
		t.Fatal(err)
	}
	if conn.String("url") != "http://edited" || conn.String("token") != "t1" || conn.ID != in.ID {
		t.Fatalf("%+v", conn)
	}
	if _, _, err := s.Resolve(ctx, "other", 0, map[string]any{}, true); problemFields(t, err)[0] != "config.url" {
		t.Fatalf("an incomplete unsaved form fails validation: %v", err)
	}
	if _, _, err := s.Resolve(ctx, "other", 0, map[string]any{}, false); err != nil {
		t.Fatalf("without validation an incomplete form resolves: %v", err)
	}
	if _, _, err := s.Resolve(ctx, "fake", in.ID, nil, false); problemFields(t, err)[0] != "plugin_id" {
		t.Fatalf("instance of another plugin: %v", err)
	}
	if _, _, err := s.Resolve(ctx, "other", 999, nil, false); !errors.Is(err, instances.ErrNotFound) {
		t.Fatalf("unknown instance: %v", err)
	}
}

func TestDeleteAndNotFound(t *testing.T) {
	s := newService(t)
	in, _ := s.Create(ctx, instances.New{PluginID: "other", Name: "n", Config: map[string]any{"url": "http://x"}})
	if err := s.Delete(ctx, in.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Get(ctx, in.ID); !errors.Is(err, instances.ErrNotFound) {
		t.Fatal(err)
	}
	if err := s.Delete(ctx, in.ID); !errors.Is(err, instances.ErrNotFound) {
		t.Fatal(err)
	}
	if _, err := s.Update(ctx, in.ID, instances.Patch{}); !errors.Is(err, instances.ErrNotFound) {
		t.Fatal(err)
	}
}
