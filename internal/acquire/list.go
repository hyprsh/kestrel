package acquire

import (
	"context"
	"encoding/json"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire/db"
)

// GrabFilter narrows Grabs; its zero value lists every Grab.
type GrabFilter struct {
	// States keeps the Grabs in any of them; empty keeps all.
	States []string
	// Stalled, when set, keeps only stalled Imports (true) or leaves them out (false).
	Stalled *bool
	// Since keeps the Grabs whose state last changed then or later.
	Since time.Time
	// Before pages: only Grabs with a smaller id.
	Before int64
	Limit  int
}

// Record is a Grab as GET /grabs lists it: with how it ended.
type Record struct {
	Grab
	// BlocklistReason is the reason of the Blocklist entry the Release got, empty when none.
	BlocklistReason string
	// Stall is set while the Import waits for the environment to be fixed.
	Stall *Stall
}

// Stall is what holds a stalled Import up, and when it is tried again.
type Stall struct {
	Reason string
	Since  time.Time
	NextAt time.Time
}

// Grabs lists Grabs newest first.
func (s *Service) Grabs(ctx context.Context, f GrabFilter) ([]Record, error) {
	p := db.ListGrabsParams{Max: int64(f.Limit)}
	if len(f.States) > 0 {
		b, _ := json.Marshal(f.States)
		p.States = string(b)
	}
	if f.Stalled != nil {
		p.Stalled = b2i(*f.Stalled)
	}
	if !f.Since.IsZero() {
		p.Since = ts(f.Since)
	}
	if f.Before != 0 {
		p.Before = f.Before
	}
	rows, err := db.New(s.st.Read()).ListGrabs(ctx, p)
	if err != nil {
		return nil, err
	}
	out := make([]Record, len(rows))
	for i, r := range rows {
		out[i] = Record{Grab: grabOf(r.Grab), BlocklistReason: r.BlocklistReason}
		if r.Grab.StalledSince.Valid {
			out[i].Stall = &Stall{Reason: r.Grab.StalledReason.String, Since: parseTime(r.Grab.StalledSince.String), NextAt: parseTime(r.Grab.NextImportAt.String)}
		}
	}
	return out, nil
}
