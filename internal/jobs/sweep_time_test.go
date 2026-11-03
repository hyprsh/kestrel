package jobs_test

import (
	"context"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/jobs"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/slot"
)

// slowSearch is a recorder whose every search takes ten minutes of the rig's clock and notes the trigger it ran under.
type slowSearch struct {
	*recorder
	rig      *sweepRig
	triggers []history.Trigger
}

func (s *slowSearch) SearchWanted(ctx context.Context, titleID int64, v []int64) (acquire.Outcome, error) {
	s.triggers = append(s.triggers, history.TriggerOf(ctx))
	s.rig.clock = s.rig.clock.Add(10 * time.Minute)
	return s.recorder.SearchWanted(ctx, titleID, v)
}

func (s *slowSearch) SearchNew(ctx context.Context, titleID int64, v []int64) (acquire.Outcome, error) {
	s.triggers = append(s.triggers, history.TriggerOf(ctx))
	s.rig.clock = s.rig.clock.Add(10 * time.Minute)
	return s.recorder.SearchNew(ctx, titleID, v)
}

// newRunnerWith is the rig's runner with another acquirer.
func newRunnerWith(r *sweepRig, a jobs.Acquirer) *jobs.Runner {
	return jobs.Standard(jobs.Deps{Acquire: a, Library: r.lib, Clock: func() time.Time { return r.clock }})
}

func (r *sweepRig) addMovie(id int, title string) int64 {
	r.t.Helper()
	tid, err := r.lib.AddMovie(r.ctx, library.AddMovie{
		Details: metadata.MovieDetails{
			TMDBID: id, Title: title, OriginalTitle: title, OriginalLanguage: "en", Year: 2014,
			ReleaseDates: metadata.ReleaseDates{{Country: "US", Type: metadata.Digital, Date: time.Date(2015, 4, 1, 0, 0, 0, 0, time.UTC)}},
		},
		PrimaryLanguage: "en", RootFolder: "/m", Versions: []library.VersionSpec{{Slot: slot.Standard, Profile: "hd-primary"}},
	})
	if err != nil {
		r.t.Fatal(err)
	}
	return tid
}

func (r *sweepRig) searchedAt(titleID int64) time.Time {
	r.t.Helper()
	rows, err := r.lib.List(r.ctx, library.View{Country: "US", Now: r.clock}, library.Filter{})
	if err != nil {
		r.t.Fatal(err)
	}
	for _, row := range rows {
		if row.ID == titleID && row.SearchedAt != nil {
			return *row.SearchedAt
		}
	}
	r.t.Fatalf("Title %d has no last search time", titleID)
	return time.Time{}
}

func TestASweepMarksEachVersionSearchedWhenItsSearchRanNotWhenThePassStarted(t *testing.T) {
	rig := newSweepRig(t)
	second := rig.addMovie(2, "Second")
	slow := &slowSearch{recorder: rig.acq, rig: rig}
	rig.runner = newRunnerWith(rig, slow)
	start := rig.clock

	if err := rig.runner.Pass(rig.ctx, "search"); err != nil {
		t.Fatal(err)
	}

	first, later := rig.searchedAt(rig.titleID), rig.searchedAt(second)
	if first.Equal(start) && later.Equal(start) {
		t.Fatalf("both Versions are marked searched at the start of the pass, %v", start)
	}
	if !later.After(first) || later.Sub(first) != 10*time.Minute {
		t.Errorf("searched at %v and %v, want the second ten minutes after the first: each when its search ran", first, later)
	}
}

func TestABulkSearchCarriesThePersonToTheSweepsSearch(t *testing.T) {
	rig := newSweepRig(t)
	slow := &slowSearch{recorder: rig.acq, rig: rig}
	rig.runner = newRunnerWith(rig, slow)
	if err := rig.runner.Pass(rig.ctx, "search"); err != nil { // the search on add
		t.Fatal(err)
	}
	rig.clock = rig.clock.Add(time.Hour)
	slow.triggers = nil

	asked := history.WithTrigger(rig.ctx, history.Person("navi", "BulkTitles"))
	if n, err := rig.lib.SearchWanted(asked, []int64{rig.titleID}); err != nil || n[rig.titleID] != 1 {
		t.Fatalf("SearchWanted = %v, %v", n, err)
	}
	if err := rig.runner.Pass(rig.ctx, "search"); err != nil {
		t.Fatal(err)
	}
	if len(slow.triggers) != 1 || slow.triggers[0].Kind != history.TriggerPerson || slow.triggers[0].Actor != "navi" {
		t.Fatalf("the search ran under %+v, want the person who asked", slow.triggers)
	}

	// Once searched, the request is spent: the next due search is the sweep's own.
	rig.clock = rig.clock.Add(30 * 24 * time.Hour)
	slow.triggers = nil
	if err := rig.runner.Pass(rig.ctx, "search"); err != nil {
		t.Fatal(err)
	}
	if len(slow.triggers) != 1 || slow.triggers[0].Kind != history.TriggerSweep {
		t.Errorf("the next search ran under %+v, want the sweep", slow.triggers)
	}
}
