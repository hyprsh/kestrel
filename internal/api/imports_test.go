package api_test

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/jobs"
	"github.com/hyprsh/kestrel/internal/probe"
)

// stubProber answers every probe with the same Info, or an error.
type stubProber struct {
	mu   sync.Mutex
	info probe.Info
	err  error
}

func (p *stubProber) Probe(context.Context, string) (probe.Info, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.info, p.err
}

func (p *stubProber) set(i probe.Info, err error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.info, p.err = i, err
}

func goodProbe() probe.Info {
	return probe.Info{
		Size: 8 << 30, Duration: 95 * time.Minute, HasVideo: true, Width: 1920, Height: 1080, VideoCodec: "h264",
		Audio: []probe.AudioTrack{{Index: 1, Codec: "eac3", Channels: 6, Language: "eng", Default: true}},
	}
}

type fileJSON struct {
	Path        string   `json:"path"`
	ReleaseName string   `json:"release_name"`
	Score       *int     `json:"score"`
	Quality     *string  `json:"quality"`
	Languages   []string `json:"languages"`
}

// download runs the Movie loop up to a completed job whose files are in a
// fresh folder, and returns the Standard Grab's id and the client's job id.
func (s search) download(t *testing.T, files map[string]string) (grabID int64, jobID string) {
	t.Helper()
	s.publish(t, goodRelease)
	s.pass(t, jobs.Search)
	for _, it := range s.queue(t) {
		if it.VersionID != nil && *it.VersionID == s.hd {
			grabID = it.GrabID
		}
	}
	if grabID == 0 {
		t.Fatal("no Grab for the Standard Version")
	}
	for _, j := range s.jobs(t) {
		jobID = j.ClientID
	}
	dir := filepath.Join(t.TempDir(), goodRelease)
	for name, body := range files {
		p := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.sab.Complete(jobID, dir); err != nil {
		t.Fatal(err)
	}
	return grabID, jobID
}

func (s search) hdFile(t *testing.T) *fileJSON {
	t.Helper()
	d := decode[struct {
		Versions []struct {
			ID   int64     `json:"id"`
			File *fileJSON `json:"file"`
		} `json:"versions"`
	}](t, s.valid("GET", fmt.Sprintf("/titles/%d", s.title), ""))
	for _, v := range d.Versions {
		if v.ID == s.hd {
			return v.File
		}
	}
	return nil
}

func (s search) hasJob(t *testing.T, id string) bool {
	t.Helper()
	for _, j := range s.jobs(t) {
		if j.ClientID == id {
			return true
		}
	}
	return false
}

func TestACompletedMovieIsImportedIntoItsFolderAndTheVersionShowsItsFile(t *testing.T) {
	s := newSearch(t)
	s.prober.set(goodProbe(), nil)
	grab, jobID := s.download(t, map[string]string{
		"paddington.mkv": "the movie", "paddington.nfo": "junk", "Sample/sample.mkv": "sample", "paddington.en.srt": "subs",
	})

	s.pass(t, jobs.Poll)
	s.pass(t, jobs.Import)

	if got := s.grabState(t, grab); got != "imported" {
		t.Fatalf("Grab state = %s, want imported", got)
	}
	f := s.hdFile(t)
	if f == nil {
		t.Fatal("the Version has no file")
	}
	folder := filepath.Join(s.data, "media", "movies", "Paddington (2014) {tmdb-116149}")
	if filepath.Dir(f.Path) != folder || !strings.HasPrefix(filepath.Base(f.Path), "Paddington (2014) {tmdb-116149} - [Standard]") {
		t.Errorf("file path = %q", f.Path)
	}
	if b, err := os.ReadFile(f.Path); err != nil || string(b) != "the movie" {
		t.Errorf("file on disk = %q, %v", b, err)
	}
	if entries, _ := os.ReadDir(folder); len(entries) != 2 {
		t.Errorf("Title folder holds %d files, want the video and one subtitle", len(entries))
	}
	if f.Score == nil || f.Quality == nil || *f.Quality != "Bluray-1080p" || len(f.Languages) != 1 || f.Languages[0] != "English" {
		t.Errorf("file summary = %+v", f)
	}
	if s.hasJob(t, jobID) {
		t.Error("the client still has the job after the Import")
	}
}

func TestAnImportThatFailsTheProbeBlocklistsTheReleaseAndFreesTheVersion(t *testing.T) {
	s := newSearch(t)
	short := goodProbe()
	short.Duration = 5 * time.Minute
	s.prober.set(short, nil)
	grab, jobID := s.download(t, map[string]string{"paddington.mkv": "the movie"})

	s.pass(t, jobs.Poll)
	s.pass(t, jobs.Import)

	if got := s.grabState(t, grab); got != "failed" {
		t.Fatalf("Grab state = %s, want failed", got)
	}
	if f := s.hdFile(t); f != nil {
		t.Errorf("the Version holds %+v", f)
	}
	if s.hasJob(t, jobID) {
		t.Error("the rejected job is still in the client")
	}
	r := s.releases(t, s.hd)
	if len(r.Items) == 0 || len(r.Items[0].Rejections) == 0 || r.Items[0].Rejections[0].Code != "blocklisted" {
		t.Errorf("the rejected Release is not blocklisted: %+v", r.Items)
	}
}

func TestAStalledImportKeepsItsJobAndIsRetriedWhenItsTimeComes(t *testing.T) {
	s := newSearch(t)
	s.prober.set(probe.Info{}, probe.ErrNotInstalled)
	grab, jobID := s.download(t, map[string]string{"paddington.mkv": "the movie"})
	s.pass(t, jobs.Poll)

	s.pass(t, jobs.Import)

	if got := s.grabState(t, grab); got != "importing" {
		t.Fatalf("Grab state = %s, want importing", got)
	}
	if s.hdFile(t) != nil {
		t.Fatal("the Version has a file")
	}
	if !s.hasJob(t, jobID) {
		t.Fatal("the client's job was removed")
	}

	s.prober.set(goodProbe(), nil)
	s.pass(t, jobs.Import)
	if got := s.grabState(t, grab); got != "importing" {
		t.Errorf("retried before its time: %s", got)
	}
	s.in.clock.Advance(2 * time.Minute)
	s.pass(t, jobs.Import)
	if got := s.grabState(t, grab); got != "imported" {
		t.Errorf("Grab state = %s, want imported after the retry", got)
	}
}

func TestTheStreamHintsAnImportAndEmptiesTheQueue(t *testing.T) {
	s := newSearchBare(t, fastStream)
	s.addPaddington(t)
	s.prober.set(goodProbe(), nil)
	grab, _ := s.download(t, map[string]string{"paddington.mkv": "the movie"})
	s.pass(t, jobs.Poll)
	st := s.stream(t)
	st.queue("importing", func(items []queueItemJSON) bool { return len(items) == 1 && items[0].Phase == "importing" })

	st.mark()
	s.pass(t, jobs.Import)

	st.until("changed hint for the Grab", func(e sseEvent) bool {
		return e.Name == "changed" && strings.Contains(e.Data, `"grab"`) && strings.Contains(e.Data, fmt.Sprint(grab))
	})
	st.hint("title")
	st.hint("queue")
	st.queue("nothing left to import", func(items []queueItemJSON) bool { return len(items) == 0 })
}
