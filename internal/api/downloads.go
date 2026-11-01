package api

import (
	"context"
	"errors"
	"sort"
	"time"

	"github.com/hyprsh/kestrel/internal/api/db"
	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/plugin"
	downloadclient "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1"
	indexer "github.com/hyprsh/kestrel/internal/plugin/indexer/v1"
	"github.com/hyprsh/kestrel/internal/plugin/instances"
	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring"
)

// grabsWindow is how far back an indexer's Grabs count in Settings, Downloads.
const grabsWindow = 30 * 24 * time.Hour

func (s *server) GetDownloadsStatus(ctx context.Context, _ oapi.GetDownloadsStatusRequestObject) (oapi.GetDownloadsStatusResponseObject, error) {
	now := s.opts.Clock()
	out := oapi.DownloadsStatus{Indexers: []oapi.IndexerGrabs{}}

	clients, err := s.plugins.Enabled(ctx, downloadclient.Contract.ID)
	if err != nil {
		return nil, err
	}
	if len(clients) > 0 {
		live := s.liveClient(ctx, clients[0], now)
		out.DownloadClient = &live
	}

	all, err := s.plugins.List(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := db.New(s.opts.Store.Read()).CountGrabsByIndexerSince(ctx, now.Add(-grabsWindow).UTC().Format(time.RFC3339))
	if err != nil {
		return nil, err
	}
	grabs := map[int64]int{}
	for _, r := range rows {
		grabs[r.IndexerID] = int(r.Grabs)
	}
	for _, inst := range all {
		if inst.Contract == indexer.Contract.ID {
			out.Indexers = append(out.Indexers, oapi.IndexerGrabs{InstanceId: inst.ID, Grabs30d: grabs[inst.ID]})
		}
	}
	return oapi.GetDownloadsStatus200JSONResponse(out), nil
}

// liveClient asks the download client for its status now. A failure is a status, not an error.
func (s *server) liveClient(ctx context.Context, inst instances.Instance, now time.Time) oapi.DownloadClientLive {
	live := oapi.DownloadClientLive{InstanceId: inst.ID, Name: inst.Name, CheckedAt: now.UTC(), State: oapi.DownloadClientLiveStateOk}
	fail := func(err error) oapi.DownloadClientLive {
		msg := plugin.AsError(err).Message
		live.State, live.Message = oapi.DownloadClientLiveStateFailing, &msg
		return live
	}
	p, conn, err := s.plugins.Resolve(ctx, inst.PluginID, inst.ID, nil, true)
	if err != nil {
		return fail(err)
	}
	reporter, ok := p.(downloadclient.StatusReporter)
	if !ok {
		// No live figures: its Test gives the state and version, and records the check.
		res, err := s.plugins.Test(ctx, p, conn, true)
		if err != nil {
			return fail(err)
		}
		s.observeCheck(ctx, downloadclient.Contract.ID, inst.ID, nil)
		if res.Version != "" {
			live.Version = &res.Version
		}
		return live
	}
	cctx, cancel := context.WithTimeout(ctx, instances.CallTimeout)
	defer cancel()
	st, err := reporter.Status(cctx, conn)
	if err != nil && cctx.Err() != nil && errors.Is(err, cctx.Err()) {
		err = plugin.Errorf(plugin.CodeUnavailable, "the plugin did not answer in time")
	}
	s.plugins.Observe(ctx, inst.ID, err)
	if err != nil {
		return fail(err)
	}
	s.observeCheck(ctx, downloadclient.Contract.ID, inst.ID, nil)
	if st.Version != "" {
		live.Version = &st.Version
	}
	live.Downloading, live.Queued, live.FreeBytes = &st.Downloading, &st.Queued, st.FreeBytes
	if st.BytesPerSecond > 0 {
		live.BytesPerSecond = &st.BytesPerSecond
	}
	return live
}

func (s *server) ListProfileDetails(ctx context.Context, _ oapi.ListProfileDetailsRequestObject) (oapi.ListProfileDetailsResponseObject, error) {
	all, err := s.profiles.List(ctx)
	if err != nil {
		return nil, err
	}
	region, _, err := s.profiles.Region(ctx)
	if err != nil {
		return nil, err
	}
	usage, err := db.New(s.opts.Store.Read()).ProfileUsage(ctx)
	if err != nil {
		return nil, err
	}
	used := map[string]db.ProfileUsageRow{}
	for _, u := range usage {
		used[u.ProfileKey] = u
	}
	snap := s.scoring.Current()
	out := oapi.ProfileDetailList{Items: make([]oapi.ProfileDetail, len(all))}
	for i, p := range all {
		d := oapi.ProfileDetail{Key: p.Key, Titles: int(used[p.Key].Titles), Files: int(used[p.Key].Files)}
		var resolved *scoring.Profile
		if snap != nil {
			resolved, _ = snap.Profile(p.Spec(region.Primary.Release())) // unresolvable: empty, not an error
		}
		d.Movies = profileScoring(resolved, release.KindMovie)
		d.Series = profileScoring(resolved, release.KindSeries)
		out.Items[i] = d
	}
	return oapi.ListProfileDetails200JSONResponse(out), nil
}

// profileScoring is what a resolved Profile does for a kind; nil (no snapshot, or none that fits) is empty.
func profileScoring(p *scoring.Profile, kind release.Kind) oapi.ProfileScoring {
	out := oapi.ProfileScoring{Qualities: []string{}, CustomFormats: []oapi.ProfileCustomFormat{}}
	if p == nil {
		return out
	}
	out.Qualities = append(out.Qualities, p.AllowedQualities(kind)...)
	out.MinScore = p.MinScore(kind)
	for _, f := range p.Formats(kind) {
		out.CustomFormats = append(out.CustomFormats, oapi.ProfileCustomFormat{Name: f.Name, Score: f.Score})
	}
	sort.SliceStable(out.CustomFormats, func(i, j int) bool {
		a, b := out.CustomFormats[i], out.CustomFormats[j]
		if a.Score != b.Score {
			return a.Score > b.Score
		}
		return a.Name < b.Name
	})
	return out
}
