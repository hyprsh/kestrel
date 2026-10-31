package requests

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/hyprsh/kestrel/internal/requests/db"
)

// A source that polls its Requests (Silo's CheckStatus) stamps each read with MarkAsked. A Request
// the source has not asked about for longer than it ever should is Quiet: the source may have
// dropped it without telling Kestrel. Quiet only flags; ending a Request is a separate act (End).

// ErrNotOpen means the Request is not open, so it cannot be ended or have its silence dismissed.
var ErrNotOpen = errors.New("request is not open")

// MarkAsked records that source asked about the Requests ids just now. Requests of another source
// are left alone. It also lets a dismissed silence be flagged again.
func (s *Service) MarkAsked(ctx context.Context, source string, ids []int64) error {
	if len(ids) == 0 {
		return nil
	}
	return db.New(s.d.Store.Write()).MarkRequestsAsked(ctx, db.MarkRequestsAskedParams{
		At: sql.NullString{String: ts(s.d.Clock()), Valid: true}, Source: source, Ids: jsonList(ids),
	})
}

// Quiet is an open Request of source that the source last asked about before cutoff. A Request
// with no stamp yet is counted from its creation time. Dismissed ones are left out.
type Quiet struct {
	Request
	// LastAsked is when the source last asked, else when the Request was made.
	LastAsked time.Time
}

// Quiet lists the open Requests of source last asked about before cutoff, oldest first.
func (s *Service) Quiet(ctx context.Context, source string, cutoff time.Time) ([]Quiet, error) {
	rows, err := db.New(s.d.Store.Read()).ListQuietRequests(ctx, db.ListQuietRequestsParams{
		Source: source, Before: sql.NullString{String: ts(cutoff), Valid: true},
	})
	if err != nil {
		return nil, err
	}
	c := s.cache()
	var out []Quiet
	for _, row := range rows {
		r, err := s.viewWith(ctx, row, c)
		if err != nil {
			return nil, err
		}
		if r.State() != StateOpen {
			continue // nothing is on its way: the source has nothing left to ask
		}
		asked := r.CreatedAt
		if row.LastAskedAt.Valid {
			if t, err := time.Parse(time.RFC3339, row.LastAskedAt.String); err == nil {
				asked = t
			}
		}
		out = append(out, Quiet{Request: r, LastAsked: asked})
	}
	return out, nil
}

// DismissQuiet stops flagging a Quiet Request until its source asks about it again.
func (s *Service) DismissQuiet(ctx context.Context, id int64) error {
	n, err := db.New(s.d.Store.Write()).DismissQuietRequest(ctx, id)
	if err != nil {
		return err
	}
	if n == 0 {
		return s.notOpenOrMissing(ctx, id)
	}
	return nil
}

// End ends an open Request the way a rejected one ends: its Versions and Title stay, nothing more
// is asked for it, and it reads as rejected. It returns the ended Request.
// The Title and its Versions stay Wanted on purpose: another person may want them too.
func (s *Service) End(ctx context.Context, id int64) (Request, error) {
	r, err := s.Get(ctx, id)
	if err != nil {
		return r, err
	}
	if r.State() != StateOpen {
		return r, ErrNotOpen
	}
	n, err := db.New(s.d.Store.Write()).EndRequest(ctx, id)
	if err != nil {
		return r, err
	}
	if n == 0 {
		return r, ErrNotOpen
	}
	r.Outcome = Rejected
	return r, nil
}

func (s *Service) notOpenOrMissing(ctx context.Context, id int64) error {
	if _, err := db.New(s.d.Store.Read()).GetRequest(ctx, id); errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	return ErrNotOpen
}
