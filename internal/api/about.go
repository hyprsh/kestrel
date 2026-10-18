package api

import (
	"context"

	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/notices"
	"github.com/hyprsh/kestrel/internal/scoring"
)

// trashCommit is the TRaSH commit that scores Releases now. Until TRaSH updates
// can swap the snapshot, that is the embedded one.
func (s *server) trashCommit(context.Context) string {
	snap, err := scoring.Embedded()
	if err != nil {
		return ""
	}
	return snap.Commit()
}

func (s *server) GetAbout(ctx context.Context, _ oapi.GetAboutRequestObject) (oapi.GetAboutResponseObject, error) {
	info := s.updates.Info(ctx)
	out := oapi.About{
		Version:            s.opts.Version,
		License:            "GPL-3.0-only",
		TrashCommit:        s.trashCommit(ctx),
		CheckGithubUpdates: s.updates.Enabled(ctx),
	}
	if info.UpdateAvailable {
		out.Update = &oapi.UpdateAvailable{Version: info.Latest, Url: info.URL}
	}
	if !info.CheckedAt.IsZero() {
		t := info.CheckedAt
		out.CheckedAt = &t
	}
	return oapi.GetAbout200JSONResponse(out), nil
}

func (s *server) GetNotices(context.Context, oapi.GetNoticesRequestObject) (oapi.GetNoticesResponseObject, error) {
	return oapi.GetNotices200TextResponse(notices.Text), nil
}
