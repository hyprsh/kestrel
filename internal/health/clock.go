package health

import (
	"context"
	"fmt"
	"time"
)

// ClockTolerance is how far the server's clock may differ from the reference before it is a Warning.
// The reference is an HTTP Date header, whole seconds, so a smaller difference says nothing.
const ClockTolerance = 60 * time.Second

// ClockSample is the last comparison of the server's clock with a trusted time source.
type ClockSample struct {
	// Offset is the server's clock less the reference: positive when the server is ahead, negative when behind.
	Offset time.Duration
	// At is when the comparison was made (the server's clock).
	At time.Time
	// Source names the reference ("TMDB").
	Source string
}

// Drifting reports whether the sample is beyond ClockTolerance either way.
func (c ClockSample) Drifting() bool {
	return c.Offset > ClockTolerance || c.Offset < -ClockTolerance
}

// ObserveClock compares the server's clock with a time source it just heard from: reference is the time the source
// reported (its HTTP Date, corrected by Age), local the server's own clock when the answer arrived. Beyond ClockTolerance
// it raises a Warning (a skewed clock mis-dates releases, Upcoming days and sessions); within it, clears the row.
// Any metadata call can report one, so the sample is never more than the last call old.
func (s *Service) ObserveClock(ctx context.Context, source string, reference, local time.Time) {
	sample := ClockSample{Offset: local.Sub(reference).Round(time.Second), At: local, Source: source}
	s.mu.Lock()
	s.clockSample = &sample
	s.mu.Unlock()
	if !sample.Drifting() {
		s.logErr(s.Clear(ctx, ClockKey))
		return
	}
	s.logErr(s.Raise(ctx, Issue{Key: ClockKey, Kind: KindClock, Severity: Warning, Message: ClockMessage(sample)}))
}

// Clock is the last comparison; ok is false before the first.
func (s *Service) Clock() (ClockSample, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.clockSample == nil {
		return ClockSample{}, false
	}
	return *s.clockSample, true
}

// ClockKey is the Needs attention key of the clock Warning.
const ClockKey = "clock_drift"

// ClockMessage says how far off the server's clock is: "The server's clock is 3 min behind TMDB's".
func ClockMessage(c ClockSample) string {
	return fmt.Sprintf("The server's clock is %s %s's", ClockOffsetWords(c.Offset), c.Source)
}

// ClockOffsetWords is "3 min behind" or "2 h ahead of" for an offset; "in sync" within a second.
func ClockOffsetWords(offset time.Duration) string {
	if offset > -time.Second && offset < time.Second {
		return "in sync with"
	}
	d, dir := offset, "ahead of"
	if offset < 0 {
		d, dir = -offset, "behind"
	}
	var amount string
	switch {
	case d < time.Minute:
		amount = fmt.Sprintf("%d s", int(d.Seconds()))
	case d < time.Hour:
		amount = fmt.Sprintf("%d min", int(d.Minutes()+0.5))
	case d < 48*time.Hour:
		amount = fmt.Sprintf("%.1f h", d.Hours())
	default:
		amount = fmt.Sprintf("%d days", int(d.Hours()/24+0.5))
	}
	return amount + " " + dir
}
