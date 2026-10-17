package library_test

import (
	"context"
	"testing"

	"github.com/hyprsh/kestrel/internal/library"
)

func newEpisodeFile(version int64, path string, score int) library.NewFile {
	return library.NewFile{VersionID: version, Path: path, Size: 1, ReleaseName: "rel", Score: score}
}

func TestAnEpisodeFileFillsItsEpisodesInTheHeatMapAndSetsTheSeriesFolder(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t)
	id := addShow(t, lib, library.MonitorAll)
	d, _ := lib.Get(ctx, id, library.View{Country: "US", Now: now})
	ver := d.Versions[0].ID
	eps, _ := lib.Episodes(ctx, id, library.View{Country: "US", Now: now})

	replaced, err := lib.ReplaceEpisodeFile(ctx, id, "Breaking Bad (2008) {tvdb-81189}", newEpisodeFile(ver, "/tv/a.mkv", 10), []int64{eps[1].ID, eps[2].ID})
	if err != nil || len(replaced) != 0 {
		t.Fatalf("replaced = %+v, %v", replaced, err)
	}

	got, _ := lib.Episodes(ctx, id, library.View{Country: "US", Now: now})
	for _, ep := range got[1:3] {
		if c := ep.Cells[1]; c == nil || c.State != library.Filled || c.Score == nil || *c.Score != 10 {
			t.Errorf("episode %d cell = %+v", ep.Number, c)
		}
	}
	if c := got[3].Cells[1]; c.State == library.Filled {
		t.Errorf("an episode nothing was imported for is %v", c.State)
	}
	after, _ := lib.Get(ctx, id, library.View{Country: "US", Now: now})
	if after.Folder != "Breaking Bad (2008) {tvdb-81189}" {
		t.Errorf("folder = %q", after.Folder)
	}
}

func TestANewEpisodeFileReplacesTheOldOneOnlyOnceItHoldsNoEpisodeAnymore(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t)
	id := addShow(t, lib, library.MonitorAll)
	d, _ := lib.Get(ctx, id, library.View{Country: "US", Now: now})
	ver := d.Versions[0].ID
	eps, _ := lib.Episodes(ctx, id, library.View{Country: "US", Now: now})
	if _, err := lib.ReplaceEpisodeFile(ctx, id, "F", newEpisodeFile(ver, "/tv/double.mkv", 5), []int64{eps[1].ID, eps[2].ID}); err != nil {
		t.Fatal(err)
	}

	replaced, err := lib.ReplaceEpisodeFile(ctx, id, "F", newEpisodeFile(ver, "/tv/e1.mkv", 20), []int64{eps[1].ID})
	if err != nil || len(replaced) != 0 {
		t.Fatalf("the double file still holds episode 2: replaced = %+v, %v", replaced, err)
	}
	replaced, err = lib.ReplaceEpisodeFile(ctx, id, "F", newEpisodeFile(ver, "/tv/e2.mkv", 20), []int64{eps[2].ID})
	if err != nil || len(replaced) != 1 || replaced[0].Path != "/tv/double.mkv" {
		t.Fatalf("replaced = %+v, %v, want the double file", replaced, err)
	}
}

func TestTheDatabaseRefusesASecondFileForTheSameVersionAndEpisode(t *testing.T) {
	ctx := context.Background()
	lib, st := newLibrary(t)
	id := addShow(t, lib, library.MonitorAll)
	d, _ := lib.Get(ctx, id, library.View{Country: "US", Now: now})
	ver := d.Versions[0].ID
	eps, _ := lib.Episodes(ctx, id, library.View{Country: "US", Now: now})
	if _, err := lib.ReplaceEpisodeFile(ctx, id, "F", newEpisodeFile(ver, "/tv/a.mkv", 5), []int64{eps[1].ID}); err != nil {
		t.Fatal(err)
	}

	res, err := st.Write().ExecContext(ctx, `INSERT INTO files (version_id, path, size, release_name, imported_at) VALUES (?, '/tv/b.mkv', 1, 'r', '2026-01-01T00:00:00Z')`, ver)
	if err != nil {
		t.Fatal(err)
	}
	fid, _ := res.LastInsertId()
	_, err = st.Write().ExecContext(ctx, `INSERT INTO file_episodes (file_id, version_id, episode_id) VALUES (?, ?, ?)`, fid, ver, eps[1].ID)
	if err == nil {
		t.Error("two files for one (Version, episode) were accepted")
	}
}
