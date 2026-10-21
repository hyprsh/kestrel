package api_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/app"
	"github.com/hyprsh/kestrel/internal/probe"
)

// heldProber probes like pathProber but holds a file whose path says "held"
// until release is closed, so a scan or commit stays running.
type heldProber struct{ release chan struct{} }

func (p heldProber) Probe(ctx context.Context, path string) (probe.Info, error) {
	if strings.Contains(path, "held") {
		select {
		case <-p.release:
		case <-ctx.Done():
			return probe.Info{}, ctx.Err()
		}
	}
	return pathProber{}.Probe(ctx, path)
}

type activityJSON struct {
	Running  []string `json:"running"`
	Adoption *struct {
		State string `json:"state"`
		Done  int    `json:"done"`
		Total int    `json:"total"`
	} `json:"adoption"`
}

// activity waits for an `activity` snapshot satisfying ok.
func (s *sseStream) activity(what string, ok func(activityJSON) bool) {
	s.t.Helper()
	s.until("activity snapshot: "+what, func(e sseEvent) bool {
		var a activityJSON
		return e.Name == "activity" && json.Unmarshal([]byte(e.Data), &a) == nil && ok(a)
	})
}

func TestTheActivityStreamCarriesAnAdoptionScanAndItsProgress(t *testing.T) {
	t.Parallel()
	release := make(chan struct{})
	a := newAdopting(t, fastStream, func(o *app.Options) { o.Prober = heldProber{release} })
	a.put(t, "Paddington.2014.1080p.BluRay.x264-GRP/Paddington.2014.1080p.BluRay.x264-GRP.mkv", "pad")
	a.put(t, "The Lost Film (2020) [tmdbid-77]/held.mkv", "lost")
	st := a.stream(t)
	st.activity("nothing adopting", func(s activityJSON) bool { return s.Adoption == nil })

	if r := a.valid("POST", "/adoption/scan", ""); r.Status != 202 {
		t.Fatalf("scan = %d %s", r.Status, r.Body)
	}

	st.activity("scanning 1 of 2", func(s activityJSON) bool {
		return s.Adoption != nil && s.Adoption.State == "scanning" && s.Adoption.Done == 1 && s.Adoption.Total == 2
	})
	st.mark()
	close(release)
	st.activity("the scan done", func(s activityJSON) bool { return s.Adoption == nil })
}
