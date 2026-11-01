package acquire

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/hyprsh/kestrel/internal/acquire/db"
	"github.com/hyprsh/kestrel/internal/scoring"
)

// GrabFormats are the Custom Formats the Grab's Release matched when it was chosen, from the Verdict the Grab
// stored; none when the snapshot cannot be read.
func (s *Service) GrabFormats(ctx context.Context, grabID int64) ([]scoring.MatchedFormat, error) {
	row, err := db.New(s.st.Read()).GetGrab(ctx, grabID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrGrabNotFound
	}
	if err != nil {
		return nil, err
	}
	var v scoring.Verdict
	if json.Unmarshal([]byte(row.Verdict), &v) != nil {
		return nil, nil
	}
	return v.Matched, nil
}
