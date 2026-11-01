package health_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/health"
	"github.com/hyprsh/kestrel/internal/history"
)

type cleared struct {
	Key         string
	Attempts    []string
	RecoveredAt string `json:"recovered_at"`
	Waited      *int
	Lost        *int
}

func (e env) cleared(t *testing.T) cleared {
	t.Helper()
	evs, _ := e.hist.After(context.Background(), 0, 100)
	for _, ev := range evs {
		if ev.Kind == history.HealthCleared {
			var c cleared
			if err := json.Unmarshal(ev.Data, &c); err != nil {
				t.Fatalf("data %s: %v", ev.Data, err)
			}
			return c
		}
	}
	t.Fatal("no cleared event")
	return cleared{}
}

func TestARecoveredDownloadClientRecordsItsRetriesWhenItCameBackAndWhichGrabsWaited(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	var sinceAsked time.Time
	e.h.WithHeldUp(func(_ context.Context, kind health.Kind, instanceID int64, since time.Time) (int, int, error) {
		sinceAsked = since
		if kind != health.KindDownloadClient || instanceID != sab.ID {
			t.Errorf("held up asked for %s %d, want the download client %d", kind, instanceID, sab.ID)
		}
		return 2, 0, nil
	})
	first := *e.now
	for range 3 {
		e.h.ObserveDownloadClient(ctx, sab, &health.Failure{Message: "connection refused"})
		*e.now = e.now.Add(time.Minute)
	}
	e.h.ObserveDownloadClient(ctx, sab, nil)

	c := e.cleared(t)

	if len(c.Attempts) != 3 || c.Attempts[0] != first.Format(time.RFC3339) || c.Attempts[2] != first.Add(2*time.Minute).Format(time.RFC3339) {
		t.Errorf("attempts = %v, want the three failed polls", c.Attempts)
	}
	if c.RecoveredAt != e.now.Format(time.RFC3339) {
		t.Errorf("recovered_at = %q, want %s", c.RecoveredAt, e.now.Format(time.RFC3339))
	}
	if c.Waited == nil || *c.Waited != 2 || c.Lost == nil || *c.Lost != 0 || !sinceAsked.Equal(first) {
		t.Errorf("waited %v lost %v since %v; want 2 waited, none lost, counted from the first failure", c.Waited, c.Lost, sinceAsked)
	}
}

func TestARecoveredIndexerRecordsItsRetriesToo(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, enabledIndexers(alpha))
	e.h.WithHeldUp(func(_ context.Context, kind health.Kind, instanceID int64, _ time.Time) (int, int, error) {
		if kind != health.KindIndexer || instanceID != alpha.ID {
			t.Errorf("held up asked for %s %d, want the indexer %d", kind, instanceID, alpha.ID)
		}
		return 0, 0, nil
	})
	e.h.ObserveIndexer(ctx, alpha, &health.Failure{Auth: true, Message: "bad key"})
	*e.now = e.now.Add(time.Minute)
	e.h.ObserveIndexer(ctx, alpha, &health.Failure{Auth: true, Message: "bad key"})
	*e.now = e.now.Add(time.Minute)
	e.h.ObserveIndexer(ctx, alpha, nil)

	c := e.cleared(t)

	if len(c.Attempts) != 2 || c.RecoveredAt == "" || c.Waited == nil || *c.Waited != 0 {
		t.Errorf("cleared = %+v, want two attempts, the recovery time and no Grabs waiting", c)
	}
}

func TestAClearedRowThatWasNotAConnectionOutageCarriesNoRetries(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	_ = e.h.Raise(ctx, exdev)
	_ = e.h.Clear(ctx, exdev.Key)

	c := e.cleared(t)

	if c.Key != exdev.Key || len(c.Attempts) != 0 || c.Waited != nil {
		t.Errorf("cleared = %+v, want only the row's identity", c)
	}
}
