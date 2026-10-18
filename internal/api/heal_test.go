package api_test

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/hyprsh/kestrel/internal/jobs"
	"github.com/hyprsh/kestrel/internal/probe"
)

const secondRelease = "Paddington.2014.1080p.WEB-DL.x264-GRP"

func TestAnImportTheProbeContradictsIsRejectedBlocklistedAndTheNextReleaseGrabbed(t *testing.T) {
	s := newSearch(t)
	german := goodProbe()
	german.Audio = []probe.AudioTrack{{Index: 1, Codec: "eac3", Channels: 6, Language: "deu", Default: true}}
	s.prober.set(german, nil)
	s.publish(t, secondRelease)
	grab, jobID := s.download(t, map[string]string{"paddington.mkv": "the movie"})

	s.pass(t, jobs.Poll)
	s.pass(t, jobs.Import)

	if got := s.grabState(t, grab); got != "failed" {
		t.Fatalf("Grab state = %s, want failed", got)
	}
	var failure, reason string
	if err := s.in.st.Read().QueryRow(`SELECT g.failure, b.reason FROM grabs g JOIN blocklist b ON b.grab_id = g.id WHERE g.id = ?`, grab).Scan(&failure, &reason); err != nil {
		t.Fatalf("the rejected Grab is not blocklisted: %v", err)
	}
	if failure != "language" {
		t.Errorf("failure = %q, want language", failure)
	}
	if s.hasJob(t, jobID) {
		t.Error("the rejected job is still in the client")
	}
	q := s.queue(t)
	if len(q) != 1 || q[0].GrabID == grab {
		t.Errorf("queue = %+v, want the next best Release downloading", q)
	}
}

func TestAStalledImportIsAWarningRowWithRetryNowAndDiscard(t *testing.T) {
	s := newSearch(t)
	s.finishSetup(t)
	s.prober.set(probe.Info{}, probe.ErrNotInstalled)
	grab, _ := s.download(t, map[string]string{"paddington.mkv": "the movie"})
	s.pass(t, jobs.Poll)
	s.pass(t, jobs.Import)

	row := s.attention(t).row(t, "stalled_imports")

	if row.Severity != "warning" || row.Count != 1 || row.Subject.GrabID == nil || *row.Subject.GrabID != grab {
		t.Fatalf("row = %+v", row)
	}
	retry, discard := row.action(t, "retry"), row.action(t, "discard")
	if retry.Method != "POST" || retry.Path != fmt.Sprintf("/grabs/%d/retry-import", grab) || discard.Confirm == nil {
		t.Errorf("actions = %+v", row.Actions)
	}

	s.prober.set(goodProbe(), nil)
	if r := s.valid("POST", retry.Path, ""); r.Status != 204 {
		t.Fatalf("retry = %d %s", r.Status, r.Body)
	}
	s.pass(t, jobs.Import)
	if got := s.grabState(t, grab); got != "imported" {
		t.Errorf("Grab state = %s, want imported after Retry now", got)
	}
	if s.attention(t).has("stalled_imports") {
		t.Error("the row stays after the Import went through")
	}
}

func TestDiscardingAStalledImportFreesTheVersionWithoutBlocklisting(t *testing.T) {
	s := newSearch(t)
	s.finishSetup(t)
	s.prober.set(probe.Info{}, probe.ErrNotInstalled)
	grab, jobID := s.download(t, map[string]string{"paddington.mkv": "the movie"})
	s.pass(t, jobs.Poll)
	s.pass(t, jobs.Import)

	if r := s.valid("POST", fmt.Sprintf("/grabs/%d/discard", grab), ""); r.Status != 204 {
		t.Fatalf("discard = %d %s", r.Status, r.Body)
	}

	if got := s.grabState(t, grab); got != "failed" {
		t.Errorf("Grab state = %s", got)
	}
	if s.hasJob(t, jobID) {
		t.Error("the client still has the job")
	}
	var n int
	_ = s.in.st.Read().QueryRow(`SELECT COUNT(*) FROM blocklist`).Scan(&n)
	if n != 0 {
		t.Errorf("blocklist holds %d entries, want none", n)
	}
	if s.attention(t).has("stalled_imports") {
		t.Error("the row stays after Discard")
	}
	if r := s.valid("POST", fmt.Sprintf("/grabs/%d/discard", grab), ""); r.Status != 404 {
		t.Errorf("a second discard = %d, want 404", r.Status)
	}
}

func TestStalledImportsOfOneReasonAreOneRowWithRetryAll(t *testing.T) {
	s := newSearch(t)
	s.finishSetup(t)
	s.prober.set(probe.Info{}, probe.ErrNotInstalled)
	s.download(t, map[string]string{"paddington.mkv": "the movie"})
	s.publish(t, uhdRelease)
	if r := s.grab(s.uhd, s.releases(t, s.uhd).find(t, uhdRelease).ReleaseID, false); r.Status != 201 {
		t.Fatalf("grab = %d %s", r.Status, r.Body)
	}
	for _, j := range s.jobs(t) {
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, "paddington.mkv"), []byte("the movie"), 0o644); err != nil {
			t.Fatal(err)
		}
		_ = s.sab.Complete(j.ClientID, dir)
	}
	s.pass(t, jobs.Poll)
	s.pass(t, jobs.Import)

	row := s.attention(t).row(t, "stalled_imports")

	retry := row.action(t, "retry")
	if row.Count != 2 || retry.Label != "Retry all" || retry.Path != "/stalled-imports/retry" || retry.Body["reason"] == nil {
		t.Errorf("row = %+v", row)
	}
	if r := s.valid("POST", retry.Path, `{"reason":"ffprobe not installed"}`); r.Status != 204 {
		t.Errorf("retry all = %d %s", r.Status, r.Body)
	}
	disc := row.action(t, "discard")
	if r := s.valid("POST", disc.Path, `{"reason":"ffprobe not installed"}`); r.Status != 204 {
		t.Errorf("discard all = %d %s", r.Status, r.Body)
	}
	if s.attention(t).has("stalled_imports") {
		t.Error("the row stays after Discard all")
	}
}

func TestAnImportingGrabIsImportedAgainAfterARestart(t *testing.T) {
	s := newSearch(t)
	s.prober.set(goodProbe(), nil)
	grab, _ := s.download(t, map[string]string{"paddington.mkv": "the movie"})
	s.pass(t, jobs.Poll)
	if _, err := s.in.st.Write().Exec(`UPDATE grabs SET state = 'importing' WHERE id = ?`, grab); err != nil {
		t.Fatal(err)
	}

	s.in.restart()
	s.in.app.Jobs.Reconcile(t.Context())
	s.pass(t, jobs.Import)

	if got := s.grabState(t, grab); got != "imported" {
		t.Errorf("Grab state = %s, want imported", got)
	}
}
