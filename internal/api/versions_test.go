package api_test

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/jobs"
	"github.com/hyprsh/kestrel/internal/probe"
)

type versionJSON struct {
	ID      int64  `json:"id"`
	Slot    string `json:"slot"`
	Profile string `json:"profile"`
	State   string `json:"state"`
	File    *struct {
		Path   string `json:"path"`
		Score  *int   `json:"score"`
		Misfit bool   `json:"misfit"`
	} `json:"file"`
}

// addMovie adds Paddington under the given Versions and returns the Title's id and its Versions by Slot.
func (s *search) addMovie(t *testing.T, versions string) {
	t.Helper()
	r := s.valid("POST", "/titles", `{"kind":"movie","tmdb_id":116149,"versions":[`+versions+`]}`)
	if r.Status != 201 {
		t.Fatalf("POST /titles = %d %s", r.Status, r.Body)
	}
	created := decode[titleJSON](t, r)
	s.title = created.ID
	for _, v := range created.Versions {
		switch v.Slot {
		case "standard":
			s.hd = v.ID
		case "4k":
			s.uhd = v.ID
		}
	}
}

func (s search) version(t *testing.T, id int64) versionJSON {
	t.Helper()
	d := decode[struct {
		Versions []versionJSON `json:"versions"`
	}](t, s.valid("GET", fmt.Sprintf("/titles/%d", s.title), ""))
	for _, v := range d.Versions {
		if v.ID == id {
			return v
		}
	}
	t.Fatalf("Title %d has no Version %d", s.title, id)
	return versionJSON{}
}

type searchStateRow struct{ missing, upgrade string }

