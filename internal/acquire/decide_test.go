package acquire

import (
	"github.com/hyprsh/kestrel/internal/slot"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring"
)

var t0 = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

// movieCand is an accepted Movie candidate in the Standard Slot unless changed.
func movieCand(guid string, score int, mod ...func(*Candidate)) Candidate {
	c := Candidate{
		GUID: guid, PublishDate: t0, Size: 1000,
		Verdicts: map[Slot]scoring.Verdict{slot.Standard: {Accepted: true, Score: score}},
	}
	for _, m := range mod {
		m(&c)
	}
	return c
}

func epCand(guid string, score, season int, eps []int, mod ...func(*Candidate)) Candidate {
	return movieCand(guid, score, append([]func(*Candidate){func(c *Candidate) {
		c.Parsed = release.ParsedRelease{Series: &release.SeriesInfo{Season: season, Episodes: eps}}
	}}, mod...)...)
}

func packCand(guid string, score, season int, mod ...func(*Candidate)) Candidate {
	return movieCand(guid, score, append([]func(*Candidate){func(c *Candidate) {
		c.Parsed = release.ParsedRelease{Series: &release.SeriesInfo{Season: season, FullSeason: true}}
	}}, mod...)...)
}

func movieVersion(held *Held) Version {
	return Version{Slot: slot.Standard, Units: []Unit{{Held: held}}}
}

func guids(plans []GrabPlan) []string {
	var out []string
	for _, p := range plans {
		out = append(out, p.Candidate.GUID)
	}
	return out
}

func wantGUIDs(t *testing.T, plans []GrabPlan, want ...string) {
	t.Helper()
	got := guids(plans)
	if len(got) != len(want) {
		t.Fatalf("plans = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("plans = %v, want %v", got, want)
		}
	}
}

func TestMovieMissingTakesHighestScore(t *testing.T) {
	plans := Decide(Input{
		Versions:   []Version{movieVersion(nil)},
		Candidates: []Candidate{movieCand("a", 100), movieCand("b", 300), movieCand("c", 200)},
	})
	wantGUIDs(t, plans, "b")
	if plans[0].Upgrade || plans[0].Pack || plans[0].Slot != slot.Standard {
		t.Fatalf("plan = %+v", plans[0])
	}
}

func TestRejectedCandidatesAreNotPlanned(t *testing.T) {
	rej := func(c *Candidate) {
		c.Verdicts = map[Slot]scoring.Verdict{slot.Standard: {Accepted: false, Score: 900, Rejections: []scoring.Rejection{scoring.RejectLanguage}}}
	}
	plans := Decide(Input{
		Versions:   []Version{movieVersion(nil)},
		Candidates: []Candidate{movieCand("rej", 0, rej), movieCand("ok", 10)},
	})
	wantGUIDs(t, plans, "ok")
}

func TestTieBreaks(t *testing.T) {
	older := func(c *Candidate) { c.PublishDate = t0.Add(-time.Hour) }
	bigger := func(c *Candidate) { c.Size = 5000 }
	prio := func(n int) func(*Candidate) { return func(c *Candidate) { c.IndexerPriority = n } }
	cases := []struct {
		name string
		cs   []Candidate
		want string
	}{
		{"newer post", []Candidate{movieCand("old", 5, older), movieCand("new", 5)}, "new"},
		{"larger size after same post", []Candidate{movieCand("small", 5), movieCand("big", 5, bigger)}, "big"},
		{"lower priority number after same size", []Candidate{movieCand("p25", 5, prio(25)), movieCand("p1", 5, prio(1))}, "p1"},
		{"score beats newer", []Candidate{movieCand("old-high", 6, older), movieCand("new-low", 5)}, "old-high"},
		{"post beats size", []Candidate{movieCand("old-big", 5, older, bigger), movieCand("new", 5)}, "new"},
		{"size beats priority", []Candidate{movieCand("big-p9", 5, bigger, prio(9)), movieCand("small-p1", 5, prio(1))}, "big-p9"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			wantGUIDs(t, Decide(Input{Versions: []Version{movieVersion(nil)}, Candidates: tc.cs}), tc.want)
		})
	}
}

