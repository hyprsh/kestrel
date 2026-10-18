package api_test

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

type cleanupPreviewJSON struct {
	PreviewID  string `json:"preview_id"`
	Categories []struct {
		Key           string `json:"key"`
		DefaultTicked bool   `json:"default_ticked"`
		Count         int    `json:"count"`
		Size          int64  `json:"size"`
		Files         []struct {
			Path string `json:"path"`
			Size int64  `json:"size"`
		} `json:"files"`
	} `json:"categories"`
}

func (p cleanupPreviewJSON) category(key string) (int, bool, bool) {
	for _, c := range p.Categories {
		if c.Key == key {
			return c.Count, c.DefaultTicked, true
		}
	}
	return 0, false, false
}

// adoptedFolder adopts one Movie and returns its folder and held file.
func adoptedFolder(t *testing.T) (adopting, int64, string, string) {
	t.Helper()
	a := newAdopting(t)
	a.put(t, "Paddington.2014.1080p.BluRay.x264-GRP/Paddington.2014.1080p.BluRay.x264-GRP.mkv", "movie")
	a.commit(t, a.scan(t).Revision)
	id := a.titleIDOf(t, 116149)
	held := a.titleFiles(t, id)["standard"]
	return a, id, filepath.Dir(held), held
}

func TestCleanUpListsUnmanagedFilesByCategoryAndDeletesOnlyTheTickedOnes(t *testing.T) {
	a, id, dir, held := adoptedFolder(t)
	junk := filepath.Join(dir, "release.nfo")
	sample := filepath.Join(dir, "Sample", "sample.mkv")
	orphan := filepath.Join(dir, "gone.en.srt")
	artwork := filepath.Join(dir, "poster.jpg")
	rival := filepath.Join(dir, "Other.Cut.2014.mkv")
	empty := filepath.Join(dir, "Empty")
	for _, p := range []string{junk, sample, orphan, artwork, rival} {
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(empty, 0o755); err != nil {
		t.Fatal(err)
	}
	stray := a.put(t, "Not Tracked (1999)/stray.nfo", "x")

	pv := decode[cleanupPreviewJSON](t, a.valid("POST", "/cleanup/preview", fmt.Sprintf(`{"title_ids":[%d]}`, id)))

	for _, want := range []struct {
		key    string
		ticked bool
	}{{"junk", true}, {"samples", true}, {"orphaned_subtitles", true}, {"empty_folders", true}, {"artwork", false}, {"unmanaged_videos", false}} {
		n, ticked, ok := pv.category(want.key)
		if !ok || n == 0 || ticked != want.ticked {
			t.Errorf("category %s = %d ticked %v present %v, want ticked %v", want.key, n, ticked, ok, want.ticked)
		}
	}
	for _, c := range pv.Categories {
		for _, f := range c.Files {
			if f.Path == held || f.Path == stray {
				t.Errorf("%s lists %s", c.Key, f.Path)
			}
		}
	}

	r := a.valid("POST", "/cleanup/run", fmt.Sprintf(`{"preview_id":%q,"categories":["junk","samples","orphaned_subtitles","empty_folders"]}`, pv.PreviewID))
	if r.Status != 202 {
		t.Fatalf("run = %d %s", r.Status, r.Body)
	}
	for _, gone := range []string{junk, sample, filepath.Dir(sample), orphan, empty} {
		if exists(t, gone) {
			t.Errorf("%s survived", gone)
		}
	}
	for _, kept := range []string{held, artwork, rival, stray} {
		if !exists(t, kept) {
			t.Errorf("%s was deleted", kept)
		}
	}
	if r := a.valid("POST", "/cleanup/run", `{"preview_id":"nope","categories":["junk"]}`); r.Status != 404 {
		t.Errorf("unknown preview = %d", r.Status)
	}
}

func TestCleanUpWithoutATitleCoversEveryTrackedFolderAndHonoursUntickedFiles(t *testing.T) {
	a, _, dir, _ := adoptedFolder(t)
	keep, drop := filepath.Join(dir, "keep.txt"), filepath.Join(dir, "drop.txt")
	for _, p := range []string{keep, drop} {
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	pv := decode[cleanupPreviewJSON](t, a.valid("POST", "/cleanup/preview", `{}`))
	if n, _, _ := pv.category("junk"); n != 2 {
		t.Fatalf("junk = %d", n)
	}
	r := a.valid("POST", "/cleanup/run", fmt.Sprintf(`{"preview_id":%q,"categories":["junk"],"exclude":[%q]}`, pv.PreviewID, keep))
	if r.Status != 202 || !exists(t, keep) || exists(t, drop) {
		t.Errorf("run = %d; keep exists %v, drop exists %v", r.Status, exists(t, keep), exists(t, drop))
	}
}

func TestCleanUpNeverDeletesAFileAVersionHolds(t *testing.T) {
	a, id, _, held := adoptedFolder(t)
	pv := decode[cleanupPreviewJSON](t, a.valid("POST", "/cleanup/preview", fmt.Sprintf(`{"title_ids":[%d]}`, id)))
	r := a.valid("POST", "/cleanup/run", fmt.Sprintf(`{"preview_id":%q,"categories":["junk","samples","unmanaged_videos"]}`, pv.PreviewID))
	if r.Status != 202 || !exists(t, held) {
		t.Errorf("run = %d, held exists %v", r.Status, exists(t, held))
	}
}

func TestCleanUpNamingAnUnknownTitleIs404(t *testing.T) {
	a, id, _, _ := adoptedFolder(t)
	if r := a.do("POST", "/cleanup/preview", fmt.Sprintf(`{"title_ids":[%d,%d]}`, id, id+1000)); r.Status != 404 {
		t.Errorf("status = %d, want 404", r.Status)
	}
}
