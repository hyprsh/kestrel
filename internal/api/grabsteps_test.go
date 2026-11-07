package api_test

import (
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/jobs"
)

type grabStepsJSON struct {
	GrabID    int64      `json:"grab_id"`
	GrabbedBy *string    `json:"grabbed_by"`
	EndedAt   *time.Time `json:"ended_at"`
	Files     []struct {
		Episode *string `json:"episode"`
		Path    string  `json:"path"`
	} `json:"files"`
	Formats       []struct{ Name string } `json:"formats"`
	BlocklistID   *int64                  `json:"blocklist_id"`
	BlocklistedAt *time.Time              `json:"blocklisted_at"`
	StillWanted   bool                    `json:"still_wanted"`
}

func (s search) steps(t *testing.T, grab int64) grabStepsJSON {
	t.Helper()
	r := s.valid("GET", "/grabs/"+strconv.FormatInt(grab, 10)+"/steps", "")
	if r.Status != 200 {
		t.Fatalf("GET /grabs/%d/steps = %d %s", grab, r.Status, r.Body)
	}
	return decode[grabStepsJSON](t, r)
}

func TestAnImportedGrabTellsWhoGrabbedItWhenItDownloadedAndWhatTheImportMade(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	s.prober.set(goodProbe(), nil)
	grab, _ := s.download(t, map[string]string{"paddington.mkv": "the movie"})
	s.pass(t, jobs.Poll)
	s.pass(t, jobs.Import)

	st := s.steps(t, grab)

	if st.GrabID != grab || st.GrabbedBy == nil || *st.GrabbedBy != "by_search" || st.EndedAt == nil || st.BlocklistID != nil || st.StillWanted {
		t.Errorf("steps = %+v, want grabbed by the search pass, ended, not blocklisted and not Wanted", st)
	}
	if len(st.Files) != 1 || !strings.HasSuffix(st.Files[0].Path, ".mkv") || st.Files[0].Episode != nil {
		t.Errorf("files = %+v, want the one Movie file the Import wrote", st.Files)
	}
}

func TestAManualGrabIsRecordedAsGrabbedByHand(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	s.publish(t, goodRelease)
	rel := s.releases(t, s.hd).find(t, goodRelease)
	r := s.grab(s.hd, rel.ReleaseID, false)
	if r.Status != 200 && r.Status != 201 {
		t.Fatalf("grab = %d %s", r.Status, r.Body)
	}
	g := s.grabs(t, "").Items[0]

	if st := s.steps(t, g.GrabID); st.GrabbedBy == nil || *st.GrabbedBy != "by_hand" {
		t.Errorf("grabbed_by = %v, want by_hand", st.GrabbedBy)
	}
}

func TestARejectedGrabNamesItsBlocklistEntryAndThatTheMovieIsStillWanted(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	short := goodProbe()
	short.Duration = 5 * time.Minute
	s.prober.set(short, nil)
	s.publish(t, secondRelease)
	grab, _ := s.download(t, map[string]string{"paddington.mkv": "the movie"})
	s.pass(t, jobs.Poll)
	s.pass(t, jobs.Import)

	st := s.steps(t, grab)

	if st.BlocklistID == nil || st.BlocklistedAt == nil || len(st.Files) != 0 || st.EndedAt == nil {
		t.Fatalf("steps = %+v, want a Blocklist entry with its time, no files and an end", st)
	}
	if r := s.valid("DELETE", "/blocklist/"+strconv.FormatInt(*st.BlocklistID, 10), ""); r.Status != 204 {
		t.Fatalf("DELETE /blocklist = %d %s", r.Status, r.Body)
	}
	if st := s.steps(t, grab); st.BlocklistID != nil || st.BlocklistedAt != nil {
		t.Errorf("blocklist_id = %v at %v after the entry was removed, want none", st.BlocklistID, st.BlocklistedAt)
	}
}

func TestStepsOfAnUnknownGrabAreNotFound(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	if r := s.valid("GET", "/grabs/999/steps", ""); r.Status != 404 {
		t.Errorf("status = %d, want 404", r.Status)
	}
}

func TestAGrabsStepsCarryTheFactsParsedFromItsReleaseName(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	grab, _ := s.download(t, map[string]string{"paddington.mkv": "the movie"})

	r := s.valid("GET", "/grabs/"+strconv.FormatInt(grab, 10)+"/steps", "")
	if r.Status != 200 {
		t.Fatalf("GET steps = %d %s", r.Status, r.Body)
	}
	st := decode[struct {
		Quality       *string `json:"quality"`
		VideoCodec    *string `json:"video_codec"`
		HDR           *string `json:"hdr"`
		AudioCodec    *string `json:"audio_codec"`
		AudioChannels *string `json:"audio_channels"`
		ReleaseGroup  *string `json:"release_group"`
		Formats       []map[string]any
	}](t, r)

	// goodRelease is Paddington.2014.1080p.BluRay.x264-GRP: it names no HDR and no audio.
	if st.Quality == nil || *st.Quality != "Bluray-1080p" || st.VideoCodec == nil || *st.VideoCodec != "H.264" ||
		st.ReleaseGroup == nil || *st.ReleaseGroup != "GRP" || st.HDR != nil || st.AudioCodec != nil || st.AudioChannels != nil {
		t.Errorf("steps = quality %v, video %v, hdr %v, audio %v %v, group %v; want Bluray-1080p, H.264, GRP and no HDR or audio",
			deref(st.Quality), deref(st.VideoCodec), deref(st.HDR), deref(st.AudioCodec), deref(st.AudioChannels), deref(st.ReleaseGroup))
	}
	for _, f := range st.Formats {
		if _, ok := f["points"]; !ok {
			t.Errorf("format %v has no points", f)
		}
	}
}

func deref(p *string) string {
	if p == nil {
		return "<nil>"
	}
	return *p
}
