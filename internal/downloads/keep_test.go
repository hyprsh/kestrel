package downloads_test

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/hyprsh/kestrel/internal/downloads"
	"github.com/hyprsh/kestrel/internal/plugin"
	downloadclient "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1"
	"github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1/fake"
	"github.com/hyprsh/kestrel/internal/plugin/instances"
	"github.com/hyprsh/kestrel/internal/store"
	"github.com/hyprsh/kestrel/internal/store/storetest"
)

// spy records the Connection of each Remove and reports the folder as left.
type spy struct {
	*fake.Client
	conns []plugin.Connection
	datas []bool
}

func (s *spy) Remove(ctx context.Context, conn plugin.Connection, id string, deleteData bool) error {
	s.conns, s.datas = append(s.conns, conn), append(s.datas, deleteData)
	return &downloadclient.FolderLeft{Path: "/x", Reason: "test"}
}

func newSpyService(t *testing.T) (*downloads.Service, *spy, int64) {
	t.Helper()
	st, err := store.Open(context.Background(), store.Options{Dir: storetest.Dir(t)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	s := &spy{Client: fake.New("k")}
	reg := plugin.NewRegistry()
	if err := reg.Register(downloadclient.Contract, s); err != nil {
		t.Fatal(err)
	}
	inst := instances.NewService(st, reg)
	created, err := inst.Create(context.Background(), instances.New{PluginID: fake.ID, Name: "SAB", Config: map[string]any{"api_key": "k"}})
	if err != nil {
		t.Fatal(err)
	}
	return downloads.New(inst), s, created.ID
}

func TestRemoveWithDataTellsTheClientWhereTheLibraryIs(t *testing.T) {
	svc, s, id := newSpyService(t)
	svc.SetKeep(func(context.Context) ([]string, error) { return []string{"/media/movies", "/media/tv"}, nil })
	err := svc.Remove(context.Background(), id, "j", true)
	var left *downloadclient.FolderLeft
	if !errors.As(err, &left) {
		t.Fatalf("err = %v, want the client's FolderLeft", err)
	}
	if !reflect.DeepEqual(s.conns[0].Keep, []string{"/media/movies", "/media/tv"}) {
		t.Errorf("keep = %v", s.conns[0].Keep)
	}
}

func TestRemoveWithoutDataSendsNoKeep(t *testing.T) {
	svc, s, id := newSpyService(t)
	svc.SetKeep(func(context.Context) ([]string, error) { return []string{"/media/movies"}, nil })
	_ = svc.Remove(context.Background(), id, "j", false)
	if len(s.conns) != 1 || s.conns[0].Keep != nil {
		t.Errorf("conns = %+v", s.conns)
	}
}

func TestRemoveWithDataFailsClosedWhenTheLibraryIsUnknown(t *testing.T) {
	svc, s, id := newSpyService(t)
	boom := errors.New("settings unreadable")
	svc.SetKeep(func(context.Context) ([]string, error) { return nil, boom })
	if err := svc.Remove(context.Background(), id, "j", true); !errors.Is(err, boom) {
		t.Fatalf("err = %v", err)
	}
	if len(s.conns) != 0 {
		t.Error("the client was called without knowing the Library")
	}
}
