package downloads_test

import (
	"context"
	"errors"
	"testing"

	"github.com/hyprsh/kestrel/internal/downloads"
	"github.com/hyprsh/kestrel/internal/plugin"
	downloadclient "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1"
	"github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1/fake"
	"github.com/hyprsh/kestrel/internal/plugin/instances"
	"github.com/hyprsh/kestrel/internal/store"
)

func newService(t *testing.T) (*downloads.Service, *instances.Service, *fake.Client) {
	t.Helper()
	st, err := store.Open(context.Background(), store.Options{Dir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	client := fake.New("k")
	reg := plugin.NewRegistry()
	if err := reg.Register(downloadclient.Contract, client); err != nil {
		t.Fatal(err)
	}
	inst := instances.NewService(st, reg)
	return downloads.New(inst), inst, client
}

func TestAnNZBGoesToTheEnabledClientInTheMovieCategory(t *testing.T) {
	svc, inst, client := newService(t)
	created, err := inst.Create(context.Background(), instances.New{PluginID: fake.ID, Name: "SAB", Config: map[string]any{"api_key": "k", "movie_category": "films"}})
	if err != nil {
		t.Fatal(err)
	}

	sent, err := svc.Add(context.Background(), downloads.Job{Media: downloads.Movie, Name: "Paddington.2014.1080p", NZB: []byte("<nzb/>")})
	if err != nil {
		t.Fatal(err)
	}

	if sent.InstanceID != created.ID || sent.ClientID == "" || sent.Category != "films" {
		t.Errorf("sent = %+v", sent)
	}
	items, _ := client.List(context.Background(), client.Conn(0), "films")
	if len(items) != 1 || items[0].ClientID != sent.ClientID || items[0].Name != "Paddington.2014.1080p" {
		t.Errorf("client holds %+v", items)
	}
}

func TestWithoutAnEnabledClientAddFailsWithErrNoClient(t *testing.T) {
	svc, _, _ := newService(t)
	_, err := svc.Add(context.Background(), downloads.Job{Media: downloads.Movie, Name: "x", NZB: []byte("n")})
	if !errors.Is(err, downloads.ErrNoClient) {
		t.Errorf("err = %v, want ErrNoClient", err)
	}
}

func TestAnUnreachableClientIsAPluginError(t *testing.T) {
	svc, inst, _ := newService(t)
	if _, err := inst.Create(context.Background(), instances.New{PluginID: fake.ID, Name: "SAB", Config: map[string]any{"api_key": "wrong"}}); err != nil {
		t.Fatal(err)
	}
	_, err := svc.Add(context.Background(), downloads.Job{Media: downloads.Movie, Name: "x", NZB: []byte("n")})
	if pe := plugin.AsError(err); pe.Code != plugin.CodeAuth {
		t.Errorf("err = %v, want an auth plugin error", err)
	}
}