func TestUpgradeThresholdAndMisfit(t *testing.T) {
	cases := []struct {
		name        string
		held        *Held
		score       int
		wantPlanned bool
		wantUpgrade bool
	}{
		{"missing", nil, -500, true, false},
		{"beats held by exactly the threshold", &Held{Fits: true, Score: 10}, 11, true, true},
		{"beats by more", &Held{Fits: true, Score: 10}, 500, true, true},
		{"matches held is not an upgrade", &Held{Fits: true, Score: 10}, 10, false, false},
		{"below held", &Held{Fits: true, Score: 10}, 9, false, false},
		{"misfit replaced by lower score", &Held{Fits: false, Score: 1000}, 0, true, false},
		{"misfit replaced by equal score", &Held{Fits: false, Score: 0}, 0, true, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			plans := Decide(Input{Versions: []Version{movieVersion(tc.held)}, Candidates: []Candidate{movieCand("x", tc.score)}})
			if (len(plans) == 1) != tc.wantPlanned {
				t.Fatalf("plans = %v, want planned=%v", guids(plans), tc.wantPlanned)
			}
			if len(plans) == 1 && plans[0].Upgrade != tc.wantUpgrade {
				t.Fatalf("Upgrade = %v, want %v", plans[0].Upgrade, tc.wantUpgrade)
			}
		})
	}
}

// rejectsResolution is a verdict for a Profile whose range does not hold the Release's class.
var rejectsResolution = scoring.Verdict{Score: 9999, Rejections: []scoring.Rejection{scoring.RejectResolution}}

func TestOtherSlotAndUnwantedSlot(t *testing.T) {
	uhd := func(c *Candidate) {
		c.ClassKnown = true
		c.Verdicts = map[Slot]scoring.Verdict{slot.FourK: {Accepted: true, Score: 9999}, slot.Standard: rejectsResolution}
	}
	t.Run("4K release never fills the Standard Version", func(t *testing.T) {
		plans := Decide(Input{Versions: []Version{movieVersion(nil)}, Candidates: []Candidate{movieCand("uhd", 0, uhd)}})
		wantGUIDs(t, plans)
	})
	t.Run("4K release fills a 4K Version only when the Title has one", func(t *testing.T) {
		vs := []Version{movieVersion(nil), {Slot: slot.FourK, Units: []Unit{{}}}}
		plans := Decide(Input{Versions: vs, Candidates: []Candidate{movieCand("hd", 1), movieCand("uhd", 0, uhd)}})
		wantGUIDs(t, plans, "hd", "uhd")
		if plans[1].Slot != slot.FourK {
			t.Fatalf("slot = %v", plans[1].Slot)
		}
	})
	t.Run("rejections", func(t *testing.T) {
		c := movieCand("uhd", 0, uhd)
		if got := Rejections(slot.Standard, c); len(got) != 1 || got[0] != RejectOtherSlot {
			t.Fatalf("got %v", got)
		}
		if got := Rejections(slot.FourK, c); len(got) != 0 {
			t.Fatalf("got %v", got)
		}
	})
	t.Run("a known class the Profile does not accept is other_slot even when the Title has no Version for it", func(t *testing.T) {
		c := movieCand("uhd", 0, func(c *Candidate) {
			c.ClassKnown = true
			c.Verdicts = map[Slot]scoring.Verdict{slot.Standard: rejectsResolution}
		})
		got := Rejections(slot.Standard, c)
		if len(got) != 1 || got[0] != RejectOtherSlot {
			t.Fatalf("got %v", got)
		}
		wantGUIDs(t, Decide(Input{Versions: []Version{movieVersion(nil)}, Candidates: []Candidate{c}}))
	})
	t.Run("an unknown class is the plain resolution rejection", func(t *testing.T) {
		c := movieCand("odd", 0, func(c *Candidate) { c.Verdicts = map[Slot]scoring.Verdict{slot.Standard: rejectsResolution} })
		got := Rejections(slot.Standard, c)
		if len(got) != 1 || got[0] != scoring.RejectResolution {
			t.Fatalf("got %v", got)
		}
	})
}

