package acquire_test

import (
	"context"
	"slices"
	"testing"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/scoring"
)

func TestASeriesSearchRejectsAnotherShowsReleasesAndKeepsTheRightOnes(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	_, ver := r.nightShow(t, library.MonitorAll)
	const (
		aliasOnly = "The.Night.Show.S01E01.1080p.WEB-DL.H264-GRP"
		aliasYear = "The.Night.Show.2026.S01E01.1080p.WEB-DL.H264-GRP"
		aliasEp   = "The.Night.Show.S01E02.Midnight.1080p.WEB-DL.H264-GRP"
		wrongEp   = "Night.Show.S01E01.Another.Story.Entirely.1080p.WEB-DL.H264-GRP"
		plain     = "Night.Show.S01E01.1080p.WEB-DL.H264-GRP"
		sameEp    = "Night.Show.S01E02.MIDNIGHT.1080p.WEB-DL.H264-GRP"
	)
	for _, name := range []string{aliasOnly, aliasYear, aliasEp, wrongEp, plain, sameEp} {
		r.publishTV(t, name)
	}

	res, err := r.svc.Search(ctx, ver)
	if err != nil {
		t.Fatal(err)
	}

	for name, want := range map[string][]scoring.Rejection{
		aliasOnly: {acquire.RejectAliasOnly},
		aliasYear: nil,
		aliasEp:   nil,
		wrongEp:   {acquire.RejectEpisodeTitle},
		plain:     nil,
		sameEp:    nil,
	} {
		f := r.found(t, res, name)
		if got := codes(f); !slices.Equal(got, want) {
			t.Errorf("%s: rejections = %v, want %v", name, got, want)
		}
		for _, rj := range f.Rejections {
			if !rj.Overridable {
				t.Errorf("%s: %s is not overridable", name, rj.Code)
			}
		}
	}
}

func TestAnIDHitNamingAYearOutsideTheSeriesRunIsRejected(t *testing.T) {
	r := newRig(t)
	_, ver := r.nightShow(t, library.MonitorAll)
	const old = "Night.Show.1981.S01E01.1080p.WEB-DL.H264-GRP"
	r.publishShow(t, old, "1", "1")

	res, err := r.svc.Search(context.Background(), ver)
	if err != nil {
		t.Fatal(err)
	}

	if got := codes(r.found(t, res, old)); !slices.Equal(got, []scoring.Rejection{acquire.RejectYearOutsideRun}) {
		t.Errorf("rejections = %v", got)
	}
}
