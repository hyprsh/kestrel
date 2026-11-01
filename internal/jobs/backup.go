package jobs

import (
	"context"
	"time"
)

// Backup copies the database into backups/ once a day, the copy an upgrade takes, and keeps the newest few.
// It is checked hourly and runs when the newest scheduled backup is a day old, or there is none.
const Backup = "backup"

// backupDue is how old the newest scheduled backup must be before the hourly check takes another. A little under a
// day, so the hourly check that lands just before the day is up takes it, and the backup does not slip an hour a day.
const backupDue = dailyEvery - dailyCheck + time.Minute

// BackupLoop returns the Backup loop. last says when the newest scheduled backup was taken, zero for none; run takes one.
// A failed backup is retried at the next hourly check.
func BackupLoop(clock func() time.Time, last func() time.Time, run func(ctx context.Context) error) Loop {
	if clock == nil {
		clock = time.Now
	}
	return Loop{
		Name: Backup,
		Run: func(ctx context.Context) error {
			if at := last(); !at.IsZero() && clock().Sub(at) < backupDue {
				return nil
			}
			return run(ctx)
		},
		Schedule: Schedule{Every: dailyCheck, Runs: dailyEvery},
	}
}
