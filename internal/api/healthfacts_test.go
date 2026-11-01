package api_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/jobs"
)

type healthFactsJSON struct {
	Database struct {
		SizeBytes       int64      `json:"size_bytes"`
		Backups         int        `json:"backups"`
		LastBackupAt    *time.Time `json:"last_backup_at"`
		LastBackupBytes *int64     `json:"last_backup_bytes"`
	} `json:"database"`
	Clock struct {
		State         string  `json:"state"`
		OffsetSeconds *int    `json:"offset_seconds"`
		Source        *string `json:"source"`
	} `json:"clock"`
	Indexers []struct {
		InstanceID int64 `json:"instance_id"`
		Name       string
		MedianMs   *int `json:"median_ms"`
	} `json:"indexers"`
	Services []struct {
		Name string  `json:"name"`
		Key  *string `json:"key"`
	} `json:"services"`
}

func (s search) healthFacts(t *testing.T) healthFactsJSON {
	t.Helper()
	r := s.valid("GET", "/system/status", "")
	if r.Status != 200 {
		t.Fatalf("GET /system/status = %d %s", r.Status, r.Body)
	}
	return decode[healthFactsJSON](t, r)
}

func TestTheStatusReportsTheDatabaseAndTheDailyBackupTheJobTakes(t *testing.T) {
	t.Parallel()
	s := newSearch(t)

	before := s.healthFacts(t).Database
	if before.SizeBytes <= 0 || before.LastBackupAt != nil || before.LastBackupBytes != nil {
		t.Fatalf("before the first backup: %+v", before)
	}
	found := false
	for _, j := range decode[struct {
		Items []struct {
			Name     string `json:"name"`
			Schedule struct {
				EveryMs     int64  `json:"every_ms"`
				RunsEveryMs *int64 `json:"runs_every_ms"`
			} `json:"schedule"`
		} `json:"items"`
	}](t, s.valid("GET", "/jobs", "")).Items {
		if j.Name == jobs.Backup {
			found = j.Schedule.RunsEveryMs != nil && *j.Schedule.RunsEveryMs == (24*time.Hour).Milliseconds()
		}
	}
	if !found {
		t.Error("no backup job that runs daily among the jobs")
	}

	if err := s.in.app.Jobs.Pass(context.Background(), jobs.Backup); err != nil {
		t.Fatal(err)
	}
	after := s.healthFacts(t).Database
	if after.Backups != 1 || after.LastBackupAt == nil || time.Since(*after.LastBackupAt) > time.Minute || after.LastBackupBytes == nil || *after.LastBackupBytes <= 0 {
		t.Fatalf("after a backup: %+v", after)
	}

	// The next hourly check finds it fresh and takes none.
	if err := s.in.app.Jobs.Pass(context.Background(), jobs.Backup); err != nil {
		t.Fatal(err)
	}
	if got := s.healthFacts(t).Database.Backups; got != 1 {
		t.Errorf("%d backups after a second check within the day, want 1", got)
	}
}

func TestTheStatusComparesTheClockWithTMDBAndWarnsPastAMinute(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	ctx := context.Background()
	now := s.in.clock.Now()

	if c := s.healthFacts(t).Clock; c.State != "unknown" || c.OffsetSeconds != nil {
		t.Fatalf("before any comparison: %+v", c)
	}
	s.in.app.Health.ObserveClock(ctx, "TMDB", now.Add(-5*time.Second), now)
	if c := s.healthFacts(t).Clock; c.State != "in_sync" || c.OffsetSeconds == nil || *c.OffsetSeconds != 5 || c.Source == nil || *c.Source != "TMDB" {
		t.Fatalf("5 s ahead: %+v", c)
	}
	if rows := attentionKinds(t, s); len(rows) != 0 {
		t.Fatalf("rows while in sync: %v", rows)
	}

	s.in.app.Health.ObserveClock(ctx, "TMDB", now.Add(3*time.Minute), now)
	if c := s.healthFacts(t).Clock; c.State != "drifting" || c.OffsetSeconds == nil || *c.OffsetSeconds != -180 {
		t.Fatalf("3 min behind: %+v", c)
	}
	if rows := attentionKinds(t, s); len(rows) != 1 || rows[0] != "clock_drift" {
		t.Errorf("rows while drifting = %v, want the clock Warning", rows)
	}
}

func attentionKinds(t *testing.T, s search) []string {
	t.Helper()
	var kinds []string
	for _, r := range decode[struct {
		Rows []struct {
			Kind string `json:"kind"`
		} `json:"rows"`
	}](t, s.valid("GET", "/attention", "")).Rows {
		kinds = append(kinds, r.Kind)
	}
	return kinds
}

func TestTheStatusGivesEachIndexersMedianResponseTimeOverTheLastDay(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	id := s.healthFacts(t).Indexers[0].InstanceID
	if got := s.healthFacts(t).Indexers[0].MedianMs; got != nil {
		t.Fatalf("median before any search: %d", *got)
	}
	now := s.in.clock.Now().UTC()
	for i, ms := range []int{600, 900, 700} {
		at := now.Add(-time.Duration(i+1) * time.Hour).Format(time.RFC3339)
		if _, err := s.in.st.Write().Exec(`INSERT INTO indexer_searches (indexer_id, indexer_name, at, ok, releases, fit, duration_ms) VALUES (?, 'Alpha', ?, 1, 1, 1, ?)`, id, at, ms); err != nil {
			t.Fatal(err)
		}
	}
	old := now.Add(-30 * time.Hour).Format(time.RFC3339)
	if _, err := s.in.st.Write().Exec(`INSERT INTO indexer_searches (indexer_id, indexer_name, at, ok, releases, fit, duration_ms) VALUES (?, 'Alpha', ?, 1, 1, 1, 9000)`, id, old); err != nil {
		t.Fatal(err)
	}
	got := s.healthFacts(t).Indexers[0].MedianMs
	if got == nil || *got != 700 {
		t.Errorf("median = %v, want 700 ms (the last day's, not the day before's 9 s)", got)
	}
}

func TestTheStatusSaysWhoseKeyEachMetadataProviderUses(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	key := func(name string) *string {
		for _, v := range s.healthFacts(t).Services {
			if v.Name == name {
				return v.Key
			}
		}
		t.Fatalf("no %s service", name)
		return nil
	}
	if k := key("TMDB"); k != nil {
		t.Logf("TMDB runs on %s out of the box", *k)
	}
	if r := s.valid("PATCH", "/settings", fmt.Sprintf(`{"metadata":{"tmdb_api_key":%q}}`, "my-own-key")); r.Status != 200 {
		t.Fatalf("PATCH /settings = %d %s", r.Status, r.Body)
	}
	if k := key("TMDB"); k == nil || *k != "own" {
		t.Errorf("TMDB after the user set a key = %v, want own", k)
	}
}
