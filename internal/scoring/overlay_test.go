package scoring_test

import (
	"slices"
	"testing"

	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring"
)

const gb = int64(1) << 30

func withOverlay(o *scoring.Overlay) scoring.ProfileSpec {
	spec := englishHD
	spec.Overlay = o
	return spec
}

func profileOf(t testing.TB, spec scoring.ProfileSpec) *scoring.Profile {
	t.Helper()
	p, err := embedded(t).Profile(spec)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func series(t testing.TB, name string) release.ParsedRelease {
	t.Helper()
	p, err := release.Parse(name, release.KindSeries)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestSizeLimitRejectsAMovieOutsideItAndOnlyThen(t *testing.T) {
	p := profileOf(t, withOverlay(&scoring.Overlay{MovieSize: scoring.SizeLimit{Min: 2 * gb, Max: 10 * gb}}))
	parsed := mustMovie(t, "A.Movie.2020.1080p.WEB-DL.DD5.1.H264-GRP")
	for _, c := range []struct {
		size int64
		want bool
	}{{gb, true}, {2 * gb, false}, {6 * gb, false}, {10 * gb, false}, {11 * gb, true}, {0, false}} {
		v := scoring.Evaluate(scoring.Release{Parsed: parsed, Size: c.size}, originalEnglish, p)
		if got := v.Rejected(scoring.RejectSize); got != c.want {
			t.Errorf("size %d: rejected = %v, want %v (%v)", c.size, got, c.want, v.Rejections)
		}
	}
}

func TestSizeLimitIsPerEpisodeForASeries(t *testing.T) {
	p := profileOf(t, withOverlay(&scoring.Overlay{EpisodeSize: scoring.SizeLimit{Min: 1 * gb, Max: 10 * gb}}))
	title := scoring.Title{Name: "Show", OriginalLanguage: release.LangEnglish, SeasonEpisodes: 8}
	eval := func(name string, size int64) scoring.Verdict {
		return scoring.Evaluate(scoring.Release{Parsed: series(t, name), Size: size}, title, p)
	}
	if v := eval("Show.S01E01.1080p.WEB-DL.DD5.1.H264-GRP", 6*gb); v.Rejected(scoring.RejectSize) {
		t.Errorf("a 6 GB episode is within 1 - 10 GB: %v", v.Rejections)
	}
	if v := eval("Show.S01E01.1080p.WEB-DL.DD5.1.H264-GRP", 12*gb); !v.Rejected(scoring.RejectSize) {
		t.Errorf("a 12 GB episode is over: %v", v.Rejections)
	}
	// Two episodes of 6 GB each in one 12 GB release: still 6 GB per episode.
	if v := eval("Show.S01E01E02.1080p.WEB-DL.DD5.1.H264-GRP", 12*gb); v.Rejected(scoring.RejectSize) {
		t.Errorf("12 GB for two episodes is 6 GB each: %v", v.Rejections)
	}
	// A season pack of 8 episodes: 40 GB is 5 GB each, 4 GB is 0.5 GB each.
	if v := eval("Show.S01.1080p.WEB-DL.DD5.1.H264-GRP", 40*gb); v.Rejected(scoring.RejectSize) {
		t.Errorf("40 GB for 8 episodes is 5 GB each: %v", v.Rejections)
	}
	if v := eval("Show.S01.1080p.WEB-DL.DD5.1.H264-GRP", 4*gb); !v.Rejected(scoring.RejectSize) {
		t.Errorf("4 GB for 8 episodes is under 1 GB each: %v", v.Rejections)
	}
	// A pack of a season the Library knows no episodes of cannot be judged.
	title.SeasonEpisodes = 0
	if v := eval("Show.S01.1080p.WEB-DL.DD5.1.H264-GRP", 4*gb); v.Rejected(scoring.RejectSize) {
		t.Errorf("a pack with an unknown episode count is not judged: %v", v.Rejections)
	}
}

func TestNoOverlayChangesNothing(t *testing.T) {
	plain := profileOf(t, englishHD)
	empty := profileOf(t, withOverlay(&scoring.Overlay{}))
	for _, kind := range []release.Kind{release.KindMovie, release.KindSeries} {
		if !slices.Equal(plain.AllowedQualities(kind), empty.AllowedQualities(kind)) || plain.MinScore(kind) != empty.MinScore(kind) {
			t.Errorf("%v: an empty overlay changed the qualities or the minimum Score", kind)
		}
		if plain.UpgradesLimited(kind) || plain.AtCutoff(kind, "WEBDL-1080p", 1_000_000) {
			t.Errorf("%v: a Profile with no cutoff never stops upgrading", kind)
		}
	}
}

func TestLadderOrderAcceptanceAndReset(t *testing.T) {
	base := profileOf(t, englishHD)
	ladder := base.Ladder(release.KindSeries)
	if len(ladder) < 4 {
		t.Fatalf("ladder = %v", ladder)
	}
	// Best first: resolution, then source.
	for i := 1; i < len(ladder); i++ {
		if ladder[i-1].Name == ladder[i].Name {
			t.Errorf("%s twice", ladder[i].Name)
		}
	}
	if !slices.Equal(base.TrashLadder(release.KindSeries), ladder) {
		t.Error("without an overlay the ladder is TRaSH's")
	}
	var accepted []string
	for _, q := range ladder {
		if q.Accepted {
			accepted = append(accepted, q.Name)
		}
	}
	if !slices.Equal(accepted, base.AllowedQualities(release.KindSeries)) {
		t.Errorf("accepted ladder %v != allowed %v", accepted, base.AllowedQualities(release.KindSeries))
	}

	// Put WEBDL-1080p first and stop taking Bluray-1080p.
	prefs := []scoring.QualityPref{{Name: "WEBDL-1080p", Accepted: true}, {Name: "Bluray-1080p", Accepted: false}}
	p := profileOf(t, withOverlay(&scoring.Overlay{Series: scoring.KindOverlay{Qualities: prefs}}))
	got := p.Ladder(release.KindSeries)
	if got[0].Name != "WEBDL-1080p" || got[1].Name != "Bluray-1080p" || got[1].Accepted {
		t.Errorf("overlay ladder starts %v", got[:3])
	}
	if len(got) != len(ladder) {
		t.Errorf("the qualities the overlay leaves out follow: %d, want %d", len(got), len(ladder))
	}
	if slices.Contains(p.AllowedQualities(release.KindSeries), "Bluray-1080p") || !slices.Contains(p.AllowedQualities(release.KindSeries), "WEBDL-1080p") {
		t.Errorf("allowed = %v", p.AllowedQualities(release.KindSeries))
	}
	if !slices.Equal(p.TrashLadder(release.KindSeries), ladder) {
		t.Error("TrashLadder ignores the overlay")
	}
	// The Movies side keeps TRaSH's.
	if !slices.Equal(p.Ladder(release.KindMovie), base.Ladder(release.KindMovie)) {
		t.Error("a Series overlay changed the Movie ladder")
	}

	// Scoring honours acceptance: a Bluray-1080p episode is now rejected for its quality.
	v := scoring.Evaluate(scoring.Release{Parsed: series(t, "Show.S01E01.1080p.BluRay.DD5.1.x264-GRP")}, scoring.Title{Name: "Show", OriginalLanguage: release.LangEnglish}, p)
	if !v.Rejected(scoring.RejectQuality) {
		t.Errorf("Bluray-1080p was unticked: %v", v.Rejections)
	}
}

func TestMinScoreOverlayReplacesTrashsAndKeepsIt(t *testing.T) {
	min := 77
	p := profileOf(t, withOverlay(&scoring.Overlay{MinScore: &min}))
	base := profileOf(t, englishHD)
	if p.MinScore(release.KindMovie) != 77 || p.TrashMinScore(release.KindMovie) != base.MinScore(release.KindMovie) {
		t.Errorf("min score %d, trash %d, base %d", p.MinScore(release.KindMovie), p.TrashMinScore(release.KindMovie), base.MinScore(release.KindMovie))
	}
}

func TestAtCutoffNeedsTheQualityAndTheScore(t *testing.T) {
	until := 2000
	spec := withOverlay(&scoring.Overlay{
		UpgradeUntil: &until,
		Series: scoring.KindOverlay{Qualities: []scoring.QualityPref{
			{Name: "Bluray-1080p", Accepted: true}, {Name: "WEBDL-1080p", Accepted: true}, {Name: "WEBRip-1080p", Accepted: true},
		}, Cutoff: "WEBDL-1080p"},
	})
	p := profileOf(t, spec)
	k := release.KindSeries
	for _, c := range []struct {
		name    string
		quality string
		score   int
		want    bool
	}{
		{"cutoff quality, enough Score", "WEBDL-1080p", 2000, true},
		{"cutoff quality, Score short", "WEBDL-1080p", 1999, false},
		{"better quality, enough Score", "Bluray-1080p", 3000, true},
		{"worse quality, high Score", "WEBRip-1080p", 9000, false},
		{"quality unknown to the ladder", "Raw-HD", 9000, false},
		{"no stored quality", "", 9000, false},
	} {
		if got := p.AtCutoff(k, c.quality, c.score); got != c.want {
			t.Errorf("%s: AtCutoff = %v, want %v", c.name, got, c.want)
		}
	}

	// A cutoff alone stops at the quality, whatever the Score.
	onlyQuality := profileOf(t, withOverlay(&scoring.Overlay{Series: scoring.KindOverlay{Cutoff: "WEBDL-1080p"}}))
	if !onlyQuality.AtCutoff(k, "WEBDL-1080p", -500) || onlyQuality.AtCutoff(k, "WEBRip-1080p", 5000) {
		t.Error("a cutoff with no Upgrade-until Score is about the quality alone")
	}
	// An Upgrade-until Score alone stops at the Score, whatever the quality.
	onlyScore := profileOf(t, withOverlay(&scoring.Overlay{UpgradeUntil: &until}))
	if !onlyScore.AtCutoff(k, "HDTV-720p", 2000) || onlyScore.AtCutoff(k, "Bluray-1080p", 1999) {
		t.Error("an Upgrade-until Score with no cutoff is about the Score alone")
	}
	// Movies have no cutoff of their own here but share the Score.
	if p.Cutoff(release.KindMovie) != "" || p.Cutoff(k) != "WEBDL-1080p" {
		t.Errorf("cutoffs: movies %q series %q", p.Cutoff(release.KindMovie), p.Cutoff(k))
	}
}

func TestFourKProfileLadderStaysInItsSlot(t *testing.T) {
	spec := scoring.ProfileSpec{UHD: true, Rule: scoring.PrimaryLanguage, Primary: release.LangEnglish}
	for _, q := range profileOf(t, spec).Ladder(release.KindMovie) {
		if q.Accepted && !slices.ContainsFunc(release.Qualities(release.KindMovie), func(x release.Quality) bool { return x.Name == q.Name && x.Resolution == 2160 }) {
			t.Errorf("%s accepted in the 4K Slot", q.Name)
		}
	}
}
