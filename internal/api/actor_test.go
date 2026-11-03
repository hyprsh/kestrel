package api_test

import (
	"context"

	"github.com/hyprsh/kestrel/internal/history"
)

// jobCtx is the context of work a background loop does, which supplies the trigger of what it records in Kestrel.
func jobCtx() context.Context {
	return history.WithTrigger(context.Background(), history.Job(history.TriggerJob, "test"))
}
