package imports_test

import (
	"context"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/imports"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/probe"
	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
	"github.com/hyprsh/kestrel/internal/settings"
	"github.com/hyprsh/kestrel/internal/slot"
)

// offerOriginals makes the household German and hd-primary offer English-only
// Releases of the English-original Titles instead of rejecting them.
func offerOriginals(t *testing.T, r *rig) {
	t.Helper()
	ctx := context.Background()
	ps := profiles.New(r.st, settings.New(r.st))
	de := profiles.German
	if _, err := ps.SetRegion(ctx, profiles.RegionPatch{Primary: &de}); err != nil {
		t.Fatal(err)
	}
	offer := scoring.OriginalOffer
	if _, err := ps.Patch(ctx, "hd-primary", profiles.Patch{OriginalLanguage: &offer}); err != nil {
		t.Fatal(err)
	}
}

func german() probe.Info {
	info := good()
	info.Audio = []probe.AudioTrack{{Index: 1, Codec: "eac3", Channels: 6, Language: "deu", Default: true}}
	return info
}

func TestAnOriginalOnlyFileIsRejectedUnlessTheGrabWasAccepted(t *testing.T) {
	r := newRig(t)
	offerOriginals(t, r)
	g := r.job(t, 1, map[string]string{"paddington.mkv": "video"})
	r.prober.info["paddington.mkv"] = good() // English audio only

	if res := r.svc.Import(context.Background(), g); res.Status != imports.Rejected || res.Reason != imports.ReasonLanguage {
		t.Fatalf("not accepted: result = %+v", res)
	}

	g.Overridden = true // Accept, or Grab anyway
	res := r.svc.Import(context.Background(), g)
	if res.Status != imports.Imported {
		t.Fatalf("accepted: result = %+v", res)
	}
	v := r.version(t)
	if v.State != library.Filled || v.File == nil || !v.File.Original {
		t.Errorf("version = %+v, file %+v: want filled by an Original", v, v.File)
	}
}

func TestAPrimaryLanguageFileReplacesAnOriginalWhateverItsScore(t *testing.T) {
	r := newRig(t)
	offerOriginals(t, r)
	r.held(t, "old.mkv", 100000)
	files, _ := r.lib.FilesOfVersion(context.Background(), r.versions[slot.Standard])
	if err := r.lib.ApplyRescore(context.Background(), []library.Rescored{{FileID: files[0].ID, Score: 100000, Original: true}}); err != nil {
		t.Fatal(err)
	}
	g := r.job(t, 2, map[string]string{"paddington.mkv": "video"})
	r.prober.info["paddington.mkv"] = german()

	res := r.svc.Import(context.Background(), g)

	if res.Status != imports.Imported {
		t.Fatalf("result = %+v", res)
	}
	if v := r.version(t); v.File == nil || v.File.Original || v.File.Path != res.Path {
		t.Errorf("file = %+v, want the German one", v.File)
	}
}

func TestAnAcceptedOriginalEpisodeFillsItsCell(t *testing.T) {
	s := newSeriesRig(t)
	offerOriginals(t, s.rig)
	g := s.download(t, "Night.Show.S01E01.1080p.WEB-DL.H264-GRP", 1, []string{"show.mkv"})
	g.Overridden = true

	res := s.svc.Import(context.Background(), g)

	if e := resultOf(t, res, 1, 1); e.Status != imports.Imported {
		t.Fatalf("result = %+v", res)
	}
	c := s.episodes(t)[0].Cells[slot.Standard]
	if c.State != library.Filled || c.File == nil || !c.File.Original {
		t.Errorf("cell = %+v (file %+v)", c, c.File)
	}

	// A German file of the same episode replaces it, though it scores lower.
	if err := s.lib.ApplyRescore(context.Background(), []library.Rescored{{FileID: c.File.ID, Score: 100000, Original: true}}); err != nil {
		t.Fatal(err)
	}
	g2 := s.download(t, "Night.Show.S01E01.GERMAN.1080p.WEB-DL.H264-GRP", 2, []string{"show.de.mkv"})
	info := german()
	info.Duration = 44 * time.Minute
	s.prober.info["show.de.mkv"] = info
	res = s.svc.Import(context.Background(), g2)
	if e := resultOf(t, res, 1, 1); e.Status != imports.Imported {
		t.Fatalf("German: result = %+v", res)
	}
	if c := s.episodes(t)[0].Cells[slot.Standard]; c.File == nil || c.File.Original {
		t.Errorf("cell file = %+v, want the German one", c.File)
	}
}