func (s search) searchState(t *testing.T, version int64) searchStateRow {
	t.Helper()
	var r searchStateRow
	err := s.in.st.Read().QueryRow(`SELECT COALESCE(next_missing_at, ''), COALESCE(next_upgrade_at, '') FROM search_state WHERE version_id = ?`, version).Scan(&r.missing, &r.upgrade)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestAddingUHDToATitleWithHDCreatesAVersionAndSearchesItAtOnce(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	s.addMovie(t, `{"slot":"standard","profile":"hd-primary"}`)
	s.publish(t, uhdRelease)

	r := s.valid("POST", fmt.Sprintf("/titles/%d/versions", s.title), `{"slot":"4k","profile":"4k-primary"}`)

	if r.Status != 201 {
		t.Fatalf("POST /titles/{id}/versions = %d %s", r.Status, r.Body)
	}
	v := decode[versionJSON](t, r)
	if v.Slot != "4k" || v.Profile != "4k-primary" || v.State != "wanted" {
		t.Errorf("version = %+v", v)
	}
	s.pass(t, jobs.Search)
	var grabbed bool
	for _, it := range s.queue(t) {
		grabbed = grabbed || (it.VersionID != nil && *it.VersionID == v.ID && it.ReleaseName == uhdRelease)
	}
	if !grabbed {
		t.Errorf("the new 4K Version was not searched: queue = %+v", s.queue(t))
	}
}

func TestAddingToATakenSlotOrWithAWrongProfileIsRefused(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	s.addMovie(t, `{"slot":"standard","profile":"hd-primary"}`)
	path := fmt.Sprintf("/titles/%d/versions", s.title)

	if r := s.valid("POST", path, `{"slot":"standard","profile":"any-primary"}`); r.Status != 409 {
		t.Errorf("taken Slot = %d %s, want 409", r.Status, r.Body)
	}
	if r := s.valid("POST", path, `{"slot":"4k","profile":"hd-primary"}`); r.Status != 422 {
		t.Errorf("wrong Profile = %d %s, want 422", r.Status, r.Body)
	}
	if r := s.valid("POST", "/titles/9999/versions", `{"slot":"4k","profile":"4k-primary"}`); r.Status != 404 {
		t.Errorf("unknown Title = %d %s, want 404", r.Status, r.Body)
	}
}

func TestSwitchingHDToAnyAndBackRescoresTheFileWithoutRenamingAndSearchesAtOnce(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	s.addMovie(t, `{"slot":"standard","profile":"hd-primary"}`)
	s.prober.set(goodProbe(), nil)
	s.download(t, map[string]string{"paddington.mkv": "the movie"})
	s.pass(t, jobs.Poll)
	s.pass(t, jobs.Import)
	before := s.version(t, s.hd)
	if before.File == nil {
		t.Fatal("the Version holds no file")
	}
	s.in.clock.Advance(3 * time.Hour)

	r := s.valid("PATCH", fmt.Sprintf("/versions/%d", s.hd), `{"profile":"any-primary"}`)

	if r.Status != 200 {
		t.Fatalf("PATCH /versions/{id} = %d %s", r.Status, r.Body)
	}
	after := s.version(t, s.hd)
	if after.Profile != "any-primary" || after.State != "filled" {
		t.Errorf("version = %+v, want Any and still filled: an HD file fits Any", after)
	}
	if after.File == nil || after.File.Path != before.File.Path || after.File.Misfit {
		t.Errorf("file = %+v, want the same path and no misfit", after.File)
	}
	if _, err := os.Stat(before.File.Path); err != nil {
		t.Errorf("the file was renamed or removed: %v", err)
	}
	now := s.in.clock.Now().UTC().Format(time.RFC3339)
	if st := s.searchState(t, s.hd); st.missing != now || st.upgrade != now {
		t.Errorf("search state = %+v, want both due at %s", st, now)
	}

	if r := s.valid("PATCH", fmt.Sprintf("/versions/%d", s.hd), `{"profile":"hd-primary"}`); r.Status != 200 {
		t.Fatalf("switching back = %d %s", r.Status, r.Body)
	}
	if back := s.version(t, s.hd); back.Profile != "hd-primary" || back.State != "filled" {
		t.Errorf("version = %+v, want HD and still filled", back)
	}
}

func TestAFileThatNoLongerFitsAfterASwitchMakesTheVersionWantedAndAnyFittingReleaseReplacesIt(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	s.addMovie(t, `{"slot":"standard","profile":"hd-original"}`)
	s.prober.set(goodProbe(), nil)
	s.download(t, map[string]string{"paddington.mkv": "the movie"})
	s.pass(t, jobs.Poll)
	s.pass(t, jobs.Import)
	old := s.version(t, s.hd)
	if old.File == nil || old.State != "filled" {
		t.Fatalf("version = %+v", old)
	}
	// The household now wants German; the English file is no good for the Primary-Language Profile.
	s.valid("PATCH", "/settings", `{"language_region":{"primary_language":"de"}}`)
	s.trashPass(t)

	r := s.valid("PATCH", fmt.Sprintf("/versions/%d", s.hd), `{"profile":"hd-primary"}`)

	if r.Status != 200 {
		t.Fatalf("PATCH /versions/{id} = %d %s", r.Status, r.Body)
	}
	got := s.version(t, s.hd)
	if got.State != "wanted" || got.File == nil || !got.File.Misfit {
		t.Fatalf("version = %+v, want Wanted with a misfit file", got)
	}

	const german = "Paddington.2014.GERMAN.1080p.BluRay.x264-GRP"
	s.publish(t, german)
	s.pass(t, jobs.Search)
	var jobID string
	for _, j := range s.jobs(t) {
		jobID = j.ClientID
	}
	if jobID == "" {
		t.Fatal("the misfit Version was not searched")
	}
	dir := filepath.Join(t.TempDir(), german)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "paddington.mkv"), []byte("the german movie"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := s.sab.Complete(jobID, dir); err != nil {
		t.Fatal(err)
	}
	de := goodProbe()
	de.Audio = []probe.AudioTrack{{Index: 1, Codec: "eac3", Channels: 6, Language: "deu", Default: true}}
	s.prober.set(de, nil)
	s.pass(t, jobs.Poll)
	s.pass(t, jobs.Import)

	replaced := s.version(t, s.hd)
	if replaced.File == nil || replaced.File.Misfit || replaced.File.Path == old.File.Path || replaced.State != "filled" {
		t.Errorf("version = %+v, want the German file in place of the English one", replaced)
	}
	if _, err := os.Stat(old.File.Path); !os.IsNotExist(err) {
		t.Errorf("the misfit file is still on disk: %v", err)
	}
}

func TestRemovingAVersionLeavesTheFileUnlessAskedToDeleteIt(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		query      string
		wantOnDisk bool
	}{{"", true}, {"?delete_files=false", true}, {"?delete_files=true", false}} {
		t.Run("delete"+tc.query, func(t *testing.T) {
			t.Parallel()
			s := newSearchBare(t)
			s.addMovie(t, `{"slot":"standard","profile":"hd-primary"},{"slot":"4k","profile":"4k-primary"}`)
			s.prober.set(goodProbe(), nil)
			s.download(t, map[string]string{"paddington.mkv": "the movie"})
			s.pass(t, jobs.Poll)
			s.pass(t, jobs.Import)
			path := s.version(t, s.hd).File.Path

			r := s.valid("DELETE", fmt.Sprintf("/versions/%d%s", s.hd, tc.query), "")

			if r.Status != 204 {
				t.Fatalf("DELETE = %d %s", r.Status, r.Body)
			}
			if _, err := os.Stat(path); (err == nil) != tc.wantOnDisk {
				t.Errorf("file on disk = %v, want %v", err == nil, tc.wantOnDisk)
			}
			d := decode[titleJSON](t, s.valid("GET", fmt.Sprintf("/titles/%d", s.title), ""))
			if len(d.Versions) != 1 || d.Versions[0].Slot != "4k" {
				t.Errorf("versions = %+v, want only 4K", d.Versions)
			}
			if r := s.valid("DELETE", fmt.Sprintf("/versions/%d", s.hd), ""); r.Status != 404 {
				t.Errorf("second DELETE = %d, want 404", r.Status)
			}
		})
	}
}

