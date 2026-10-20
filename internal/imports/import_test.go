package imports_test

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/hyprsh/kestrel/internal/slot"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/health"
	"github.com/hyprsh/kestrel/internal/imports"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/probe"
	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
	"github.com/hyprsh/kestrel/internal/settings"
	"github.com/hyprsh/kestrel/internal/store"
	"github.com/hyprsh/kestrel/internal/store/storetest"
)

const (
	hdName      = "Paddington.2014.1080p.BluRay.x264-GRP"
	movieFolder = "Paddington (2014) {tmdb-116149}"
)

// fakeProber answers by file base name; an unknown file is unreadable.
type fakeProber struct {
	info         map[string]probe.Info
	notInstalled bool
}

func (f *fakeProber) Probe(_ context.Context, path string) (probe.Info, error) {
	if f.notInstalled {
		return probe.Info{}, probe.ErrNotInstalled
	}
	if i, ok := f.info[filepath.Base(path)]; ok {
		return i, nil
	}
	return probe.Info{}, errors.New("unreadable")
}

func good() probe.Info {
	return probe.Info{
		Size: 8 << 30, Duration: 95 * time.Minute, HasVideo: true, Width: 1920, Height: 1080, VideoCodec: "h264",
		Audio: []probe.AudioTrack{{Index: 1, Codec: "eac3", Channels: 6, Language: "eng", Default: true}},
	}
}

type rig struct {
	svc      *imports.Service
	health   *health.Service
	lib      *library.Service
	prober   *fakeProber
	root     string // the Movies root folder
	downs    string // where the client's finished jobs are
	titleID  int64
	versions map[slot.Slot]int64
	hook     func(step string) error
	notes    recorder
	// crossDevice makes hardlinks fail with EXDEV, as across a filesystem boundary.
	crossDevice bool
	// crossDeviceRename makes folder renames fail with EXDEV.
	crossDeviceRename bool
	// failMove makes the database write of a Move fail.
	failMove bool
	// log is the Log, blocks the Blocklist.
	log    eventLog
	blocks blocklist
	// undeletable are paths whose deletion fails, as on a read-only disk.
	undeletable map[string]bool
}

// remove is os.Remove, failing for the undeletable paths.
func (r *rig) remove(path string) error {
	if r.undeletable[path] {
		return &os.PathError{Op: "remove", Path: path, Err: syscall.EROFS}
	}
	return os.Remove(path)
}

// renames is the library with a Move's database write that can be made to fail.
type renames struct {
	*library.Service
	r *rig
}

func (s renames) ApplyMove(ctx context.Context, titleID int64, root string, moves []library.FileMove) error {
	if s.r.failMove {
		return errors.New("database is locked")
	}
	return s.Service.ApplyMove(ctx, titleID, root, moves)
}

func (r *rig) renameDir(oldpath, newpath string) error {
	if r.crossDeviceRename {
		return &os.LinkError{Op: "rename", Old: oldpath, New: newpath, Err: syscall.EXDEV}
	}
	return os.Rename(oldpath, newpath)
}

