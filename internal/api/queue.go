package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/jobs"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/plugin"
)

// ListQueue is the `queue` read model behind "Downloading now": the active
// Grabs joined with their Title, Slot and the file an Upgrade replaces.
func (s *server) ListQueue(ctx context.Context, _ oapi.ListQueueRequestObject) (oapi.ListQueueResponseObject, error) {
	active, err := s.acquire.Active(ctx)
	if err != nil {
		return nil, err
	}
	view, err := s.view(ctx)
	if err != nil {
		return nil, err
	}
	titles := map[int64]*library.Detail{}
	detail := func(id int64) *library.Detail {
		if id == 0 {
			return nil
		}
		if d, ok := titles[id]; ok {
			return d
		}
		d, err := s.library.Get(ctx, id, view)
		if err != nil {
			titles[id] = nil
			return nil
		}
		titles[id] = &d
		return &d
	}

	out := oapi.QueueList{Items: make([]oapi.QueueItem, 0, len(active))}
	for _, a := range active {
		it := oapi.QueueItem{
			GrabId: a.ID, ReleaseName: a.ReleaseName, Phase: oapi.QueueItemPhase(a.Phase), Episodes: []string{},
			BytesTotal: a.BytesTotal, BytesLeft: a.BytesLeft, IsUpgrade: a.IsUpgrade,
		}
		if a.TitleID != 0 {
			it.TitleId = &a.TitleID
		}
		if a.VersionID != 0 {
			it.VersionId = &a.VersionID
		}
		if a.ETA > 0 {
			secs := int(a.ETA.Seconds())
			it.Eta = &secs
		}
		if d := detail(a.TitleID); d != nil {
			it.Title = d.Title
			it.Year = intPtr(d.Year)
			for _, v := range d.Versions {
				if v.ID != a.VersionID {
					continue
				}
				slot := slotToAPI(v.Slot)
				it.Slot = &slot
				if a.IsUpgrade && v.File != nil && v.File.Score != nil {
					delta := a.Score - *v.File.Score
					it.ScoreDelta = &delta
				}
			}
		}
		out.Items = append(out.Items, it)
	}
	return oapi.ListQueue200JSONResponse(out), nil
}

func (s *server) CancelGrab(ctx context.Context, r oapi.CancelGrabRequestObject) (oapi.CancelGrabResponseObject, error) {
	blocklist := r.Body != nil && r.Body.Blocklist != nil && *r.Body.Blocklist
	g, err := s.acquire.Cancel(ctx, r.Id, blocklist)
	var pe *plugin.Error
	switch {
	case errors.Is(err, acquire.ErrGrabNotFound):
		return nil, problem(http.StatusNotFound, "not_found", "no such Grab")
	case errors.As(err, &pe):
		return nil, problem(http.StatusBadGateway, "upstream_unavailable", "The download client failed: "+pe.Message)
	case err != nil:
		return nil, err
	}
	if blocklist && g.VersionID != 0 {
		// The Release is blocklisted: look for the next best one at once.
		if err := s.library.RequestSearch(ctx, g.VersionID); err != nil {
			return nil, err
		}
		s.jobs.Kick(jobs.Search)
	}
	return oapi.CancelGrab204Response{}, nil
}
