package acquire

import (
	"slices"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/indexers"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/slot"
)

func aired(y int) *time.Time {
	t := time.Date(y, 3, 1, 0, 0, 0, 0, time.UTC)
	return &t
}

var checkNow = time.Date(2026, 11, 3, 12, 0, 0, 0, time.UTC)

// ended1981 is a Series from 1981 that ended in 1984, with an alias another show of that name shares.
func ended1981() (library.Detail, []library.Episode) {
	d := library.Detail{
		Title: "Harbor Lights", OriginalTitle: "Harbor Lights", Year: 1981, SeriesStatus: "ended",
		Aliases: []library.Alias{{Title: "Name"}, {Title: "Harbour Lights"}},
	}
	return d, []library.Episode{
		{Season: 1, Number: 1, Name: "Pilot", AirDate: aired(1981)},
		{Season: 1, Number: 2, Name: "Don't Look Back, Jack!", AirDate: aired(1981)},
		{Season: 4, Number: 1, Name: "Mr. & Mrs. Smith", AirDate: aired(1984)},
		{Season: 0, Number: 1, Name: "Behind the Scenes", AirDate: aired(2005)},
	}
}

func continuing2020() (library.Detail, []library.Episode) {
	d := library.Detail{
		Title: "Night Show", Year: 2020, SeriesStatus: "continuing",
		Aliases: []library.Alias{{Title: "The Night Show"}},
	}
	return d, []library.Episode{
		{Season: 1, Number: 1, Name: "Dusk", PrimaryName: "Dämmerung", AirDate: aired(2020)},
		{Season: 2, Number: 3, Name: "Placeholder"},
		{Season: 5, Number: 1, Name: "Dawn", AirDate: aired(2099)},
	}
}

func verdict(t *testing.T, d library.Detail, eps []library.Episode, name string, byID bool) []scoring.Rejection {
	t.Helper()
	orig, err := release.Parse(name, release.KindSeries)
	if err != nil {
		t.Fatal(err)
	}
	p, ok := resolveDaily(orig, eps)
	if !ok {
		t.Fatalf("%s: daily not resolved", name)
	}
	return newShowCheck(d, eps, checkNow).rejections(indexers.Release{ByID: byID}, orig, p)
}

func TestAReleaseNamingAYearOutsideTheSeriesRunIsRejected(t *testing.T) {
	d, eps := ended1981()
	for _, c := range []struct {
		name string
		byID bool
		want bool
	}{
		{"Harbor.Lights.2026.S01E01.1080p.WEB-DL.H264-GRP", false, true},
		{"Harbor.Lights.2026.S01E01.1080p.WEB-DL.H264-GRP", true, true}, // an ID hit too
		{"Harbor.Lights.1979.S01E01.1080p.WEB-DL.H264-GRP", false, true},
		{"Harbor.Lights.1980.S01E01.1080p.WEB-DL.H264-GRP", false, false}, // one year before it first aired
		{"Harbor.Lights.1985.S01E01.1080p.WEB-DL.H264-GRP", false, false}, // one year after it last aired
		{"Harbor.Lights.1986.S01E01.1080p.WEB-DL.H264-GRP", false, true},
		{"Harbor.Lights.S01E01.1080p.WEB-DL.H264-GRP", false, false}, // no year: no regression
	} {
		got := slices.Contains(verdict(t, d, eps, c.name, c.byID), RejectYearOutsideRun)
		if got != c.want {
			t.Errorf("%s (by id %v): year rejection = %v, want %v", c.name, c.byID, got, c.want)
		}
	}
}

func TestAContinuingSeriesRunsUpToThisYear(t *testing.T) {
	d, eps := continuing2020()
	for year, want := range map[string]bool{"2019": false, "2018": true, "2026": false, "2027": true} {
		got := slices.Contains(verdict(t, d, eps, "Night.Show."+year+".S01E01.1080p.WEB-DL.H264-GRP", false), RejectYearOutsideRun)
		if got != want {
			t.Errorf("year %s: rejected = %v, want %v", year, got, want)
		}
	}
}

