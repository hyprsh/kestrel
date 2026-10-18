package api_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/app"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/metadata/metadatatest"
)

// wantedRig is a Library instance whose clock the test moves.
type wantedRig struct {
	library
	in *instance
}

func newWantedRig(t *testing.T) wantedRig {
	t.Helper()
	tmdb := metadatatest.New(t)
	tvdb := metadatatest.NewTVDB(t)
	data, config := t.TempDir(), t.TempDir()
	in := newInstance(t, "", func(o *app.Options) {
		o.DataDir, o.ConfigDir = data, config
		o.Metadata = metadata.NewTMDB(metadata.TMDBOptions{BaseURL: tmdb.APIBase(), ImageBase: tmdb.ImageBase(), Keys: metadata.StaticKey(metadatatest.Key)})
		o.TVDB = metadata.NewTVDB(metadata.TVDBOptions{BaseURL: tvdb.APIBase(), Keys: metadata.StaticTVDBKey(metadatatest.TVDBKey)})
		o.Posters = metadata.NewPosters(metadata.PostersOptions{ConfigDir: config, ImageBase: tmdb.ImageBase()})
	})
	return wantedRig{library: library{browser: in.setUp(), tmdb: tmdb, tvdb: tvdb, config: config, data: data}, in: in}
}

type titleRowJSON struct {
	ID          int64   `json:"id"`
	Title       string  `json:"title"`
	WantedSince *string `json:"wanted_since"`
	Slots       struct {
		HD *struct {
			State       string `json:"state"`
			LongMissing bool   `json:"long_missing"`
		} `json:"hd"`
	} `json:"slots"`
}

func (w wantedRig) titles(t *testing.T, query string) []titleRowJSON {
	t.Helper()
	r := w.valid("GET", "/titles?limit=100&"+query, "")
	if r.Status != 200 {
		t.Fatalf("GET /titles?%s = %d %s", query, r.Status, r.Body)
	}
	return decode[struct {
		Items []titleRowJSON `json:"items"`
	}](t, r).Items
}

// backdate makes a Title's Versions Wanted since days ago: a session would not
// survive moving the clock that far.
func (w wantedRig) backdate(t *testing.T, titleID int64, days int) {
	t.Helper()
	at := w.in.clock.Now().Add(-time.Duration(days) * 24 * time.Hour).UTC().Format(time.RFC3339)
	if _, err := w.in.st.Write().ExecContext(context.Background(), `UPDATE versions SET added_at = ? WHERE title_id = ?`, at, titleID); err != nil {
		t.Fatal(err)
	}
}

func ids(rows []titleRowJSON) []int64 {
	out := []int64{}
	for _, r := range rows {
		out = append(out, r.ID)
	}
	return out
}

const addHD = `{"kind":"movie","tmdb_id":%d,"versions":[{"slot":"hd","profile":"hd-primary"}]}`

func TestTheWantedFilterListsWantedTitlesLongestWantedFirstAndTheLongMissingChipKeepsTheOldOnes(t *testing.T) {
	w := newWantedRig(t)
	first := decode[titleJSON](t, w.valid("POST", "/titles", fmt.Sprintf(addHD, 116149)))
	second := decode[titleJSON](t, w.valid("POST", "/titles", fmt.Sprintf(addHD, 77)))
	w.backdate(t, first.ID, 101)
	w.backdate(t, second.ID, 1)

	all := w.titles(t, "")
	if got := ids(all); len(got) != 2 || got[0] != second.ID {
		t.Errorf("default order = %v, want the newest first", got)
	}
	wanted := w.titles(t, "wanted=true&sort=wanted_since")
	if got := ids(wanted); len(got) != 2 || got[0] != first.ID || got[1] != second.ID {
		t.Errorf("Wanted by wanted_since = %v, want %d (Wanted for 101 days) then %d", got, first.ID, second.ID)
	}
	if wanted[0].WantedSince == nil || wanted[0].Slots.HD == nil || !wanted[0].Slots.HD.LongMissing || wanted[1].Slots.HD.LongMissing {
		t.Errorf("rows = %+v", wanted)
	}
	if got := ids(w.titles(t, "long_missing=true")); len(got) != 1 || got[0] != first.ID {
		t.Errorf("Long Missing chip = %v, want only title %d", got, first.ID)
	}
	if r := w.valid("GET", "/titles?sort=bogus", ""); r.Status != 422 && r.Status != 400 {
		t.Errorf("an unknown sort = %d, want a validation error", r.Status)
	}
}

func TestLongMissingIsAGroupedRowOutsideTheBadgeCount(t *testing.T) {
	w := newWantedRig(t)
	first := decode[titleJSON](t, w.valid("POST", "/titles", fmt.Sprintf(addHD, 116149)))
	if got := w.attention(t).LongMissing.Count; got != 0 {
		t.Fatalf("long missing on add = %d", got)
	}
	w.backdate(t, first.ID, 91)

	a := decode[struct {
		Count       int `json:"count"`
		LongMissing struct {
			Count int `json:"count"`
			Items []struct {
				TitleID     int64   `json:"title_id"`
				Title       string  `json:"title"`
				Slot        string  `json:"slot"`
				Profile     string  `json:"profile"`
				WantedSince string  `json:"wanted_since"`
				LastFailure *string `json:"last_failure"`
			} `json:"items"`
		} `json:"long_missing"`
	}](t, w.valid("GET", "/attention", ""))

	if a.LongMissing.Count != 1 || len(a.LongMissing.Items) != 1 {
		t.Fatalf("long_missing = %+v", a.LongMissing)
	}
	it := a.LongMissing.Items[0]
	if it.TitleID != first.ID || it.Title != "Paddington" || it.Slot != "hd" || it.Profile != "hd-primary" || it.WantedSince == "" || it.LastFailure != nil {
		t.Errorf("item = %+v", it)
	}
	// The row sits outside the rail badge: `count` is the other rows only.
	for _, r := range w.attention(t).Rows {
		if r.Kind == "long_missing" {
			t.Errorf("Long Missing is among the badge rows: %+v", r)
		}
	}
}

func TestPostWantedSearchMakesEveryWantedSearchStateDueNowAndWakesTheSweep(t *testing.T) {
	w := newWantedRig(t)
	decode[titleJSON](t, w.valid("POST", "/titles", fmt.Sprintf(addHD, 116149)))
	decode[titleJSON](t, w.valid("POST", "/titles", fmt.Sprintf(addHD, 77)))
	ctx := context.Background()
	future := w.in.clock.Now().Add(30 * 24 * time.Hour).UTC().Format(time.RFC3339)
	if _, err := w.in.st.Write().ExecContext(ctx, `UPDATE search_state SET next_missing_at = ?`, future); err != nil {
		t.Fatal(err)
	}

	r := w.valid("POST", "/wanted/search", "")

	if r.Status != 202 {
		t.Fatalf("POST /wanted/search = %d %s", r.Status, r.Body)
	}
	if got := decode[struct {
		Versions int `json:"versions"`
	}](t, r); got.Versions != 2 {
		t.Errorf("queued %d Versions, want 2", got.Versions)
	}
	var due int
	now := w.in.clock.Now().UTC().Format(time.RFC3339)
	if err := w.in.st.Read().QueryRowContext(ctx, `SELECT COUNT(*) FROM search_state WHERE next_missing_at <= ?`, now).Scan(&due); err != nil || due != 2 {
		t.Errorf("%d search_state rows due now (%v), want 2", due, err)
	}
}
