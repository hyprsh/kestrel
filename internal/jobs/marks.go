package jobs

import (
	"context"
	"time"
)

// Marks marks requested Titles in Plex: labels, a collection and a poster badge
// (ADR 0019). It does nothing while those switches are off, apart from taking
// back what it added.
const Marks = "marks"

// marksEvery is the wait between passes; Plex scans on its own time, so a
// Title it does not list yet is found on a later one.
const marksEvery = 10 * time.Minute

// MarksRunner is the plexmarks module's pass.
type MarksRunner interface {
	Run(ctx context.Context) error
}
