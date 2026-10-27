package requests_test

import (
	"context"
	"slices"
	"testing"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/requests"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
	"github.com/hyprsh/kestrel/internal/settings"
	"github.com/hyprsh/kestrel/internal/store"
	"github.com/hyprsh/kestrel/internal/store/storetest"
)

func exec(t *testing.T, st *store.Store, q string, args ...any) {
	t.Helper()
	if _, err := st.Write().ExecContext(context.Background(), q, args...); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
}

func TestCompletedTitlesListsFilledSlotsWithTheirRequesters(t *testing.T) {
	ctx := context.Background()
	st, err := store.Open(ctx, store.Options{Dir: storetest.Dir(t)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })

	title := func(id int64, kind string, tmdb, tvdb any, folder any) {
		exec(t, st, `INSERT INTO titles (id, kind, tmdb_id, tvdb_id, title, original_title, primary_title, root_folder, folder, added_at, refreshed_at)
			VALUES (?, ?, ?, ?, 'T', 'T', 'T', '/media/x', ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`, id, kind, tmdb, tvdb, folder)
		exec(t, st, `INSERT INTO versions (id, title_id, slot, profile_key, added_at) VALUES (?, ?, 'standard', 'hd-primary', '2026-01-01T00:00:00Z')`, id, id)
	}
	title(1, "movie", 438631, nil, "Dune (2021)")
	title(2, "series", nil, 424536, "Frieren")
	title(3, "movie", 1, nil, nil)       // not imported yet: no folder
	title(4, "movie", 2, nil, "Waiting") // its Slot is not filled
	request := func(id, titleID int64, who, outcome string, filled any) {
		exec(t, st, `INSERT INTO requests (id, source, source_request_id, requester_id, requester_name, title_id, outcome, created_at)
			VALUES (?, 'plex', ?, ?, ?, ?, ?, '2026-01-02T00:00:00Z')`, id, id, who, who, titleID, outcome)
		exec(t, st, `INSERT INTO request_slots (request_id, slot, profile_key, version_id, filled_at) VALUES (?, 'standard', 'hd-primary', ?, ?)`, id, titleID, filled)
	}
	filled := "2026-01-03T00:00:00Z"
	request(1, 1, "ellie", "accepted", filled)
	request(2, 1, "joel", "accepted", filled)
	request(3, 1, "ellie", "accepted", filled) // asked twice
	request(4, 2, "tess", "accepted", filled)
	request(5, 3, "tess", "accepted", filled)
	request(6, 4, "tess", "accepted", nil)
	request(7, 2, "bill", "rejected", filled)

	svc := requests.New(requests.Deps{Store: st, Library: library.New(st, nil), Profiles: profiles.New(st, settings.New(st)), Grabs: noGrabs{}})
	got, err := svc.CompletedTitles(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("got %+v", got)
	}
	if got[0].TitleID != 1 || got[0].Folder != "/media/x/Dune (2021)" || got[0].TMDBID != 438631 || !slices.Equal(got[0].Requesters, []string{"ellie", "joel"}) {
		t.Fatalf("movie %+v", got[0])
	}
	if got[1].TitleID != 2 || got[1].TVDBID != 424536 || !slices.Equal(got[1].Requesters, []string{"tess"}) {
		t.Fatalf("series %+v", got[1])
	}
}

type noGrabs struct{}

func (noGrabs) Active(context.Context) ([]acquire.Active, error) { return nil, nil }