func TestRemovingATitleLeavesItsFilesUnlessAskedToDeleteThem(t *testing.T) {
	t.Parallel()
	for _, deleteFiles := range []bool{false, true} {
		t.Run(fmt.Sprintf("delete_files=%v", deleteFiles), func(t *testing.T) {
			t.Parallel()
			s := newSearchBare(t)
			s.addMovie(t, `{"slot":"standard","profile":"hd-primary"}`)
			s.prober.set(goodProbe(), nil)
			s.download(t, map[string]string{"paddington.mkv": "the movie"})
			s.pass(t, jobs.Poll)
			s.pass(t, jobs.Import)
			path := s.version(t, s.hd).File.Path

			r := s.valid("DELETE", fmt.Sprintf("/titles/%d?delete_files=%v", s.title, deleteFiles), "")

			if r.Status != 204 {
				t.Fatalf("DELETE = %d %s", r.Status, r.Body)
			}
			if g := s.valid("GET", fmt.Sprintf("/titles/%d", s.title), ""); g.Status != 404 {
				t.Errorf("GET after DELETE = %d, want 404", g.Status)
			}
			_, err := os.Stat(path)
			if (err == nil) == deleteFiles {
				t.Errorf("file on disk = %v with delete_files=%v", err == nil, deleteFiles)
			}
			if deleteFiles {
				if _, err := os.Stat(filepath.Dir(path)); !os.IsNotExist(err) {
					t.Errorf("the emptied Title folder is still there: %v", err)
				}
			}
		})
	}
}

func TestRemovingAVersionCancelsItsActiveDownload(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	s.addMovie(t, `{"slot":"standard","profile":"hd-primary"}`)
	s.publish(t, goodRelease)
	s.pass(t, jobs.Search)
	if len(s.queue(t)) != 1 {
		t.Fatalf("queue = %+v", s.queue(t))
	}

	if r := s.valid("DELETE", fmt.Sprintf("/versions/%d", s.hd), ""); r.Status != 204 {
		t.Fatalf("DELETE = %d %s", r.Status, r.Body)
	}

	if q := s.queue(t); len(q) != 0 {
		t.Errorf("queue = %+v, want empty", q)
	}
	if j := s.jobs(t); len(j) != 0 {
		t.Errorf("the client still holds %+v", j)
	}
}
