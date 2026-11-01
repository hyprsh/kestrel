package jobs_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/jobs"
)

func TestTheBackupLoopTakesABackupOnlyWhenTheNewestIsADayOldOrThereIsNone(t *testing.T) {
	ctx := context.Background()
	at := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	var last time.Time
	var taken int
	var fail error
	l := jobs.BackupLoop(func() time.Time { return at }, func() time.Time { return last }, func(context.Context) error {
		if fail != nil {
			return fail
		}
		taken++
		last = at
		return nil
	})
	if l.Name != jobs.Backup || l.Schedule.Every != time.Hour || l.Schedule.Runs != 24*time.Hour {
		t.Fatalf("loop = %q every %v runs %v", l.Name, l.Schedule.Every, l.Schedule.Runs)
	}
	check := func(want int, why string) {
		t.Helper()
		if err := l.Run(ctx); err != nil || taken != want {
			t.Fatalf("%s: %d backups (err %v), want %d", why, taken, err, want)
		}
	}
	check(1, "none yet")
	at = at.Add(3 * time.Hour)
	check(1, "3 h old")
	at = at.Add(19 * time.Hour)
	check(1, "22 h old")
	at = at.Add(90 * time.Minute) // the hourly check just before the day is up takes it, so it does not slip an hour a day
	check(2, "23.5 h old")

	fail = errors.New("disk full")
	at = at.Add(24 * time.Hour)
	if err := l.Run(ctx); err == nil || taken != 2 {
		t.Fatalf("a failing backup returns its error and counts for nothing: %d, %v", taken, err)
	}
	fail = nil
	at = at.Add(time.Hour)
	check(3, "retried at the next check")
}
