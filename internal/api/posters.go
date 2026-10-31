package api

import (
	"context"

	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/library"
)

// postersOf is which of the Library's Titles have a poster to serve, by id.
func (s *server) postersOf(ctx context.Context) (map[int64]bool, error) {
	view, err := s.view(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := s.library.List(ctx, view, library.Filter{})
	if err != nil {
		return nil, err
	}
	out := make(map[int64]bool, len(rows))
	for _, r := range rows {
		out[r.ID] = r.HasPoster
	}
	return out, nil
}

// withAttentionPosters sets has_poster on the Needs attention rows about a
// Title, the Long Missing items and the Originals offers. It reads the Library
// only when one of them names a Title, and only the read (not the badge count)
// pays for it.
func (s *server) withAttentionPosters(ctx context.Context, a *oapi.Attention) error {
	if len(a.LongMissing.Items) == 0 && len(a.Originals.Items) == 0 {
		named := false
		for _, r := range a.Rows {
			named = named || r.Subject.TitleId != nil
		}
		if !named {
			return nil
		}
	}
	has, err := s.postersOf(ctx)
	if err != nil {
		return err
	}
	for i, r := range a.Rows {
		poster := r.Subject.TitleId != nil && has[*r.Subject.TitleId]
		a.Rows[i].HasPoster = &poster
	}
	for i, it := range a.LongMissing.Items {
		poster := has[it.TitleId]
		a.LongMissing.Items[i].HasPoster = &poster
	}
	for i, o := range a.Originals.Items {
		poster := has[o.TitleId]
		a.Originals.Items[i].HasPoster = &poster
	}
	return nil
}

// withAdoptionPosters sets has_poster on the matches to a tracked Title.
func (s *server) withAdoptionPosters(ctx context.Context, rows []oapi.AdoptionRow) error {
	tracked := false
	for _, r := range rows {
		tracked = tracked || (r.Match != nil && r.Match.TitleId != nil)
	}
	if !tracked {
		return nil
	}
	has, err := s.postersOf(ctx)
	if err != nil {
		return err
	}
	for _, r := range rows {
		if r.Match != nil {
			poster := r.Match.TitleId != nil && has[*r.Match.TitleId]
			r.Match.HasPoster = &poster
		}
	}
	return nil
}
