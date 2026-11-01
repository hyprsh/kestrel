package instances_test

import (
	"reflect"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/plugin"
	"github.com/hyprsh/kestrel/internal/plugin/instances"
)

func TestRecordCheckKeepsTheLatestOutcomeOfEachInstance(t *testing.T) {
	s := newService(t)
	in, _ := s.Create(ctx, instances.New{PluginID: "fake", Name: "SAB", Config: map[string]any{"api_key": "k"}})
	if got, _ := s.Get(ctx, in.ID); got.LastCheck != nil {
		t.Fatalf("a new instance has no check yet: %+v", got.LastCheck)
	}

	t1 := time.Date(2026, 10, 18, 9, 0, 0, 0, time.UTC)
	if err := s.RecordCheck(ctx, in.ID, t1, plugin.Errorf(plugin.CodeAuth, "bad key")); err != nil {
		t.Fatal(err)
	}
	got, _ := s.Get(ctx, in.ID)
	want := &instances.Check{At: t1, Code: "auth", Message: "bad key"}
	if !reflect.DeepEqual(got.LastCheck, want) {
		t.Fatalf("got %+v, want %+v", got.LastCheck, want)
	}

	t2 := t1.Add(15 * time.Minute)
	if err := s.RecordCheck(ctx, in.ID, t2, nil); err != nil {
		t.Fatal(err)
	}
	got, _ = s.Get(ctx, in.ID)
	if want := (&instances.Check{At: t2, OK: true}); !reflect.DeepEqual(got.LastCheck, want) {
		t.Fatalf("got %+v, want %+v", got.LastCheck, want)
	}
	all, _ := s.List(ctx)
	if all[0].LastCheck == nil || !all[0].LastCheck.OK {
		t.Errorf("List should carry it too: %+v", all[0])
	}

	// An instance that is gone is not an error: a check can finish after a delete.
	if err := s.RecordCheck(ctx, in.ID+99, t2, nil); err != nil {
		t.Errorf("unknown instance: %v", err)
	}
}

func TestTestOfTheSavedConnectionKeepsItsLatencyAcrossLaterCalls(t *testing.T) {
	s := newService(t)
	in, _ := s.Create(ctx, instances.New{PluginID: "fake", Name: "SAB", Config: map[string]any{"api_key": "k"}})
	p, conn, err := s.Resolve(ctx, "fake", in.ID, nil, true)
	if err != nil {
		t.Fatal(err)
	}

	// A Test of edits is of the form: nothing is stored.
	if _, err := s.Test(ctx, p, conn, false); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.Get(ctx, in.ID); got.LastCheck != nil {
		t.Fatalf("a form test stores nothing: %+v", got.LastCheck)
	}

	if _, err := s.Test(ctx, p, conn, true); err != nil {
		t.Fatal(err)
	}
	got, _ := s.Get(ctx, in.ID)
	if got.LastCheck == nil || !got.LastCheck.OK || got.LastCheck.LatencyMS <= 0 {
		t.Fatalf("a good check records its latency: %+v", got.LastCheck)
	}
	kept := got.LastCheck.LatencyMS

	// A real call (Observe) moves the outcome but keeps the latency, failed or not.
	s.Observe(ctx, in.ID, plugin.Errorf(plugin.CodeUnavailable, "down"))
	got, _ = s.Get(ctx, in.ID)
	if got.LastCheck.OK || got.LastCheck.LatencyMS != kept {
		t.Fatalf("after a failed Observe: %+v, want latency %d", got.LastCheck, kept)
	}
	s.Observe(ctx, in.ID, nil)
	if got, _ = s.Get(ctx, in.ID); !got.LastCheck.OK || got.LastCheck.LatencyMS != kept {
		t.Fatalf("after a good Observe: %+v, want latency %d", got.LastCheck, kept)
	}
}
