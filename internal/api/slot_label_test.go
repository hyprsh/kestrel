package api_test

import (
	"github.com/hyprsh/kestrel/internal/imports"
	"path/filepath"
	"strings"
	"testing"
)

const paddingtonFolder = "Paddington (2014) {tmdb-116149}"

func TestRenamingAStandardLabelRenamesItsFilesLogsItAndAdoptionStillReadsTheOldLabel(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	a.put(t, paddingtonFolder+"/"+paddingtonFolder+" - [Standard][Bluray-1080p][English][h264]-GRP.mkv", "x")
	a.commit(t, a.scan(t).Revision)
	id := a.titleIDOf(t, 116149)
	if got := a.titleFiles(t, id)["standard"]; !strings.Contains(filepath.Base(got), " - [Standard]") {
		t.Fatalf("files = %v", got)
	}

	// The dry run says what a rename touches and saves nothing.
	r := a.valid("PATCH", "/slots/standard?dry_run=true", `{"label":"Original"}`)
	got := decode[struct {
		Label        string `json:"label"`
		RenamesFiles *int   `json:"renames_files"`
	}](t, r)
	if r.Status != 200 || got.Label != "Original" || got.RenamesFiles == nil || *got.RenamesFiles != 1 {
		t.Fatalf("dry run = %d %s", r.Status, r.Body)
	}
	if s := slotList(t, a.browser); s[0].Label != "Standard" {
		t.Errorf("the dry run saved: %+v", s[0])
	}
	if r := a.do("PATCH", "/slots/standard?dry_run=true", `{"label":"4K"}`); r.Status != 422 {
		t.Errorf("a dry run with a taken label = %d %s", r.Status, r.Body)
	}

	r = a.valid("PATCH", "/slots/standard", `{"label":"Original"}`)
	if r.Status != 200 {
		t.Fatalf("PATCH = %d %s", r.Status, r.Body)
	}
	renamed := a.titleFiles(t, id)["standard"]
	if !strings.HasPrefix(filepath.Base(renamed), paddingtonFolder+" - [Original]") || !exists(t, renamed) {
		t.Errorf("file after the rename = %q", renamed)
	}
	events := a.valid("GET", "/events?kind=rename", "")
	if !strings.Contains(string(events.Body), `Renamed 1 file for the Slot label`) {
		t.Errorf("the Log lacks the rename: %s", events.Body)
	}

	// A fresh scan finds a file under the old and the new label alike in that Slot.
	a.put(t, "Hamlet (1996) {tmdb-10}/Hamlet (1996) {tmdb-10} - [Standard][Bluray-1080p][English][h264]-GRP.mkv", "x")
	a.put(t, "Dune (2021) {tmdb-11}/Dune (2021) {tmdb-11} - [Original][Bluray-1080p][English][h264]-GRP.mkv", "x")
	a.scan(t)
	for _, row := range a.rows(t, "") {
		for _, f := range row.Files {
			if f.Slot != "standard" {
				t.Errorf("%s adopts into %q", filepath.Base(f.Path), f.Slot)
			}
		}
	}
}

func TestAdoptionReadsTheLabelOnlyRightAfterTheFolderName(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	a.put(t, paddingtonFolder+"/"+paddingtonFolder+" - [4K][Remux-2160p][German]-GRP.mkv", "x")
	a.scan(t)
	f := a.rows(t, "matched")[0].Files[0]
	if f.Slot != "4k" || f.SlotGuessed {
		t.Errorf("a labelled file = %+v", f)
	}
}

func TestAnUnlabelledFileIsGuessedFromItsResolution(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	// The only bracket after the prefix is a language, so the file has no label and its Slot is a guess.
	a.put(t, paddingtonFolder+"/"+paddingtonFolder+" - [German][Bluray-1080p]-GRP.mkv", "x")
	a.scan(t)
	f := a.rows(t, "matched")[0].Files[0]
	if f.SlotGuessed != true || f.Slot != "standard" {
		t.Errorf("file = %+v", f)
	}
}

// The file names below are the ones Kestrel writes, so Adoption reads back what Import wrote.
func TestAdoptionReadsTheLabelOfAnEpisodeFileKestrelNamed(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	title := imports.Title{Name: "Breaking Bad", Year: 2008, TVDBID: 81189}
	name, err := imports.EpisodeFileName(title, "4K", imports.Episode{Season: 1, First: 1, Last: 1}, imports.FileFacts{}, ".mkv")
	if err != nil {
		t.Fatal(err)
	}
	// The content says 1080p: only the label can send it to the 4K Slot.
	a.putTV(t, bbFolder+"/Season 01/"+name, "standard")
	a.scan(t)
	row := a.rowOf(t, bbFolder)
	if len(row.Files) != 1 || row.Files[0].Slot != "4k" || row.Files[0].SlotGuessed {
		t.Errorf("files = %+v", row.Files)
	}
}

func TestAdoptionReadsTheLabelOfALooseMovieFileKestrelNamed(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	title := imports.Title{Name: "Paddington", Year: 2014, TMDBID: 116149}
	name, err := imports.MovieFileName(title, "4K", imports.FileFacts{}, ".mkv")
	if err != nil {
		t.Fatal(err)
	}
	a.put(t, name, "x")
	a.scan(t)
	rows := a.rows(t, "matched")
	if len(rows) != 1 || len(rows[0].Files) != 1 || rows[0].Files[0].Slot != "4k" || rows[0].Files[0].SlotGuessed {
		t.Errorf("rows = %+v", rows)
	}
}
