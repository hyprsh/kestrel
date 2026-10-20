package acquire

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/hyprsh/kestrel/internal/settings"
)

// pauseKey is the settings key of the Pause grabs switch.
const pauseKey = "pause_grabs"

// Pause is the "Pause grabs" switch. While it is on no automatic Grab is made:
// the sweep, RSS, the search on add and the retry after a failure still search
// and score Releases but send nothing to the download client. A Grab started
// by hand still goes through. It is off until switched on.
type Pause struct {
	settings *settings.Settings
}

// NewPause returns the switch stored in s.
func NewPause(s *settings.Settings) *Pause { return &Pause{settings: s} }

// InTx returns the switch saving through tx, so it saves with the other
// settings sections; the caller commits.
func (p *Pause) InTx(tx *sql.Tx) *Pause { return &Pause{settings: p.settings.InTx(tx)} }

// Paused reports whether automatic Grabs are paused.
func (p *Pause) Paused(ctx context.Context) (bool, error) {
	raw, ok, err := p.settings.Get(ctx, pauseKey)
	if err != nil || !ok {
		return false, err
	}
	var on bool
	if err := json.Unmarshal(raw, &on); err != nil {
		return false, fmt.Errorf("acquire: stored %s: %w", pauseKey, err)
	}
	return on, nil
}

// SetPaused switches automatic Grabs off (true) or back on.
func (p *Pause) SetPaused(ctx context.Context, on bool) error {
	raw, _ := json.Marshal(on)
	return p.settings.Put(ctx, pauseKey, raw)
}
