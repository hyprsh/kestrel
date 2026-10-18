package api

import (
	"context"

	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/notices"
)

// trashCommit is the TRaSH commit that scores Releases now: the embedded
// snapshot or a newer one taken from TRaSH.
func (s *server) trashCommit(context.Context) string { return s.scoring.Current().Commit() }

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
