package sabnzbd

import (
	"os"
	"path/filepath"
	"testing"
)

type tree struct {
	t        *testing.T
	root     string // real, symlink-free temp dir
	complete string
	library  string
}

func newTree(t *testing.T) tree {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	tr := tree{t: t, root: root, complete: filepath.Join(root, "dl", "complete"), library: filepath.Join(root, "media", "movies")}
	tr.mkdir(tr.complete)
	tr.mkdir(tr.library)
	return tr
}

func (tr tree) mkdir(p string) string {
	tr.t.Helper()
	if err := os.MkdirAll(p, 0o755); err != nil {
		tr.t.Fatal(err)
	}
	return p
}

func (tr tree) file(p string) string {
	tr.t.Helper()
	tr.mkdir(filepath.Dir(p))
	if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
		tr.t.Fatal(err)
	}
	return p
}

func (tr tree) link(target, name string) string {
	tr.t.Helper()
	tr.mkdir(filepath.Dir(name))
	if err := os.Symlink(target, name); err != nil {
		tr.t.Fatal(err)
	}
	return name
}

func exists(p string) bool { _, err := os.Lstat(p); return err == nil }

func TestRemoveFolderDeletesInsideTheCompleteDir(t *testing.T) {
	tr := newTree(t)
	job := filepath.Join(tr.complete, "movies", "Movie.2024")
	tr.file(filepath.Join(job, "movie.mkv"))
	tr.file(filepath.Join(job, "sub", "movie.srt"))
	if reason := removeFolder(job, tr.complete, []string{tr.library}); reason != "" {
		t.Fatalf("left: %s", reason)
	}
	if exists(job) {
		t.Fatal("folder still there")
	}
	if !exists(tr.complete) || !exists(tr.library) {
		t.Fatal("removed too much")
	}
}

func TestRemoveFolderAlreadyGoneIsFine(t *testing.T) {
	tr := newTree(t)
	if reason := removeFolder(filepath.Join(tr.complete, "Gone"), tr.complete, nil); reason != "" {
		t.Fatalf("reason %q", reason)
	}
}

func TestRemoveFolderOutOfReachIsLeft(t *testing.T) {
	// SABnzbd's directory does not exist for Kestrel (another host or an unmounted volume).
	if reason := removeFolder("/nonexistent-sab/complete/Job", "/nonexistent-sab/complete", nil); reason == "" {
		t.Fatal("an unreachable folder must be reported as left")
	}
	if reason := removeFolder("", "/x", nil); reason == "" {
		t.Fatal("no storage")
	}
	if reason := removeFolder("/x/y", "", nil); reason == "" {
		t.Fatal("no complete dir")
	}
}

func TestRemoveFolderNeverDeletesOutsideOrTheDirItself(t *testing.T) {
	tr := newTree(t)
	outside := tr.file(filepath.Join(tr.root, "other", "keep.txt"))
	sibling := filepath.Join(tr.root, "dl", "complete-evil") // shares the string prefix
	tr.file(filepath.Join(sibling, "a"))
	job := tr.mkdir(filepath.Join(tr.complete, "Job"))
	tr.file(filepath.Join(job, "f"))

	cases := map[string]string{
		"the complete dir itself": tr.complete,
		"its parent":              filepath.Join(tr.root, "dl"),
		"the root":                "/",
		"a sibling by prefix":     sibling,
		"outside":                 filepath.Dir(outside),
		"dot-dot out":             tr.complete + "/Job/../../../other",
		"dot-dot inside":          tr.complete + "/Job/../Job",
		"dot-dot to complete":     tr.complete + "/Job/..",
		"relative":                "Job",
		"relative dot-dot":        "../other",
	}
	for name, storage := range cases {
		if reason := removeFolder(storage, tr.complete, nil); reason == "" {
			t.Errorf("%s: deleted %q", name, storage)
		}
	}
	for _, p := range []string{outside, filepath.Join(sibling, "a"), filepath.Join(job, "f"), tr.complete} {
		if !exists(p) {
			t.Errorf("%s was deleted", p)
		}
	}
}