// Any sits in the Standard Slot but its Profile accepts 0-1080, so it takes SD and HD releases.
func TestFitFollowsTheVersionsProfileRange(t *testing.T) {
	t.Run("an SD release is planned for an Any Version in the Standard Slot", func(t *testing.T) {
		c := movieCand("sd", 0, func(c *Candidate) {
			c.Verdicts = map[Slot]scoring.Verdict{slot.Standard: {Accepted: true, Score: 5}}
		})
		plans := Decide(Input{Versions: []Version{movieVersion(nil)}, Candidates: []Candidate{c}})
		wantGUIDs(t, plans, "sd")
		if got := Rejections(slot.Standard, c); len(got) != 0 {
			t.Fatalf("rejections = %v", got)
		}
	})
}

func TestPausedIndexerIsSkipped(t *testing.T) {
	paused := func(c *Candidate) { c.IndexerGrabsPaused = true }
	plans := Decide(Input{
		Versions:   []Version{movieVersion(nil)},
		Candidates: []Candidate{movieCand("paused", 900, paused), movieCand("open", 1)},
	})
	wantGUIDs(t, plans, "open")
}

func TestAbsoluteNumberingAndMultiSeasonAreSkipped(t *testing.T) {
	abs := epCand("abs", 100, 1, nil, func(c *Candidate) { c.Parsed.Series.AbsoluteEpisodes = []int{5} })
	multi := packCand("multi", 100, 1, func(c *Candidate) { c.Parsed.Series.MultiSeason = true })
	v := Version{Slot: slot.Standard, Units: []Unit{{Ref: EpisodeRef{1, 5}}}}
	wantGUIDs(t, Decide(Input{Versions: []Version{v}, Candidates: []Candidate{abs, multi}}))
}

func seasonVersion(season int, held map[int]*Held, n int) Version {
	v := Version{Slot: slot.Standard}
	for e := 1; e <= n; e++ {
		v.Units = append(v.Units, Unit{Ref: EpisodeRef{season, e}, Held: held[e]})
	}
	return v
}

func TestSingleEpisodes(t *testing.T) {
	v := seasonVersion(1, map[int]*Held{2: {Fits: true, Score: 10}}, 3)
	plans := Decide(Input{Versions: []Version{v}, Candidates: []Candidate{
		epCand("e1-lo", 5, 1, []int{1}), epCand("e1-hi", 50, 1, []int{1}),
		epCand("e2-same", 10, 1, []int{2}), epCand("e3", 7, 1, []int{3}),
		epCand("e9-unmonitored", 99, 1, []int{9}),
	}})
	wantGUIDs(t, plans, "e1-hi", "e3")
	if got := plans[0].Covers; len(got) != 1 || got[0] != (EpisodeRef{1, 1}) {
		t.Fatalf("covers = %v", got)
	}
}

func TestSeasonPackPreferredOnceFinished(t *testing.T) {
	v := seasonVersion(1, nil, 3)
	cs := []Candidate{
		packCand("pack", 100, 1),
		epCand("e1", 100, 1, []int{1}), epCand("e2", 100, 1, []int{2}), epCand("e3", 100, 1, []int{3}),
	}
	t.Run("finished: pack wins on a tie", func(t *testing.T) {
		plans := Decide(Input{Versions: []Version{v}, Candidates: cs, SeasonsFinished: map[int]bool{1: true}})
		wantGUIDs(t, plans, "pack")
		if !plans[0].Pack || len(plans[0].Covers) != 3 {
			t.Fatalf("plan = %+v", plans[0])
		}
	})
	t.Run("airing: no preference, singles with the same score are planned", func(t *testing.T) {
		plans := Decide(Input{Versions: []Version{v}, Candidates: cs})
		wantGUIDs(t, plans, "e1", "e2", "e3")
	})
	t.Run("finished: a higher scoring single beats the pack", func(t *testing.T) {
		cs2 := append([]Candidate{epCand("e2-hi", 150, 1, []int{2})}, cs...)
		plans := Decide(Input{Versions: []Version{v}, Candidates: cs2, SeasonsFinished: map[int]bool{1: true}})
		wantGUIDs(t, plans, "e1", "e2-hi", "e3")
	})
}

