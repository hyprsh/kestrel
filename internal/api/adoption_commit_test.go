package api_test

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func exists(t *testing.T, path string) bool {
	t.Helper()
	_, err := os.Lstat(path)
	return err == nil
}

// titleFiles maps each Slot of a Title to the path of the file its Version holds.
func (a adopting) titleFiles(t *testing.T, id int64) map[string]string {
	t.Helper()
	d := decode[struct {
		Versions []struct {
			Slot string `json:"slot"`
			File *struct {
				Path string `json:"path"`
			} `json:"file"`
		} `json:"versions"`
	}](t, a.valid("GET", fmt.Sprintf("/titles/%d", id), ""))
	out := map[string]string{}
	for _, v := range d.Versions {
		if v.File != nil {
			out[v.Slot] = v.File.Path
		}
	}
	return out
}

func (a adopting) titleIDOf(t *testing.T, tmdb int) int64 {
	t.Helper()
	list := decode[struct {
		Items []struct {
			ID int64 `json:"id"`
		} `json:"items"`
	}](t, a.valid("GET", "/titles?limit=10000", ""))
	for _, it := range list.Items {
		d := decode[titleJSON](t, a.valid("GET", fmt.Sprintf("/titles/%d", it.ID), ""))
		if d.TMDBID != nil && *d.TMDBID == tmdb {
			return it.ID
		}
	}
	t.Fatalf("no Title with TMDB id %d", tmdb)
	return 0
}

// The plan's Scores and misfit marks are those of the scan. A commit stores what
// the active snapshot and the household's settings say now.
func TestCommittingStoresTheScoresOfNowNotOfTheScan(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	a.put(t, "Paddington.2014.1080p.BluRay.x264-GRP/Paddington.2014.1080p.BluRay.x264-GRP.mkv", "movie")
	plan := a.scan(t)
	if r := a.valid("PATCH", "/settings", `{"language_region":{"primary_language":"de"}}`); r.Status != 200 {
		t.Fatalf("PATCH /settings = %d %s", r.Status, r.Body)
	}

	a.commit(t, plan.Revision)

	d := decode[struct {
		Versions []struct {
			File *struct {
				Misfit bool `json:"misfit"`
			} `json:"file"`
		} `json:"versions"`
	}](t, a.valid("GET", fmt.Sprintf("/titles/%d", a.titleIDOf(t, 116149)), ""))
	if len(d.Versions) != 1 || d.Versions[0].File == nil || !d.Versions[0].File.Misfit {
		t.Fatalf("versions = %+v, want the English file a misfit for a German household", d.Versions)
	}
}

func TestCommittingRenamesFilesInPlaceWithTheirSubtitlesAndFillsTheVersions(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	old := "Paddington.2014.1080p.BluRay.x264-GRP"
	video := a.put(t, old+"/"+old+".mkv", "movie")
	a.put(t, old+"/"+old+".en.srt", "english")
	a.put(t, old+"/"+old+".de.forced.srt", "forced german")
	a.put(t, old+"/"+old+".srt", "unreadable language")
	a.put(t, old+"/"+old+".nfo", "junk")
	plan := a.scan(t)

	done := a.commit(t, plan.Revision)

	if done.State != "idle" || done.Result == nil || done.Result.Adopted != 1 || done.Result.Failed != 0 {
		t.Fatalf("after commit = %+v", done)
	}
	id := a.titleIDOf(t, 116149)
	if len(done.Result.TitleIDs) != 1 || done.Result.TitleIDs[0] != id {
		t.Errorf("result title_ids = %v, want [%d]", done.Result.TitleIDs, id)
	}
	folder := filepath.Join(a.movies, "Paddington (2014) {tmdb-116149}")
	files := a.titleFiles(t, id)
	got := files["standard"]
	if filepath.Dir(got) != folder || !strings.HasPrefix(filepath.Base(got), "Paddington (2014) {tmdb-116149} - [Standard]") || !exists(t, got) {
		t.Fatalf("Standard file = %q (all %v)", got, files)
	}
	if exists(t, video) {
		t.Error("the old file is still where it was")
	}
	stem := strings.TrimSuffix(got, ".mkv")
	for _, sub := range []string{".eng.srt", ".deu.forced.srt", ".und.srt"} {
		if !exists(t, stem+sub) {
			t.Errorf("missing subtitle %s next to %s", sub, filepath.Base(got))
		}
	}
	if !exists(t, filepath.Join(a.movies, old, old+".nfo")) {
		t.Error("the .nfo was touched")
	}
	if rows := a.kept(t); len(rows) != 1 || rows[0].Outcome == nil || *rows[0].Outcome != "adopted" {
		t.Errorf("rows after the commit = %+v, want the one row kept as adopted", rows)
	}
}

func TestAdoptionLeavesTitlesInTheRootFolderTheyWereFoundIn(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	second := filepath.Join(a.data, "media", "more-movies")
	mkdirs(t, second)
	a.valid("PATCH", "/settings", fmt.Sprintf(`{"root_folders":{"movies":[%q,%q]}}`, a.movies, second))
	a.put(t, "Paddington.2014.1080p.BluRay.x264-GRP/Paddington.2014.1080p.BluRay.x264-GRP.mkv", "pad") // in the first folder
	lost := filepath.Join(second, "The Lost Film (2020) [tmdbid-77]", "lost.film.mkv")                 // in the second
	mkdirs(t, filepath.Dir(lost))
	if err := os.WriteFile(lost, []byte("lost"), 0o644); err != nil {
		t.Fatal(err)
	}

	plan := a.scan(t)
	if done := a.commit(t, plan.Revision); done.Result == nil || done.Result.Adopted != 2 {
		t.Fatalf("after commit = %+v", done)
	}

	for tmdb, want := range map[int]string{116149: a.movies, 77: second} {
		got := decode[titleJSON](t, a.valid("GET", fmt.Sprintf("/titles/%d", a.titleIDOf(t, tmdb)), ""))
		if got.RootFolder != want {
			t.Errorf("tmdb %d: root folder = %q, want %q where it was found", tmdb, got.RootFolder, want)
		}
	}
}
