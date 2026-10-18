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

func TestCommittingRenamesFilesInPlaceWithTheirSubtitlesAndFillsTheVersions(t *testing.T) {
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
	folder := filepath.Join(a.movies, "Paddington (2014) {tmdb-116149}")
	files := a.titleFiles(t, id)
	got := files["hd"]
	if filepath.Dir(got) != folder || !strings.HasPrefix(filepath.Base(got), "Paddington (2014) {tmdb-116149} - [HD]") || !exists(t, got) {
		t.Fatalf("HD file = %q (all %v)", got, files)
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
	if rows := a.rows(t, ""); len(rows) != 0 {
		t.Errorf("plan not cleared: %+v", rows)
	}
}
