package imports_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/imports"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/probe"
	"github.com/hyprsh/kestrel/internal/release"
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
	if _, err := ps.Patch(ctx, "hd-primary", profiles.Patch{OriginalChoice: &offer}); err != nil {
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

func TestARescoreMakesAnOriginalOnlyFileAMisfitUnlessItIsAlreadyAnOriginal(t *testing.T) {
	for _, original := range []bool{false, true} {
		ctx := context.Background()
		r := newRig(t)
		offerOriginals(t, r)
		parsed, err := release.Parse("Paddington.2014.1080p.BluRay.x264-GRP", release.KindMovie)
		if err != nil {
			t.Fatal(err)
		}
		pj, _ := json.Marshal(parsed)
		ij, _ := json.Marshal(good()) // English audio only
		if _, err := r.lib.ReplaceFile(ctx, r.titleID, movieFolder, library.NewFile{
			VersionID: r.versions[slot.Standard], Path: "/m/p.mkv", Size: 1, ReleaseName: "Paddington.2014.1080p.BluRay.x264-GRP",
			ParsedRelease: string(pj), Probe: string(ij), Score: 10, Original: original,
		}); err != nil {
			t.Fatal(err)
		}
		snap, err := scoring.Embedded()
		if err != nil {
			t.Fatal(err)
		}

		if err := r.svc.RescoreTitles(ctx, snap, []int64{r.titleID}); err != nil {
			t.Fatal(err)
		}

		v := r.version(t)
		switch {
		case original && (v.State != library.Filled || !v.File.Original || v.File.Misfit):
			t.Errorf("an accepted Original: version %+v, file %+v; want it kept, filling the Version", v, v.File)
		case !original && (v.State == library.Filled || v.File.Original || !v.File.Misfit):
			t.Errorf("an adopted file: version %+v, file %+v; want a misfit that fills nothing", v, v.File)
		}
	}
}
