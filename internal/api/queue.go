package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"

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
	titles, err := s.grabTitles(ctx)
	if err != nil {
		return nil, err
	}
	out := oapi.QueueList{Items: make([]oapi.QueueItem, 0, len(active))}
	for _, a := range active {
		about := titles.about(a.Grab)
		it := oapi.QueueItem{
			GrabId: a.ID, TitleId: idPtr(a.TitleID), VersionId: idPtr(a.VersionID), ReleaseName: a.ReleaseName, Phase: oapi.QueueItemPhase(a.Phase),
			PhaseSince: a.Since, BytesTotal: a.BytesTotal, BytesLeft: a.BytesLeft, IsUpgrade: a.IsUpgrade,
			Indexer: a.IndexerName, Size: a.Size, Score: a.Score, GrabbedAt: a.CreatedAt,
			Stuck: stuckOf(a),
			Title: about.title, HasPoster: about.hasPoster, Year: about.year, Kind: about.kind, Slot: about.slot, Episodes: about.episodes,
		}
		if a.ETA > 0 {
			secs := int(a.ETA.Seconds())
			it.Eta = &secs
		}
		if v := about.version; a.IsUpgrade && v != nil && v.File != nil && v.File.Score != nil {
			delta := a.Score - *v.File.Score
			it.ScoreDelta = &delta
		}
		out.Items = append(out.Items, it)
	}
	return oapi.ListQueue200JSONResponse(out), nil
}

// grabTitles looks up the Titles of a list of Grabs, each once per request.
type grabTitles struct {
	s      *server
	ctx    context.Context
	view   library.View
	titles map[int64]*library.Detail
}

func (s *server) grabTitles(ctx context.Context) (*grabTitles, error) {
	view, err := s.view(ctx)
	if err != nil {
		return nil, err
	}
	return &grabTitles{s: s, ctx: ctx, view: view, titles: map[int64]*library.Detail{}}, nil
}

// grabAbout is what a Grab's row shows of its Title; empty when the Title was deleted.
type grabAbout struct {
	title     string
	hasPoster bool
	year      *int
	kind      *oapi.TitleKind
	slot      *oapi.Slot
	episodes  []string
	// version is the Grab's Version, nil when it is gone.
	version *library.Version
}

func (c *grabTitles) detail(id int64) *library.Detail {
	if id == 0 {
		return nil
	}
	if d, ok := c.titles[id]; ok {
		return d
	}
	d, err := c.s.library.Get(c.ctx, id, c.view)
	if err != nil {
		c.titles[id] = nil
		return nil
	}
	c.titles[id] = &d
	return &d
}

func (c *grabTitles) about(g acquire.Grab) grabAbout {
	out := grabAbout{episodes: []string{}}
	d := c.detail(g.TitleID)
	if d == nil {
		return out
	}
	kind := oapi.TitleKind(d.Kind)
	out.title, out.hasPoster, out.year, out.kind = d.Title, d.PosterPath != "", intPtr(d.Year), &kind
	if d.Kind == library.Series {
		if labels, err := c.s.episodeLabels(c.ctx, g.ID, g.TitleID, c.view); err == nil {
			out.episodes = labels
		}
	}
	for i, v := range d.Versions {
		if v.ID == g.VersionID {
			slot := slotToAPI(v.Slot)
			out.slot, out.version = &slot, &d.Versions[i]
		}
	}
	return out
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
	if blocklist {
		s.jobs.Kick(jobs.Poll) // the retry may have grabbed the next best Release
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

// episodeLabels names the episodes a Series Grab fetches, such as "S01E01-E08"
// for a run and "S02E03" for one.
func (s *server) episodeLabels(ctx context.Context, grabID, titleID int64, view library.View) ([]string, error) {
	ids, err := s.acquire.GrabEpisodes(ctx, grabID)
	if err != nil || len(ids) == 0 {
		return []string{}, err
	}
	eps, err := s.library.Episodes(ctx, titleID, view)
	if err != nil {
		return nil, err
	}
	var out []string
	for i := 0; i < len(eps); {
		if !slices.Contains(ids, eps[i].ID) {
			i++
			continue
		}
		j := i
		for j+1 < len(eps) && eps[j+1].Season == eps[i].Season && slices.Contains(ids, eps[j+1].ID) {
			j++
		}
		label := fmt.Sprintf("S%02dE%02d", eps[i].Season, eps[i].Number)
		if j > i {
			label += fmt.Sprintf("-E%02d", eps[j].Number)
		}
		out = append(out, label)
		i = j + 1
	}
	return out, nil
}