func newRig(t *testing.T) *rig {
	t.Helper()
	ctx := context.Background()
	st, err := store.Open(ctx, store.Options{Dir: storetest.Dir(t)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	now := time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)
	r := &rig{prober: &fakeProber{info: map[string]probe.Info{}}, root: t.TempDir(), downs: t.TempDir(), versions: map[slot.Slot]int64{}}
	r.lib = library.New(st, func() time.Time { return now })
	r.titleID, err = r.lib.AddMovie(ctx, library.AddMovie{
		Details: metadata.MovieDetails{
			TMDBID: 116149, IMDbID: "tt1109624", Title: "Paddington", OriginalTitle: "Paddington", OriginalLanguage: "en", Year: 2014, Runtime: 95,
		},
		PrimaryLanguage: "en", RootFolder: r.root,
		Versions: []library.VersionSpec{{Slot: slot.Standard, Profile: "hd-primary"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	d, err := r.lib.Get(ctx, r.titleID, library.View{Country: "US", Now: now})
	if err != nil {
		t.Fatal(err)
	}
	for _, v := range d.Versions {
		r.versions[v.Slot] = v.ID
	}
	r.health = health.New(health.Deps{Store: st, Clock: func() time.Time { return now }})
	svc, err := imports.New(imports.Deps{
		Library: r.lib, Renames: renames{r.lib, r}, Rename: r.renameDir, Profiles: profiles.New(st, settings.New(st)), Prober: r.prober, Clock: func() time.Time { return now }, Health: r.health, FolderChanged: r.notes.changed,
		History: &r.log, Blocklist: &r.blocks, Remove: r.remove,
		Link: func(src, dst string) error {
			if r.crossDevice {
				return &os.LinkError{Op: "link", Old: src, New: dst, Err: syscall.EXDEV}
			}
			return os.Link(src, dst)
		},
		Step: func(s string) error {
			if r.hook != nil {
				return r.hook(s)
			}
			return nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	r.svc = svc
	return r
}

// job writes a finished download (name -> bytes, paths relative to the job's folder) and
// returns the Grab to import.
func (r *rig) job(t *testing.T, id int64, files map[string]string) imports.Grab {
	t.Helper()
	dir := filepath.Join(r.downs, hdName)
	for name, body := range files {
		p := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	parsed, err := release.Parse(hdName, release.KindMovie)
	if err != nil {
		t.Fatal(err)
	}
	pj, _ := json.Marshal(parsed)
	return imports.Grab{
		ID: id, TitleID: r.titleID, VersionID: r.versions[slot.Standard], ReleaseName: hdName, Parsed: pj,
		SourcePath: dir, CanRemove: true,
	}
}

func (r *rig) version(t *testing.T) library.Version {
	t.Helper()
	d, err := r.lib.Get(context.Background(), r.titleID, library.View{Country: "US", Now: time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)})
	if err != nil {
		t.Fatal(err)
	}
	return d.Versions[0]
}

func tree(t *testing.T, dir string) []string {
	t.Helper()
	var out []string
	_ = filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			rel, _ := filepath.Rel(dir, p)
			out = append(out, rel)
		}
		return nil
	})
	slices.Sort(out)
	return out
}

func TestImportPlacesOnlyTheMainVideoAndWantedSubtitlesUnderTheFixedScheme(t *testing.T) {
	r := newRig(t)
	g := r.job(t, 1, map[string]string{
		"paddington.mkv":              "video",
		"paddington.en.srt":           "english subs",
		"paddington.de.srt":           "german subs",
		"paddington.fr.srt":           "french subs",
		"paddington.nfo":              "junk",
		"RARBG.txt":                   "junk",
		"Sample/sample.mkv":           "sample",
		"paddington-sample.mkv":       "sample",
		"Extras/Making of/making.mkv": "extra",
		"paddington-trailer.mkv":      "trailer",
		"Featurettes/featurette.mkv":  "extra",
		"Subs/2_English.srt":          "more english",
		"Subs/3_Klingon.srt":          "klingon",
	})
	for _, n := range []string{"paddington.mkv", "paddington-sample.mkv", "sample.mkv", "making.mkv", "paddington-trailer.mkv", "featurette.mkv"} {
		r.prober.info[n] = good()
	}
	// The main video is the largest by size on disk.
	if err := os.WriteFile(filepath.Join(g.SourcePath, "paddington.mkv"), []byte(strings.Repeat("v", 5000)), 0o644); err != nil {
		t.Fatal(err)
	}

	res := r.svc.Import(context.Background(), g)

	if res.Status != imports.Imported {
		t.Fatalf("result = %+v", res)
	}
	files := tree(t, r.root)
	var names []string
	for _, f := range files {
		if !strings.HasPrefix(f, movieFolder+string(filepath.Separator)+movieFolder+" - ") {
			t.Errorf("%q is not under the Movie folder with the scheme's name", f)
		}
		names = append(names, strings.TrimPrefix(f, movieFolder+string(filepath.Separator)))
	}
	var video, subs int
	for _, n := range names {
		switch {
		case strings.HasSuffix(n, ".mkv"):
			video++
		case strings.HasSuffix(n, ".eng.srt"), strings.HasSuffix(n, ".eng.2.srt"):
			subs++
		default:
			t.Errorf("unexpected file %q in the Title folder", n)
		}
	}
	if video != 1 || subs != 2 {
		t.Errorf("files = %v, want one video and the two English subtitles", files)
	}
	v := r.version(t)
	if v.State != library.Filled || v.File == nil || v.File.Score == nil || v.File.ParsedRelease == "" || v.File.Probe == "" || v.File.ReleaseName != hdName {
		t.Errorf("Version = %+v file %+v", v, v.File)
	}
	if !strings.HasPrefix(v.File.Path, filepath.Join(r.root, movieFolder)) {
		t.Errorf("file path = %q", v.File.Path)
	}
	if _, err := os.Stat(v.File.Path); err != nil {
		t.Errorf("the recorded file is not on disk: %v", err)
	}
	if got := tree(t, g.SourcePath); slices.Contains(got, "paddington.mkv") {
		t.Errorf("the main video was moved, but is still in the download: %v", got)
	}
}

func TestImportHardlinksWhileTheClientStillNeedsTheFiles(t *testing.T) {
	r := newRig(t)
	g := r.job(t, 1, map[string]string{"paddington.mkv": "video"})
	g.CanRemove = false
	r.prober.info["paddington.mkv"] = good()

	res := r.svc.Import(context.Background(), g)

	if res.Status != imports.Imported {
		t.Fatalf("result = %+v", res)
	}
	src, err := os.Stat(filepath.Join(g.SourcePath, "paddington.mkv"))
	if err != nil {
		t.Fatalf("the seeding source is gone: %v", err)
	}
	dst, err := os.Stat(r.version(t).File.Path)
	if err != nil {
		t.Fatal(err)
	}
	if !os.SameFile(src, dst) {
		t.Error("the imported file is a copy, want a hardlink")
	}
}

func TestProbeFailuresRejectTheGrabWithTheirCode(t *testing.T) {
	german := good()
	german.Audio = []probe.AudioTrack{{Language: "deu"}}
	short := good()
	short.Duration = 20 * time.Minute
	sd := good()
	sd.Width, sd.Height = 720, 480
	novideo := good()
	novideo.HasVideo = false

	tests := []struct {
		name   string
		info   *probe.Info // nil: unreadable
		files  map[string]string
		reason string
	}{
		{"unreadable file", nil, map[string]string{"p.mkv": "v"}, "invalid"},
		{"no video stream", &novideo, map[string]string{"p.mkv": "v"}, "invalid"},
		{"too short for the metadata runtime", &short, map[string]string{"p.mkv": "v"}, "invalid"},
		{"outside the Profile's resolution class", &sd, map[string]string{"p.mkv": "v"}, "resolution"},
		{"audio in the wrong language", &german, map[string]string{"p.mkv": "v"}, "language"},
		{"multi-part Movie", ptr(good()), map[string]string{"p.CD1.mkv": "v", "p.CD2.mkv": "v"}, "invalid"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := newRig(t)
			g := r.job(t, 1, tt.files)
			for name := range tt.files {
				if tt.info != nil {
					r.prober.info[name] = *tt.info
				}
			}

			res := r.svc.Import(context.Background(), g)

			if res.Status != imports.Rejected || res.Reason != tt.reason {
				t.Errorf("result = %+v, want rejected(%s)", res, tt.reason)
			}
			if v := r.version(t); v.File != nil {
				t.Errorf("a rejected Import filled the Version: %+v", v.File)
			}
			if got := tree(t, r.root); len(got) != 0 {
				t.Errorf("files landed in the library: %v", got)
			}
		})
	}
}

func ptr[T any](v T) *T { return &v }

// held puts an already imported file into the Version, as an earlier Import would have.
func (r *rig) held(t *testing.T, name string, score int) string {
	t.Helper()
	dir := filepath.Join(r.root, movieFolder)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(strings.TrimSuffix(p, ".mkv")+".en.srt", []byte("old subs"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := r.lib.ReplaceFile(context.Background(), r.titleID, movieFolder, library.NewFile{
		VersionID: r.versions[slot.Standard], Path: p, Size: 3, ReleaseName: "Old.Release", Score: score, GrabID: 99,
	})
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestAnImportThatDoesNotBeatTheCurrentFileIsNotAnUpgradeAndKeepsTheOldFile(t *testing.T) {
	r := newRig(t)
	old := r.held(t, "old.mkv", 100000)
	g := r.job(t, 1, map[string]string{"paddington.mkv": "video"})
	r.prober.info["paddington.mkv"] = good()

	res := r.svc.Import(context.Background(), g)

	if res.Status != imports.Rejected || res.Reason != "not_upgrade" {
		t.Fatalf("result = %+v", res)
	}
	if v := r.version(t); v.File == nil || v.File.Path != old {
		t.Errorf("file = %+v, want the old one", v.File)
	}
	if _, err := os.Stat(old); err != nil {
		t.Errorf("old file: %v", err)
	}
}

func TestAnImportThatBeatsTheCurrentFileReplacesItAndItsSubtitles(t *testing.T) {
	r := newRig(t)
	old := r.held(t, "old.mkv", -100000)
	g := r.job(t, 1, map[string]string{"paddington.mkv": "video"})
	r.prober.info["paddington.mkv"] = good()

	res := r.svc.Import(context.Background(), g)

	if res.Status != imports.Imported {
		t.Fatalf("result = %+v", res)
	}
	v := r.version(t)
	if v.File == nil || v.File.Path == old {
		t.Fatalf("file = %+v", v.File)
	}
	got := tree(t, filepath.Join(r.root, movieFolder))
	if len(got) != 1 || filepath.Join(r.root, movieFolder, got[0]) != v.File.Path {
		t.Errorf("folder = %v, want only the new file", got)
	}
}

func TestACrashBetweenThePartialFileAndTheRenameIsFinishedByTheRerun(t *testing.T) {
	for _, crashAt := range []string{"partial", "committed"} {
		t.Run(crashAt, func(t *testing.T) {
			r := newRig(t)
			old := r.held(t, "old.mkv", -100000)
			g := r.job(t, 7, map[string]string{"paddington.mkv": "video"})
			r.prober.info["paddington.mkv"] = good()
			crash := errors.New("killed")
			r.hook = func(step string) error {
				if step == crashAt {
					return crash
				}
				return nil
			}

			first := r.svc.Import(context.Background(), g)

			if first.Status != imports.Stalled {
				t.Fatalf("first run = %+v, want stalled by the crash", first)
			}
			v := r.version(t)
			if v.File == nil {
				t.Fatal("the Version lost its file")
			}
			if v.File.Path == old {
				if _, err := os.Stat(old); err != nil {
					t.Errorf("the Version holds the old file but it is gone: %v", err)
				}
			}

			r.hook = nil
			second := r.svc.Import(context.Background(), g)

			if second.Status != imports.Imported {
				t.Fatalf("rerun = %+v", second)
			}
			v = r.version(t)
			if v.File == nil || v.File.Path == old {
				t.Fatalf("file = %+v", v.File)
			}
			if _, err := os.Stat(v.File.Path); err != nil {
				t.Errorf("the new file is not on disk: %v", err)
			}
			if _, err := os.Stat(old); err == nil {
				t.Errorf("the replaced file %s was left behind", old)
			}
			for _, f := range tree(t, filepath.Join(r.root, movieFolder)) {
				if strings.HasSuffix(f, ".partial") {
					t.Errorf("leftover %s", f)
				}
			}
		})
	}
}

func TestAnUntrackedFileAtTheTargetIsNeverOverwritten(t *testing.T) {
	r := newRig(t)
	g := r.job(t, 1, map[string]string{"paddington.mkv": "video"})
	r.prober.info["paddington.mkv"] = good()
	if res := r.svc.Import(context.Background(), g); res.Status != imports.Imported {
		t.Fatal(res)
	}
	target := r.version(t).File.Path
	if _, err := r.lib.ReplaceFile(context.Background(), r.titleID, movieFolder, library.NewFile{VersionID: r.versions[slot.Standard], Path: "/gone.mkv", ReleaseName: "x", Score: -100000, GrabID: 5}); err != nil {
		t.Fatal(err)
	}
	g2 := r.job(t, 2, map[string]string{"paddington.mkv": "video again"})

	res := r.svc.Import(context.Background(), g2)

	if res.Status != imports.Stalled || res.Reason != "path occupied" {
		t.Fatalf("result = %+v", res)
	}
	if b, _ := os.ReadFile(target); string(b) != "video" {
		t.Errorf("target content = %q, it was overwritten", b)
	}
}

func TestStalledReasonsLeaveTheGrabForARetry(t *testing.T) {
	t.Run("only archives", func(t *testing.T) {
		r := newRig(t)
		g := r.job(t, 1, map[string]string{"paddington.rar": "x", "paddington.r00": "x"})
		if res := r.svc.Import(context.Background(), g); res.Status != imports.Stalled || res.Reason != "no video file" {
			t.Errorf("result = %+v", res)
		}
	})
	t.Run("download folder missing", func(t *testing.T) {
		r := newRig(t)
		g := r.job(t, 1, map[string]string{"paddington.mkv": "x"})
		g.SourcePath = filepath.Join(r.downs, "not mounted")
		if res := r.svc.Import(context.Background(), g); res.Status != imports.Stalled {
			t.Errorf("result = %+v", res)
		}
	})
	t.Run("ffprobe not installed", func(t *testing.T) {
		r := newRig(t)
		g := r.job(t, 1, map[string]string{"paddington.mkv": "x"})
		r.prober.info["paddington.mkv"] = good()
		r.prober.notInstalled = true
		if res := r.svc.Import(context.Background(), g); res.Status != imports.Stalled || res.Reason != "ffprobe not installed" {
			t.Errorf("result = %+v", res)
		}
	})
}

func TestAnImportIntoAMissingRootFolderStallsUntilItIsBack(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	g := r.job(t, 1, map[string]string{"paddington.mkv": "x"})
	r.prober.info["paddington.mkv"] = good()
	gone := r.root + ".unmounted"
	if err := os.Rename(r.root, gone); err != nil {
		t.Fatal(err)
	}

	res := r.svc.Import(ctx, g)

	if res.Status != imports.Stalled || res.Reason != imports.StalledRootFolder {
		t.Fatalf("result = %+v", res)
	}
	rows, _ := r.health.List(ctx)
	if len(rows) != 1 || rows[0].Kind != health.KindRootFolder || rows[0].Severity != health.Blocking {
		t.Fatalf("rows = %+v", rows)
	}

	if err := os.Rename(gone, r.root); err != nil {
		t.Fatal(err)
	}
	if res := r.svc.Import(ctx, g); res.Status != imports.Imported {
		t.Fatalf("after the folder is back: %+v", res)
	}
	if rows, _ := r.health.List(ctx); len(rows) != 0 {
		t.Errorf("the row should have cleared: %+v", rows)
	}
}

func TestACopyAcrossFilesystemsIsADismissibleWarningThatClearsOnTheNextCleanImport(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.prober.info["paddington.mkv"] = good()
	r.crossDevice = true

	res := r.svc.Import(ctx, r.job(t, 1, map[string]string{"paddington.mkv": "video"}))

	if res.Status != imports.Imported || !res.CrossDevice {
		t.Fatalf("result = %+v, want imported by copy", res)
	}
	rows, _ := r.health.List(ctx)
	if len(rows) != 1 || rows[0].Kind != health.KindEXDEV || rows[0].Severity != health.Warning || !rows[0].Dismissible {
		t.Fatalf("rows = %+v", rows)
	}

	r.crossDevice = false
	files, _ := r.lib.FilesOfVersion(ctx, r.versions[slot.Standard])
	if err := r.lib.ApplyRescore(ctx, []library.Rescored{{FileID: files[0].ID, Misfit: true}}); err != nil {
		t.Fatal(err)
	}
	r.prober.info["paddington2.mkv"] = good()
	if res := r.svc.Import(ctx, r.job(t, 2, map[string]string{"paddington2.mkv": "video"})); res.Status != imports.Imported {
		t.Fatalf("second import = %+v", res)
	}
	if rows, _ := r.health.List(ctx); len(rows) != 0 {
		t.Errorf("rows = %+v, want the Warning cleared", rows)
	}
}

// recorder is the Notifier the rig hands the Service.
type recorder struct {
	mu    sync.Mutex
	paths []string
}

func (r *recorder) changed(_ context.Context, folder string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.paths = append(r.paths, folder)
}

func TestAnImportedMovieTellsTheMediaServersItsTitleFolder(t *testing.T) {
	r := newRig(t)
	r.prober.info["Paddington.2014.mkv"] = good()
	res := r.svc.Import(context.Background(), r.job(t, 1, map[string]string{"Paddington.2014.mkv": "video"}))
	if res.Status != imports.Imported {
		t.Fatalf("%+v", res)
	}
	if len(r.notes.paths) != 1 || r.notes.paths[0] != filepath.Dir(res.Path) {
		t.Fatalf("notified %v for %s", r.notes.paths, res.Path)
	}
}

func TestARejectedImportTellsNoOne(t *testing.T) {
	r := newRig(t)
	r.svc.Import(context.Background(), r.job(t, 1, map[string]string{"readme.txt": "x"}))
	if len(r.notes.paths) != 0 {
		t.Fatalf("notified %v", r.notes.paths)
	}
}

func TestAStandardAndA4KVersionAreLabelledAndKeptInOneFolder(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	id4k, err := r.lib.AddVersion(ctx, r.titleID, library.VersionSpec{Slot: slot.FourK, Profile: "4k-primary"})
	if err != nil {
		t.Fatal(err)
	}
	const uhdName = "Paddington.2014.2160p.BluRay.x265-GRP"

	std := r.job(t, 1, map[string]string{"paddington.mkv": "standard video"})
	r.prober.info["paddington.mkv"] = good()
	if res := r.svc.Import(ctx, std); res.Status != imports.Imported {
		t.Fatalf("Standard import = %+v", res)
	}

	dir := filepath.Join(r.downs, uhdName)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "paddington.2160p.mkv"), []byte("4k video"), 0o644); err != nil {
		t.Fatal(err)
	}
	uhd := good()
	uhd.Width, uhd.Height, uhd.VideoCodec = 3840, 2160, "hevc"
	r.prober.info["paddington.2160p.mkv"] = uhd
	parsed, err := release.Parse(uhdName, release.KindMovie)
	if err != nil {
		t.Fatal(err)
	}
	pj, _ := json.Marshal(parsed)
	g4k := imports.Grab{ID: 2, TitleID: r.titleID, VersionID: id4k, ReleaseName: uhdName, Parsed: pj, SourcePath: dir, CanRemove: true}
	if res := r.svc.Import(ctx, g4k); res.Status != imports.Imported {
		t.Fatalf("4K import = %+v", res)
	}

	var got []string
	for _, f := range tree(t, r.root) {
		dirPart, name := filepath.Split(f)
		if dirPart != movieFolder+string(filepath.Separator) {
			t.Errorf("%q is outside the one Movie folder", f)
		}
		got = append(got, name)
	}
	if len(got) != 2 || !strings.HasPrefix(got[0], movieFolder+" - [4K][Bluray-2160p]") || !strings.HasPrefix(got[1], movieFolder+" - [Standard][Bluray-1080p]") {
		t.Errorf("names = %q, want one [Standard][Bluray-1080p] and one [4K][Bluray-2160p] file", got)
	}
}
