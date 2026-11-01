package api

import (
	"context"
	"time"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/library"
	downloadclient "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1"
	"github.com/hyprsh/kestrel/internal/stats"
)

// GetStats is the Overview's dashboard: what the database knows (internal/stats) with the Wanted counts, the
// time to fill, the download client's name and the Root folders' disks joined in.
func (s *server) GetStats(ctx context.Context, r oapi.GetStatsRequestObject) (oapi.GetStatsResponseObject, error) {
	rng := stats.DefaultRange
	if r.Params.Range != nil {
		var ok bool
		if rng, ok = stats.ParseRange(string(*r.Params.Range)); !ok {
			return nil, invalid("range", "invalid", "range must be 7d, 30d or 90d")
		}
	}
	view, err := s.view(ctx)
	if err != nil {
		return nil, err
	}
	now := s.opts.Clock()
	disks, err := s.rootDisks(ctx)
	if err != nil {
		return nil, err
	}
	res, err := stats.New(s.opts.Store).Compute(ctx, now, rng, disks)
	if err != nil {
		return nil, err
	}
	rows, err := s.library.List(ctx, view, library.Filter{})
	if err != nil {
		return nil, err
	}
	var wanted, long int
	for _, row := range rows {
		for _, sl := range row.Slots {
			if sl != nil && sl.State == library.Wanted {
				wanted++
				if sl.LongMissing {
					long++
				}
			}
		}
	}
	fills, err := s.library.FillTimes(ctx, view, res.Window.From, res.Window.To)
	if err != nil {
		return nil, err
	}
	prev, err := s.library.FillTimes(ctx, view, res.Window.PrevFrom, res.Window.PrevTo)
	if err != nil {
		return nil, err
	}
	client, err := s.statsClient(ctx, res.Client)
	if err != nil {
		return nil, err
	}

	out := oapi.Stats{
		Range: oapi.StatsRange(rng.Key), From: openapi_types.Date{Time: res.Window.From}, To: openapi_types.Date{Time: res.Window.To.AddDate(0, 0, -1)},
		Library:        oapi.StatsLibrary{Titles: res.Library.Titles, Movies: res.Library.Movies, Series: res.Library.Series, Bytes: res.Library.Bytes},
		Wanted:         oapi.StatsWanted{Count: wanted, LongMissing: long},
		TimeToFill:     oapi.StatsTimeToFill{MedianSeconds: seconds(medianFill(fills)), PreviousMedianSeconds: seconds(medianFill(prev)), Fills: len(fills)},
		Indexers:       make([]oapi.StatsIndexer, 0, len(res.Indexers)),
		DownloadClient: client,
		Quality:        make([]oapi.StatsQuality, 0, len(res.Quality)),
		ReleaseGroups:  make([]oapi.StatsReleaseGroup, 0, len(res.Groups)),
	}
	out.Grabs.Imported, out.Grabs.Failed = res.Imported, res.Failed
	out.Grabs.PerDay = make([]oapi.StatsGrabDay, 0, len(res.Days))
	for _, d := range res.Days {
		out.Grabs.PerDay = append(out.Grabs.PerDay, oapi.StatsGrabDay{Day: openapi_types.Date{Time: d.Day}, Imported: d.Imported, Failed: d.Failed})
	}
	for i, ix := range res.Indexers {
		out.Indexers = append(out.Indexers, oapi.StatsIndexer{
			Id: ix.ID, Name: ix.Name, Imported: ix.Imported, Failed: ix.Failed, Searches: ix.Searches, HitRate: ix.HitRate, MedianAnswerMs: millis(ix.MedianAnswer),
		})
		if i == res.Best {
			id := ix.ID
			out.BestIndexerId = &id
		}
	}
	for _, q := range res.Quality {
		out.Quality = append(out.Quality, oapi.StatsQuality{Slot: oapi.Slot(q.Slot), Files: q.Files, RemuxBluray: q.RemuxBluray, WebDl: q.WebDL, WebripOrLower: q.WebRipLow})
	}
	for _, g := range res.Groups {
		out.ReleaseGroups = append(out.ReleaseGroups, oapi.StatsReleaseGroup{Name: g.Name, Files: g.Files})
	}
	out.Requests = oapi.StatsRequests{Total: res.Requests.Total, Searching: res.Requests.Searching, MedianFulfilSeconds: seconds(res.Requests.MedianFulfil), Requesters: make([]oapi.StatsRequester, 0, len(res.Requests.Requesters))}
	for _, rq := range res.Requests.Requesters {
		out.Requests.Requesters = append(out.Requests.Requesters, oapi.StatsRequester{Name: rq.Name, Source: stats.TitleCase(rq.Source), Requests: rq.Requests, Done: rq.Done})
	}
	st := res.Storage
	out.Storage = oapi.StatsStorage{
		Disks: make([]oapi.StatsDisk, 0, len(st.Disks)), FreeBytes: st.Free, TotalBytes: st.Total,
		GrowthBytesPerWeek: st.GrowthBytesPerWeek, SeriesShare: st.SeriesShare, MonthsUntilFull: st.MonthsUntilFull,
	}
	for _, d := range st.Disks {
		out.Storage.Disks = append(out.Storage.Disks, oapi.StatsDisk{Path: d.Path, FreeBytes: d.Free, TotalBytes: d.Total})
	}
	return oapi.GetStats200JSONResponse(out), nil
}

