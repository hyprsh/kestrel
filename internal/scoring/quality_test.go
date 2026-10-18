package scoring_test

import (
	"reflect"
	"testing"

	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/resolution"
	"github.com/hyprsh/kestrel/internal/scoring"
)

// Against TRaSH's real hd-bluray-web profile, which allows WEB and Bluray
// 720p and 1080p and nothing else.
func TestQualityOutsideTheProfilesAllowedQualitiesIsRejected(t *testing.T) {
	snap := embedded(t)
	spec := func(slot resolution.Class, wide bool) scoring.ProfileSpec {
		return scoring.ProfileSpec{Slot: slot, Any: wide, Rule: scoring.PrimaryLanguage, Primary: release.LangEnglish}
	}
	cases := []struct {
		name    string
		profile scoring.ProfileSpec
		rel     string
		reject  bool
	}{
		{"HD allows WEB-DL 1080p", spec(resolution.HD, false), "A.Movie.2020.1080p.WEB-DL.DD5.1.H264-GRP", false},
		{"HD allows Bluray 720p", spec(resolution.HD, false), "A.Movie.2020.720p.BluRay.x264-GRP", false},
		{"HD rejects Remux 1080p", spec(resolution.HD, false), "A.Movie.2020.1080p.BluRay.REMUX.AVC.DTS-HD.MA.5.1-GRP", true},
		{"HD rejects HDTV 1080p", spec(resolution.HD, false), "A.Movie.2020.1080p.HDTV.x264-GRP", true},
		{"UHD allows WEB-DL 2160p", spec(resolution.UHD, false), "A.Movie.2020.2160p.WEB-DL.DD5.1.H265-GRP", false},
		{"UHD rejects Remux 2160p", spec(resolution.UHD, false), "A.Movie.2020.2160p.UHD.BluRay.REMUX.HEVC.TrueHD-GRP", true},
		{"SD allows DVD", spec(resolution.SD, false), "A.Movie.2020.DVDRip.x264-GRP", false},
		{"SD allows Bluray 576p", spec(resolution.SD, false), "A.Movie.2020.576p.BluRay.x264-GRP", false},
		{"SD rejects WEB-DL 1080p", spec(resolution.SD, false), "A.Movie.2020.1080p.WEB-DL.DD5.1.H264-GRP", true},
		{"Any allows DVD", spec(resolution.HD, true), "A.Movie.2020.DVDRip.x264-GRP", false},
		{"Any allows WEB-DL 1080p", spec(resolution.HD, true), "A.Movie.2020.1080p.WEB-DL.DD5.1.H264-GRP", false},
		{"Any rejects Remux 1080p", spec(resolution.HD, true), "A.Movie.2020.1080p.BluRay.REMUX.AVC.DTS-HD.MA.5.1-GRP", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			prof, err := snap.Profile(tc.profile)
			if err != nil {
				t.Fatal(err)
			}
			v := scoring.Evaluate(scoring.Release{Parsed: mustMovie(t, tc.rel)}, titleEN, prof)
			if got := v.Rejected(scoring.RejectQuality); got != tc.reject {
				t.Errorf("quality rejection = %v, want %v (quality %q, rejections %v)", got, tc.reject, v.Rejections, v.Rejections)
			}
		})
	}
}

func TestUnknownQualityIsNotAllowed(t *testing.T) {
	prof, err := embedded(t).Profile(englishHD)
	if err != nil {
		t.Fatal(err)
	}
	rel := scoring.Release{Parsed: mustMovie(t, "A.Movie.2020.1080p.WEB-DL.DD5.1.H264-GRP")}
	rel.Parsed.Quality.Quality = release.Quality{} // Unknown
	v := scoring.Evaluate(rel, titleEN, prof)
	if !v.Rejected(scoring.RejectQuality) {
		t.Errorf("rejections = %v, want quality among them", v.Rejections)
	}
}

func TestQualityRejectionComesAfterResolutionAndBeforeLanguage(t *testing.T) {
	prof, err := embedded(t).Profile(scoring.ProfileSpec{Slot: resolution.HD, Rule: scoring.PrimaryLanguage, Primary: release.LangGerman})
	if err != nil {
		t.Fatal(err)
	}
	// English-only Remux 2160p: wrong class, wrong quality, wrong language.
	v := scoring.Evaluate(scoring.Release{Parsed: mustMovie(t, "A.Movie.2020.2160p.UHD.BluRay.REMUX.HEVC.TrueHD-GRP")}, titleEN, prof)
	want := []scoring.Rejection{scoring.RejectResolution, scoring.RejectQuality, scoring.RejectLanguage}
	if got := v.Rejections; len(got) < 3 || !reflect.DeepEqual(got[:3], want) {
		t.Errorf("rejections = %v, want them to start with %v", got, want)
	}
}

func TestSeriesQualityUsesSonarrsNames(t *testing.T) {
	prof, err := embedded(t).Profile(englishHD)
	if err != nil {
		t.Fatal(err)
	}
	webdl, _ := release.Parse("Show.S01E01.1080p.WEB-DL.DD5.1.H.264-GRP", release.KindSeries)
	remux, _ := release.Parse("Show.S01E01.1080p.BluRay.REMUX.AVC.DTS-HD.MA.5.1-GRP", release.KindSeries)
	if v := scoring.Evaluate(scoring.Release{Parsed: webdl}, titleEN, prof); v.Rejected(scoring.RejectQuality) {
		t.Errorf("WEB-DL 1080p rejected for quality: %v", v.Rejections)
	}
	if v := scoring.Evaluate(scoring.Release{Parsed: remux}, titleEN, prof); !v.Rejected(scoring.RejectQuality) {
		t.Errorf("Bluray-1080p Remux accepted by web-1080p: %v", v.Rejections)
	}
}
