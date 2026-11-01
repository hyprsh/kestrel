package api_test

import (
	"fmt"
	"testing"
	"time"
)

type statsJSON struct {
	Range  string `json:"range"`
	From   string `json:"from"`
	To     string `json:"to"`
	Wanted struct {
		Count       int `json:"count"`
		LongMissing int `json:"long_missing"`
	} `json:"wanted"`
	Library struct {
		Titles int `json:"titles"`
		Movies int `json:"movies"`
	} `json:"library"`
	Grabs struct {
		Imported int `json:"imported"`
		Failed   int `json:"failed"`
		PerDay   []struct {
			Day      string `json:"day"`
			Imported int    `json:"imported"`
			Failed   int    `json:"failed"`
		} `json:"per_day"`
	} `json:"grabs"`
	TimeToFill struct {
		Median *int `json:"median_seconds"`
		Fills  int  `json:"fills"`
	} `json:"time_to_fill"`
	Indexers []struct {
		ID       int64    `json:"id"`
		Name     string   `json:"name"`
		Imported int      `json:"imported"`
		HitRate  *float64 `json:"hit_rate"`
	} `json:"indexers"`
	BestIndexerID  *int64 `json:"best_indexer_id"`
	DownloadClient struct {
		Name  *string `json:"name"`
		State string  `json:"state"`
		Speed []struct {
			Day string `json:"day"`
		} `json:"speed_per_day"`
	} `json:"download_client"`
	Storage struct {
		Disks []struct {
			Path string `json:"path"`
		} `json:"disks"`
		Growth *int64 `json:"growth_bytes_per_week"`
	} `json:"storage"`
	Requests struct {
		Total int `json:"total"`
	} `json:"requests"`
	BelowCutoff int `json:"below_cutoff"`
}

func (w wantedRig) stats(t *testing.T, query string) statsJSON {
	t.Helper()
	r := w.valid("GET", "/stats"+query, "")
	if r.Status != 200 {
		t.Fatalf("GET /stats%s = %d %s", query, r.Status, r.Body)
	}
	return decode[statsJSON](t, r)
}

func TestStatsDefaultsToThirtyDaysAndCountsWantedAndFinishedGrabs(t *testing.T) {
	t.Parallel()
	w := newWantedRig(t)
	old := decode[titleJSON](t, w.valid("POST", "/titles", fmt.Sprintf(addHD, 116149)))
	decode[titleJSON](t, w.valid("POST", "/titles", fmt.Sprintf(addHD, 77)))
	w.backdate(t, old.ID, 101)
	now := w.in.clock.Now().UTC()
	for i, state := range []string{"imported", "imported", "failed"} {
		at := now.Add(-time.Duration(i) * time.Hour).Format(time.RFC3339)
		w.exec(t, `INSERT INTO grabs (release_guid, release_name, indexer_id, indexer_name, size, published_at, score, parsed, verdict, client_instance_id, client_id, state, created_at, updated_at)
			VALUES (?, 'x', 7, 'Alpha', 1, ?, 0, '{}', '{}', 1, ?, ?, ?, ?)`, fmt.Sprint("g", i), at, fmt.Sprint("c", i), state, at, at)
	}
	w.exec(t, `INSERT INTO indexer_searches (indexer_id, indexer_name, at, ok, releases, fit, duration_ms) VALUES (7, 'Alpha', ?, 1, 2, 1, 800)`, now.Format(time.RFC3339))

	s := w.stats(t, "")
	if s.Range != "30d" || len(s.Grabs.PerDay) != 30 || s.To != now.Format("2006-01-02") {
		t.Errorf("range %s over %d days to %s", s.Range, len(s.Grabs.PerDay), s.To)
	}
	if s.Wanted.Count != 2 || s.Wanted.LongMissing != 1 || s.Library.Titles != 2 || s.Library.Movies != 2 {
		t.Errorf("wanted %+v library %+v, want 2 Wanted with 1 Long Missing in a Library of 2 Movies", s.Wanted, s.Library)
	}
	if s.Grabs.Imported != 2 || s.Grabs.Failed != 1 {
		t.Errorf("grabs = %+v", s.Grabs)
	}
	if len(s.Indexers) != 1 || s.Indexers[0].Name != "Alpha" || s.Indexers[0].Imported != 2 || s.Indexers[0].HitRate == nil || *s.Indexers[0].HitRate != 1 {
		t.Errorf("indexers = %+v", s.Indexers)
	}
	if s.BestIndexerID == nil || *s.BestIndexerID != 7 {
		t.Errorf("best indexer = %v, want 7", s.BestIndexerID)
	}
	if s.TimeToFill.Median != nil || s.TimeToFill.Fills != 0 {
		t.Errorf("time to fill = %+v, want none: no Grab filled a Version", s.TimeToFill)
	}
	if len(s.DownloadClient.Speed) != 14 || s.DownloadClient.State != "none" || s.DownloadClient.Name != nil {
		t.Errorf("download client = %+v", s.DownloadClient)
	}
	if s.Storage.Growth != nil || s.Requests.Total != 0 {
		t.Errorf("storage growth %v requests %d, want nothing", s.Storage.Growth, s.Requests.Total)
	}
}

func TestStatsRangeSelectsTheDaysAndRefusesOthers(t *testing.T) {
	t.Parallel()
	w := newWantedRig(t)
	for q, days := range map[string]int{"?range=7d": 7, "?range=30d": 30, "?range=90d": 90} {
		if got := len(w.stats(t, q).Grabs.PerDay); got != days {
			t.Errorf("GET /stats%s has %d days, want %d", q, got, days)
		}
	}
	if r := w.valid("GET", "/stats?range=1y", ""); r.Status != 422 && r.Status != 400 {
		t.Errorf("an unknown range = %d, want a validation error", r.Status)
	}
}
