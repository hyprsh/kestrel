package downloads_test

import (
	"context"
	"testing"

	"github.com/hyprsh/kestrel/internal/downloads"
	downloadclient "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1"
	"github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1/fake"
	"github.com/hyprsh/kestrel/internal/plugin/instances"
)

func TestListReadsTheEnabledClientsJobsInKestrelsCategoriesAndSaysWhichInstanceHoldsThem(t *testing.T) {
	svc, inst, client := newService(t)
	created, err := inst.Create(context.Background(), instances.New{PluginID: fake.ID, Name: "SAB", Config: map[string]any{"api_key": "k", "movie_category": "films"}})
	if err != nil {
		t.Fatal(err)
	}
	sent, err := svc.Add(context.Background(), downloads.Job{Media: downloads.Movie, Name: "Paddington", NZB: []byte("n")})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.Add(context.Background(), client.Conn(0), downloadclient.AddRequest{Kind: downloadclient.PayloadNZB, Data: []byte("n"), Filename: "Other", Category: "music"}); err != nil {
		t.Fatal(err)
	}

	listed, err := svc.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}

	if len(listed) != 1 || listed[0].InstanceID != created.ID || listed[0].Item.ClientID != sent.ClientID {
		t.Errorf("List = %+v, want only the job in the Movie category", listed)
	}
}

func TestRemoveDeletesTheJobFromItsClient(t *testing.T) {
	svc, inst, client := newService(t)
	created, _ := inst.Create(context.Background(), instances.New{PluginID: fake.ID, Name: "SAB", Config: map[string]any{"api_key": "k"}})
	sent, _ := svc.Add(context.Background(), downloads.Job{Media: downloads.Movie, Name: "Paddington", NZB: []byte("n")})

	if err := svc.Remove(context.Background(), created.ID, sent.ClientID, true); err != nil {
		t.Fatal(err)
	}

	if items, _ := client.List(context.Background(), client.Conn(0), ""); len(items) != 0 {
		t.Errorf("client still holds %+v", items)
	}
}

func TestListWithoutAClientIsEmptyNotAnError(t *testing.T) {
	svc, _, _ := newService(t)
	listed, err := svc.List(context.Background())
	if err != nil || len(listed) != 0 {
		t.Errorf("List = %v, %v", listed, err)
	}
}