func TestAnAliasOnlyMatchNeedsAYearInTheRunOrAMatchingEpisodeTitle(t *testing.T) {
	d, eps := ended1981()
	for _, c := range []struct {
		name string
		want []scoring.Rejection
	}{
		{"Name.S01E01.1080p.WEB-DL.H264-GRP", []scoring.Rejection{RejectAliasOnly}},
		{"Name.S01E01.Some.Other.Words.1080p.WEB-DL.H264-GRP", []scoring.Rejection{RejectEpisodeTitle, RejectAliasOnly}},
		{"Name.1981.S01E01.1080p.WEB-DL.H264-GRP", nil},
		{"Name.S01E01.Pilot.1080p.WEB-DL.H264-GRP", nil},
		{"Name.S01E01.PILOT.REPACK.1080p.WEB-DL.H264-GRP", nil},
		{"Name.2026.S01E01.Some.Other.Words.1080p.WEB-DL.H264-GRP", []scoring.Rejection{RejectYearOutsideRun, RejectEpisodeTitle, RejectAliasOnly}},
		{"Harbor.Lights.S01E01.1080p.WEB-DL.H264-GRP", nil}, // the title itself needs no corroboration
	} {
		if got := verdict(t, d, eps, c.name, false); !slices.Equal(got, c.want) {
			t.Errorf("%s: rejections = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestAnAliasHitFoundByIDNeedsNoCorroboration(t *testing.T) {
	d, eps := ended1981()
	if got := verdict(t, d, eps, "Name.S01E01.1080p.WEB-DL.H264-GRP", true); len(got) != 0 {
		t.Errorf("rejections = %v", got)
	}
}

func TestAnEpisodeTitleThatClearlyDiffersRejectsTheRelease(t *testing.T) {
	d, eps := ended1981()
	got := verdict(t, d, eps, "Harbor.Lights.S01E01.The.Heist.At.Midnight.1080p.WEB-DL.H264-GRP", false)
	if !slices.Equal(got, []scoring.Rejection{RejectEpisodeTitle}) {
		t.Errorf("rejections = %v", got)
	}
	// The Primary Language title counts too.
	d, eps = continuing2020()
	for _, name := range []string{"Night.Show.S01E01.Dusk.1080p.WEB-DL.H264-GRP", "Night.Show.S01E01.Daemmerung.1080p.WEB-DL.H264-GRP"} {
		if got := verdict(t, d, eps, name, false); len(got) != 0 {
			t.Errorf("%s: rejections = %v", name, got)
		}
	}
}

func TestAnEpisodeTitleWithOtherPunctuationOrCaseStillMatches(t *testing.T) {
	d, eps := ended1981()
	for _, name := range []string{
		"Harbor.Lights.S01E02.Dont.Look.Back.Jack.1080p.WEB-DL.DDP5.1.H.264-GRP",
		"harbor.lights.s01e02.DONT.LOOK.BACK.JACK.720p.HDTV.x264-GRP",
		"Harbor_Lights_S01E02_Don't_Look_Back_Jack_1080p_WEB-DL_H264-GRP",
		"Harbor.Lights.S01E02.Dont.Look.Back.1080p.WEB-DL.H264-GRP",                // cut short
		"Harbor.Lights.S01E02.Dont.Look.Back.Jack.GERMAN.DL.1080p.WEB-DL.H264-GRP", // a language tag before the resolution
		"Harbor.Lights.S04E01.Mr.and.Mrs.Smith.1080p.WEB-DL.H264-GRP",
		"Harbor.Lights.S04E01.Mr.Mrs.Smith.2160p.WEB-DL.DDP5.1.Atmos.DV.H.265-GRP",
	} {
		if got := verdict(t, d, eps, name, false); len(got) != 0 {
			t.Errorf("%s: rejections = %v", name, got)
		}
	}
}

func TestTheEpisodeTitleRuleStaysQuietWhenItCannotBeSure(t *testing.T) {
	d, eps := ended1981()
	day := time.Date(1981, 10, 15, 0, 0, 0, 0, time.UTC)
	eps = append(eps, library.Episode{Season: 1, Number: 3, Name: "Harvest", AirDate: &day})
	for _, name := range []string{
		"Harbor.Lights.S01E01.1080p.WEB-DL.H264-GRP",                // no title in the name
		"Harbor.Lights.S01E01.Whatever",                             // nothing ends the title
		"Harbor.Lights.S01.The.Heist.1080p.WEB-DL.H264-GRP",         // a pack
		"Harbor.Lights.S01E01E02.The.Heist.1080p.WEB-DL.H264-GRP",   // several episodes
		"Harbor.Lights.S01E09.The.Heist.1080p.WEB-DL.H264-GRP",      // the Series has no such episode
		"Harbor.Lights.S00E01.Some.Special.1080p.WEB-DL.H264-GRP",   // a Special
		"Harbor.Lights.1981.10.15.Some.Guest.1080p.WEB-DL.H264-GRP", // a daily, resolved to S01E03
	} {
		if got := verdict(t, d, eps, name, false); len(got) != 0 {
			t.Errorf("%s: rejections = %v", name, got)
		}
	}
	// A Placeholder Episode has no title to compare.
	d, eps = continuing2020()
	eps[1].Name = ""
	if got := verdict(t, d, eps, "Night.Show.S02E03.Anything.At.All.1080p.WEB-DL.H264-GRP", false); len(got) != 0 {
		t.Errorf("rejections = %v", got)
	}
}

func TestRejectingAnEntryRejectsItUnderEveryVersion(t *testing.T) {
	e := &entry{cand: Candidate{Verdicts: map[Slot]scoring.Verdict{
		slot.Standard: {Accepted: true}, slot.FourK: {Rejections: []scoring.Rejection{scoring.RejectSize}},
	}}}
	e.reject([]scoring.Rejection{RejectAliasOnly})
	for s, v := range e.cand.Verdicts {
		if v.Accepted || !slices.Contains(v.Rejections, RejectAliasOnly) {
			t.Errorf("slot %v verdict = %+v", s, v)
		}
	}
	if !slices.Contains(e.cand.Verdicts[slot.FourK].Rejections, scoring.RejectSize) {
		t.Error("lost an earlier rejection")
	}
}
