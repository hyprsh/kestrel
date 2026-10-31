package api

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/api/oapi"
	downloadclient "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1"
)

// stuckRowPrefix starts the id of every Stuck download row; the rest is the Grab's id.
const stuckRowPrefix = "stuck-"

// stuckOf is the queue item's `stuck` field. It reads acquire.Active.Stalled
// (the one place that decides) and never recomputes it.
func stuckOf(a acquire.Active) *oapi.StuckDownload {
	st, ok := a.Stuck()
	if !ok {
		return nil
	}
	return &oapi.StuckDownload{Reason: oapi.StuckDownloadReason(st.Reason), Since: st.Since}
}

// stuckRows are the Stuck download rows of Needs attention: one Warning per
// Grab, built from the live queue. They are in-memory state, not health Issues,
// so a row goes the moment the download moves again, finishes or is cancelled.
func (s *server) stuckRows(ctx context.Context) ([]oapi.AttentionRow, error) {
	active, err := s.acquire.Active(ctx)
	if err != nil {
		return nil, err
	}
	type stuckGrab struct {
		acquire.Active
		why acquire.Stuck
	}
	var stuck []stuckGrab
	for _, a := range active {
		if st, ok := a.Stuck(); ok {
			stuck = append(stuck, stuckGrab{a, st})
		}
	}
	if len(stuck) == 0 {
		return nil, nil
	}
	titles, err := s.grabTitles(ctx)
	if err != nil {
		return nil, err
	}
	client := "the download client"
	if cs, err := s.plugins.Enabled(ctx, downloadclient.Contract.ID); err == nil && len(cs) > 0 {
		client = cs[0].Name
	}
	now := s.opts.Clock()
	rows := make([]oapi.AttentionRow, 0, len(stuck))
	for _, g := range stuck {
		a, st := g.Active, g.why
		about := titles.about(a.Grab)
		name := about.title
		if name == "" {
			name = a.ReleaseName
		}
		if len(about.episodes) > 0 {
			name += " " + strings.Join(about.episodes, ", ")
		}
		why := "Paused in " + client
		if st.Reason == acquire.StuckNoProgress {
			why = "No progress for " + durationText(now.Sub(st.Since))
		}
		rows = append(rows, oapi.AttentionRow{
			Id: stuckRowPrefix + strconv.FormatInt(a.ID, 10), Severity: oapi.AttentionRowSeverityWarning, Kind: "stuck_download",
			Message: fmt.Sprintf("Download of %s is stuck · %s", name, why), Since: st.Since, Count: 1,
			Subject: oapi.AttentionSubject{TitleId: idPtr(a.TitleID), VersionId: idPtr(a.VersionID), GrabId: idPtr(a.ID)},
			Actions: []oapi.AttentionAction{
				{
					Key: "search_again", Label: "Search Again", Method: oapi.POST, Path: fmt.Sprintf("/grabs/%d/cancel", a.ID),
					Body:    &map[string]any{"blocklist": true},
					Confirm: ptr("Cancel this download and blocklist the Release? The Version is searched again for the next best Release."),
				},
				{Key: "cancel", Label: "Cancel download", Method: oapi.POST, Path: fmt.Sprintf("/grabs/%d/cancel", a.ID), Confirm: ptr("Cancel this download? Its job and files leave the download client.")},
			},
		})
	}
	return rows, nil
}

// durationText spells a wait as "1 h 20 min", "20 min" or "under a minute".
func durationText(d time.Duration) string {
	m := int(d.Minutes())
	switch {
	case m >= 60 && m%60 > 0:
		return fmt.Sprintf("%d h %d min", m/60, m%60)
	case m >= 60:
		return fmt.Sprintf("%d h", m/60)
	case m >= 1:
		return fmt.Sprintf("%d min", m)
	}
	return "under a minute"
}
