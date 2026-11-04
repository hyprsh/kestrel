package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/release"
)

// GetGrabSteps tells what happened to a Grab, for the Activity screen's opened row. It reads the Grab's own events
// (grabbed, download started and finished, what the Import wrote), the Blocklist and the Title's Wanted state.
func (s *server) GetGrabSteps(ctx context.Context, r oapi.GetGrabStepsRequestObject) (oapi.GetGrabStepsResponseObject, error) {
	g, err := s.acquire.GetGrab(ctx, r.Id)
	if errors.Is(err, acquire.ErrGrabNotFound) {
		return nil, problem(http.StatusNotFound, "not_found", "no such Grab")
	}
	if err != nil {
		return nil, err
	}
	events, err := s.history.List(ctx, history.Filter{GrabID: g.ID, Routine: true, Limit: 1000})
	if err != nil {
		return nil, err
	}
	out := oapi.GrabSteps{GrabId: g.ID, GrabbedAt: g.CreatedAt, Files: []oapi.GrabStepFile{}, Formats: []oapi.CustomFormatMatch{}, Replaced: g.ImportReplaced,
		// The Grab keeps its download times; the routine events they were once read from are pruned after 30 days.
		DownloadStartedAt: g.DownloadStartedAt, DownloadFinishedAt: g.DownloadDoneAt}
	if w := g.Why; w != nil {
		out.Why = &oapi.GrabWhy{CoversWanted: w.CoversWanted, ReplacesFiles: w.ReplacesFiles, ScoreDelta: w.ScoreDelta}
	}
	if g.State == "imported" || g.State == "failed" {
		ended := g.UpdatedAt
		out.EndedAt = &ended
	}
	// The Log lists newest first; the steps read oldest first, so the first of each kind wins.
	slices.Reverse(events)
	for _, ev := range events {
		at := ev.At
		switch ev.Kind {
		case history.GrabSent:
			var d struct{ By string }
			if json.Unmarshal([]byte(strings.ToLower(string(ev.Data))), &d) == nil && d.By != "" {
				by := oapi.GrabStepsGrabbedBy(d.By)
				out.GrabbedBy = &by
			}
		case history.GrabDownloading:
			if out.DownloadStartedAt == nil {
				out.DownloadStartedAt = &at
			}
		case history.GrabCompleted:
			if out.DownloadFinishedAt == nil {
				out.DownloadFinishedAt = &at
			}
		case history.ImportDone:
			var d struct {
				Path string `json:"path"`
			}
			_ = json.Unmarshal(ev.Data, &d)
			if d.Path == "" {
				// Before the path rode in the payload, only the message had it: "Imported <release> as <path>".
				if _, p, ok := strings.Cut(ev.Message, " as "); ok {
					d.Path = strings.TrimSuffix(p, " (probe inconclusive: the parsed languages stand)")
				}
			}
			if d.Path != "" {
				out.Files = append(out.Files, oapi.GrabStepFile{Path: d.Path})
			}
		case history.ImportEpisode:
			var d struct {
				Season, Episode int
				Status          string
				Path            string
			}
			if json.Unmarshal([]byte(strings.ToLower(string(ev.Data))), &d) == nil && d.Status == string(acquire.ImportDone) && d.Path != "" {
				code := fmt.Sprintf("S%02dE%02d", d.Season, d.Episode)
				out.Files = append(out.Files, oapi.GrabStepFile{Episode: &code, Path: d.Path})
			}
		}
	}
	// A Series Import records the episodes it wrote; the Grab-level event then repeats a path of one of them.
	if slices.ContainsFunc(out.Files, func(f oapi.GrabStepFile) bool { return f.Episode != nil }) {
		out.Files = slices.DeleteFunc(out.Files, func(f oapi.GrabStepFile) bool { return f.Episode == nil })
	}
	formats, err := s.acquire.GrabFormats(ctx, g.ID)
	if err != nil {
		return nil, err
	}
	out.Formats = formatsToAPI(formats)
	if g.TitleID != 0 {
		blocked, err := s.acquire.Blocklist(ctx, g.TitleID)
		if err != nil {
			return nil, err
		}
		for _, b := range blocked {
			if b.GrabID == g.ID {
				id := b.ID
				out.BlocklistId = &id
				break
			}
		}
	}
	titles, err := s.grabTitles(ctx)
	if err != nil {
		return nil, err
	}
	about := titles.about(g)
	kind := release.KindMovie
	if about.kind != nil && *about.kind == oapi.TitleKind(library.Series) {
		kind = release.KindSeries
	}
	parsedGrabFacts(&out, g.ReleaseName, kind)
	if out.StillWanted, err = s.grabStillWanted(ctx, g, titles, about); err != nil {
		return nil, err
	}
	return oapi.GetGrabSteps200JSONResponse(out), nil
}

// parsedGrabFacts fills the Grab's quality, video, audio and group from its release name, read now rather than
// stored, so a Grab from before these were shown has them too.
func parsedGrabFacts(out *oapi.GrabSteps, name string, kind release.Kind) {
	if q := release.ParseQualityOf(name, kind).Quality; q.ID != 0 {
		out.Quality = strPtr(q.Name)
	}
	video, hdr, audio, channels := release.ParseMedia(strings.TrimSpace(name))
	out.VideoCodec, out.Hdr, out.AudioCodec, out.AudioChannels = strPtr(video), strPtr(hdr), strPtr(audio), strPtr(channels)
	out.ReleaseGroup = strPtr(release.ParseReleaseGroup(name))
}

// grabStillWanted reports whether what the Grab was for is Wanted: the Movie's Version, or any episode it covered
// in its Slot.
func (s *server) grabStillWanted(ctx context.Context, g acquire.Grab, titles *grabTitles, about grabAbout) (bool, error) {
	if about.version == nil {
		return false, nil
	}
	if about.kind == nil || *about.kind != oapi.TitleKind(library.Movie) {
		ids, err := s.acquire.GrabEpisodes(ctx, g.ID)
		if err != nil {
			return false, err
		}
		eps, err := s.library.Episodes(ctx, g.TitleID, titles.view)
		if err != nil {
			return false, err
		}
		for _, e := range eps {
			if c := e.Cells[about.version.Slot]; c != nil && slices.Contains(ids, e.ID) && c.State == library.Wanted {
				return true, nil
			}
		}
		return false, nil
	}
	return about.version.State == library.Wanted, nil
}
