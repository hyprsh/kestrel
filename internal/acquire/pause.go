package acquire

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/hyprsh/kestrel/internal/settings"
)

// pauseKey is the settings key of the Pause grabs switch; pauseSinceKey keeps
// when it was last switched on.
const (
	pauseKey      = "pause_grabs"
	pauseSinceKey = "pause_grabs_since"
)

// Pause is the "Pause grabs" switch. While it is on no automatic Grab is made:
// the sweep, RSS, the search on add and the retry after a failure still search
// and score Releases but send nothing to the download client. A Grab started
// by hand still goes through. It is off until switched on.
type Pause struct {
	settings *settings.Settings
	clock    func() time.Time
}

// NewPause returns the switch stored in s; clock stamps when it is switched on.
func NewPause(s *settings.Settings, clock func() time.Time) *Pause {
	return &Pause{settings: s, clock: clock}
}

// InTx returns the switch saving through tx, so it saves with the other
// settings sections; the caller commits.
func (p *Pause) InTx(tx *sql.Tx) *Pause { return &Pause{settings: p.settings.InTx(tx), clock: p.clock} }

// Paused reports whether automatic Grabs are paused.
func (p *Pause) Paused(ctx context.Context) (bool, error) {
	var on bool
	err := p.get(ctx, pauseKey, &on)
	return on, err
}

// PausedSince is when the switch was last switched on; zero if never.
func (p *Pause) PausedSince(ctx context.Context) (time.Time, error) {
	var since time.Time
	err := p.get(ctx, pauseSinceKey, &since)
	return since, err
}

// SetPaused switches automatic Grabs off (true) or back on. Switching on a
// switch that is off records when.
func (p *Pause) SetPaused(ctx context.Context, on bool) error {
	if on {
		was, err := p.Paused(ctx)
		if err != nil {
			return err
		}
		if !was {
			if err := p.put(ctx, pauseSinceKey, p.clock().UTC().Truncate(time.Second)); err != nil {
				return err
			}
		}
	}
	return p.put(ctx, pauseKey, on)
}

// get reads key into v, leaving v as it is when the key is not stored.
func (p *Pause) get(ctx context.Context, key string, v any) error {
	raw, ok, err := p.settings.Get(ctx, key)
	if err != nil || !ok {
		return err
	}
	if err := json.Unmarshal(raw, v); err != nil {
		return fmt.Errorf("acquire: stored %s: %w", key, err)
	}
	return nil
}

func (p *Pause) put(ctx context.Context, key string, v any) error {
	raw, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return p.settings.Put(ctx, key, raw)
}