// rootDisks are the disks of the Root folders (not the data mount), Movies first.
func (s *server) rootDisks(ctx context.Context) ([]stats.Disk, error) {
	roots, _, err := s.rootFolders.Get(ctx)
	if err != nil {
		return nil, err
	}
	all, err := s.health.Disks(ctx)
	if err != nil {
		return nil, err
	}
	var out []stats.Disk
	for _, p := range append(append([]string{}, roots.Movies...), roots.Series...) {
		for _, d := range all {
			if d.Path == p {
				out = append(out, stats.Disk{Path: d.Path, Free: int64(d.Free), Total: int64(d.Total)})
				break
			}
		}
	}
	return out, nil
}

// statsClient is the download client's name and state with what the database knows of its work.
func (s *server) statsClient(ctx context.Context, c stats.Client) (oapi.StatsDownloadClient, error) {
	out := oapi.StatsDownloadClient{
		State: oapi.StatsDownloadClientState("none"), Completed: c.Completed, Failed: c.Failed, AvgBytesPerSecond: c.AvgBytesPerSecond,
		MedianDownloadSeconds: seconds(c.MedianDownload), SpeedPerDay: make([]oapi.StatsSpeedDay, 0, len(c.SpeedPerDay)),
	}
	for _, d := range c.SpeedPerDay {
		out.SpeedPerDay = append(out.SpeedPerDay, oapi.StatsSpeedDay{Day: openapi_types.Date{Time: d.Day}, BytesPerSecond: d.BytesPerSecond})
	}
	// The speed now is the sum of what the client says for each active download.
	if active, err := s.acquire.Active(ctx); err == nil {
		var now int64
		for _, a := range active {
			if a.Phase == acquire.PhaseDownloading {
				now += a.BytesPerSecond
			}
		}
		if now > 0 {
			out.CurrentBytesPerSecond = &now
		}
	}
	clients, err := s.plugins.Enabled(ctx, downloadclient.Contract.ID)
	if err != nil {
		return out, err
	}
	if len(clients) > 0 {
		name := clients[0].Name
		out.Name, out.State = &name, oapi.StatsDownloadClientState("ok")
		if s.health.ClientState().Failing {
			out.State = oapi.StatsDownloadClientState("failing")
		}
	}
	return out, nil
}

func medianFill(fills []library.Fill) *time.Duration {
	ds := make([]time.Duration, len(fills))
	for i, f := range fills {
		ds[i] = f.Took
	}
	return stats.MedianDuration(ds)
}

func seconds(d *time.Duration) *int {
	if d == nil {
		return nil
	}
	n := int(d.Round(time.Second) / time.Second)
	return &n
}

func millis(d *time.Duration) *int64 {
	if d == nil {
		return nil
	}
	n := d.Milliseconds()
	return &n
}
