package health_test

import (
	"context"
	"sync"
	"testing"

	"github.com/hyprsh/kestrel/internal/health"
)

func TestConcurrentRaisesOfOneKeyLeaveOneIssue(t *testing.T) {
	e := newEnv(t)
	var wg sync.WaitGroup
	errs := make(chan error, 50)
	for range 50 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs <- e.h.Raise(context.Background(), health.Issue{Key: "refresh_failed:1", Kind: health.KindRefreshFailed, Severity: health.Warning, Message: "x"})
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if rows := e.rows(t); len(rows) != 1 {
		t.Fatalf("%d issues, want 1", len(rows))
	}
}