func TestPackAsUpgradeNeedsToBeatOrMatchEveryHeldEpisode(t *testing.T) {
	fin := map[int]bool{1: true}
	t.Run("beats one and loses to another: not planned", func(t *testing.T) {
		v := seasonVersion(1, map[int]*Held{1: {Fits: true, Score: 10}, 2: {Fits: true, Score: 200}}, 2)
		wantGUIDs(t, Decide(Input{Versions: []Version{v}, SeasonsFinished: fin, Candidates: []Candidate{packCand("pack", 100, 1)}}))
	})
	t.Run("matches one and beats another: planned", func(t *testing.T) {
		v := seasonVersion(1, map[int]*Held{1: {Fits: true, Score: 100}, 2: {Fits: true, Score: 10}}, 2)
		plans := Decide(Input{Versions: []Version{v}, SeasonsFinished: fin, Candidates: []Candidate{packCand("pack", 100, 1)}})
		wantGUIDs(t, plans, "pack")
		if !plans[0].Upgrade {
			t.Fatal("want Upgrade")
		}
	})
	t.Run("matches every held episode: nothing to upgrade", func(t *testing.T) {
		v := seasonVersion(1, map[int]*Held{1: {Fits: true, Score: 100}, 2: {Fits: true, Score: 100}}, 2)
		wantGUIDs(t, Decide(Input{Versions: []Version{v}, SeasonsFinished: fin, Candidates: []Candidate{packCand("pack", 100, 1)}}))
	})
	t.Run("a missing episode is a real gain even when the pack ties the rest", func(t *testing.T) {
		v := seasonVersion(1, map[int]*Held{1: {Fits: true, Score: 100}}, 2)
		wantGUIDs(t, Decide(Input{Versions: []Version{v}, SeasonsFinished: fin, Candidates: []Candidate{packCand("pack", 100, 1)}}), "pack")
	})
	t.Run("a missing episode is filled even when the pack scores below another held episode", func(t *testing.T) {
		v := seasonVersion(1, map[int]*Held{1: {Fits: true, Score: 200}}, 3)
		plans := Decide(Input{Versions: []Version{v}, SeasonsFinished: fin, Candidates: []Candidate{packCand("pack", 100, 1)}})
		wantGUIDs(t, plans, "pack")
		if !plans[0].Pack || plans[0].Upgrade || len(plans[0].Covers) != 2 || plans[0].Covers[0] != (EpisodeRef{1, 2}) {
			t.Fatalf("plan = %+v, want the pack covering only the two missing episodes", plans[0])
		}
	})
	t.Run("a misfit held episode never blocks the pack", func(t *testing.T) {
		v := seasonVersion(1, map[int]*Held{1: {Fits: false, Score: 5000}, 2: {Fits: true, Score: 100}}, 2)
		wantGUIDs(t, Decide(Input{Versions: []Version{v}, SeasonsFinished: fin, Candidates: []Candidate{packCand("pack", 100, 1)}}), "pack")
	})
}

func TestPackOnlyCoversItsSeason(t *testing.T) {
	v := Version{Slot: slot.Standard, Units: []Unit{{Ref: EpisodeRef{2, 1}}}}
	wantGUIDs(t, Decide(Input{Versions: []Version{v}, SeasonsFinished: map[int]bool{1: true, 2: true}, Candidates: []Candidate{packCand("s1", 100, 1)}}))
}

func TestUnfinishedSeasonPackIsOnlyAFallback(t *testing.T) {
	v := seasonVersion(1, nil, 2)
	wantGUIDs(t, Decide(Input{Versions: []Version{v}, Candidates: []Candidate{packCand("pack", 100, 1)}}), "pack")
}

func TestMultiEpisodeReleaseFollowsPackRule(t *testing.T) {
	v := seasonVersion(1, map[int]*Held{1: {Fits: true, Score: 10}, 2: {Fits: true, Score: 200}}, 2)
	wantGUIDs(t, Decide(Input{Versions: []Version{v}, Candidates: []Candidate{epCand("multi", 100, 1, []int{1, 2})}}))
}