func TestRemoveFolderNeverFollowsSymlinks(t *testing.T) {
	tr := newTree(t)
	precious := tr.file(filepath.Join(tr.root, "precious", "a.txt"))
	libFile := tr.file(filepath.Join(tr.library, "Movie (2024)", "Movie.mkv"))

	// storage is itself a link to a folder outside.
	l1 := tr.link(filepath.Dir(precious), filepath.Join(tr.complete, "linked"))
	// storage is a link to a Library folder.
	l2 := tr.link(filepath.Dir(libFile), filepath.Join(tr.complete, "libkink"))
	// the complete dir is a link into the Library, and storage lies below it.
	libDl := tr.mkdir(filepath.Join(tr.library, "downloads"))
	tr.file(filepath.Join(libDl, "Job", "f"))
	linkedComplete := tr.link(libDl, filepath.Join(tr.root, "dl", "viaLibrary"))
	// storage lies below a linked parent that leads outside.
	deep := tr.file(filepath.Join(tr.root, "precious", "x", "f"))
	tr.link(filepath.Join(tr.root, "precious"), filepath.Join(tr.complete, "hop"))

	for name, c := range map[string]struct{ storage, complete string }{
		"link to outside":              {l1, tr.complete},
		"link to the Library":          {l2, tr.complete},
		"below a linked parent":        {filepath.Join(tr.complete, "hop", "x"), tr.complete},
		"complete dir linked into lib": {filepath.Join(linkedComplete, "Job"), linkedComplete},
	} {
		if reason := removeFolder(c.storage, c.complete, []string{tr.library}); reason == "" {
			t.Errorf("%s: deleted", name)
		}
	}
	for _, p := range []string{precious, deep, libFile, filepath.Join(libDl, "Job", "f")} {
		if !exists(p) {
			t.Errorf("%s was deleted", p)
		}
	}
}

func TestRemoveFolderKeepsTheLibrary(t *testing.T) {
	tr := newTree(t)
	// The complete dir sits in the Library root.
	inLib := tr.mkdir(filepath.Join(tr.library, "complete"))
	job := tr.file(filepath.Join(inLib, "Job", "f"))
	if reason := removeFolder(filepath.Dir(job), inLib, []string{tr.library}); reason == "" {
		t.Error("deleted inside a Library root")
	}
	// The complete dir is the Library root.
	jobInLib := tr.file(filepath.Join(tr.library, "Movie (2024)", "m.mkv"))
	if reason := removeFolder(filepath.Dir(jobInLib), tr.library, []string{tr.library}); reason == "" {
		t.Error("deleted a title folder when complete dir is the Library")
	}
	// The Library sits inside the folder: it must stay.
	holder := tr.mkdir(filepath.Join(tr.complete, "holder"))
	nested := tr.file(filepath.Join(holder, "lib", "m.mkv"))
	if reason := removeFolder(holder, tr.complete, []string{filepath.Join(holder, "lib")}); reason == "" {
		t.Error("deleted a folder that contains a Library root")
	}
	// A kept path that does not exist yet still protects its place.
	if reason := removeFolder(holder, tr.complete, []string{filepath.Join(holder, "future")}); reason == "" {
		t.Error("deleted a folder that contains a missing Library root")
	}
	for _, p := range []string{job, jobInLib, nested} {
		if !exists(p) {
			t.Errorf("%s was deleted", p)
		}
	}
}

func TestRemoveFolderDeletesLinksInsideWithoutFollowing(t *testing.T) {
	tr := newTree(t)
	precious := tr.file(filepath.Join(tr.root, "precious", "a.txt"))
	job := tr.mkdir(filepath.Join(tr.complete, "Job"))
	tr.link(filepath.Dir(precious), filepath.Join(job, "inner"))
	if reason := removeFolder(job, tr.complete, nil); reason != "" {
		t.Fatalf("left: %s", reason)
	}
	if exists(job) || !exists(precious) {
		t.Fatalf("job gone=%v precious kept=%v", !exists(job), exists(precious))
	}
}
