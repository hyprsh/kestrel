package sabnzbd_test

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/hyprsh/kestrel/internal/plugin/adapters/sabnzbd"
	downloadclient "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1"
)

// removeServer is a SABnzbd with one history slot and the given complete dir.
func removeServer(t *testing.T, status, storage, completeDir string) *recorded {
	t.Helper()
	return serveFixtures(t, map[string]func(http.ResponseWriter, *http.Request){
		"get_config": func(w http.ResponseWriter, _ *http.Request) {
			_, _ = fmt.Fprintf(w, `{"config": {"misc": {"complete_dir": %q}}}`, completeDir)
		},
		"history": func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Query().Get("name") == "delete" {
				_, _ = w.Write(fixture(t, "delete.json"))
				return
			}
			slot := map[string]any{"nzo_id": "job1", "name": "Job", "category": "movies", "status": status, "storage": storage}
			_ = json.NewEncoder(w).Encode(map[string]any{"history": map[string]any{"slots": []any{slot}}})
		},
	})
}

func (r *recorded) modes() (out []string) {
	for _, c := range r.calls {
		m := c.Query.Get("mode")
		if c.Query.Get("name") == "delete" {
			m += ":delete"
		}
		out = append(out, m)
	}
	return out
}

func (r *recorded) deletes(mode string) []call {
	var out []call
	for _, c := range r.calls {
		if c.Query.Get("mode") == mode && c.Query.Get("name") == "delete" {
			out = append(out, c)
		}
	}
	return out
}

func fileAt(t *testing.T, p string) string {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func gone(p string) bool { _, err := os.Lstat(p); return errors.Is(err, os.ErrNotExist) }

func realTemp(t *testing.T) string {
	t.Helper()
	d, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func TestRemoveDeletesFromQueueAndHistory(t *testing.T) {
	for _, deleteData := range []bool{true, false} {
		srv := serveFixtures(t, nil)
		if err := sabnzbd.New(nil).Remove(ctx(), srv.conn(key), "SABnzbd_nzo_fail1", deleteData); err != nil {
			t.Fatal(err)
		}
		want := "0"
		if deleteData {
			want = "1"
		}
		for _, mode := range []string{"queue", "history"} {
			d := srv.deletes(mode)
			if len(d) != 1 {
				t.Fatalf("%s: %d deletes", mode, len(d))
			}
			if q := d[0].Query; q.Get("value") != "SABnzbd_nzo_fail1" || q.Get("del_files") != want {
				t.Errorf("%s delete: %v", mode, q)
			}
		}
	}
}

func TestRemoveWithoutDataNeverTouchesTheFolder(t *testing.T) {
	root := realTemp(t)
	f := fileAt(t, filepath.Join(root, "complete", "Job", "a.mkv"))
	srv := removeServer(t, "Completed", filepath.Join(root, "complete", "Job"), filepath.Join(root, "complete"))
	if err := sabnzbd.New(nil).Remove(ctx(), srv.conn(key), "job1", false); err != nil {
		t.Fatal(err)
	}
	if gone(f) {
		t.Fatal("folder deleted without deleteData")
	}
	if len(srv.deletes("history")) != 1 {
		t.Fatal("history entry not deleted")
	}
}

func TestRemoveDeletesACompletedJobsFolder(t *testing.T) {
	root := realTemp(t)
	job := filepath.Join(root, "complete", "movies", "Job")
	f := fileAt(t, filepath.Join(job, "a.mkv"))
	lib := filepath.Join(root, "media")
	srv := removeServer(t, "Completed", job, filepath.Join(root, "complete"))
	conn := srv.conn(key)
	conn.Keep = []string{lib}
	if err := sabnzbd.New(nil).Remove(ctx(), conn, "job1", true); err != nil {
		t.Fatal(err)
	}
	if !gone(f) || !gone(job) {
		t.Fatal("completed folder still there")
	}
	if len(srv.deletes("history")) != 1 {
		t.Fatalf("history entry not deleted: %v", srv.modes())
	}
	if !gone(job) || gone(filepath.Join(root, "complete")) {
		t.Fatal("only the job folder goes")
	}
}

func TestRemoveACompletedJobWhoseFolderIsGoneIsNotAnError(t *testing.T) {
	root := realTemp(t)
	if err := os.MkdirAll(filepath.Join(root, "complete"), 0o755); err != nil {
		t.Fatal(err)
	}
	srv := removeServer(t, "Completed", filepath.Join(root, "complete", "Gone"), filepath.Join(root, "complete"))
	if err := sabnzbd.New(nil).Remove(ctx(), srv.conn(key), "job1", true); err != nil {
		t.Fatal(err)
	}
}

func TestRemoveLeavesAFolderOutsideTheDownloadDirOrInTheLibrary(t *testing.T) {
	root := realTemp(t)
	complete := filepath.Join(root, "complete")
	outside := fileAt(t, filepath.Join(root, "elsewhere", "Job", "a.mkv"))
	libFile := fileAt(t, filepath.Join(root, "media", "Movie (2024)", "m.mkv"))
	traversal := complete + "/Job/../../elsewhere/Job"
	if err := os.MkdirAll(complete, 0o755); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(complete, "lnk")
	if err := os.Symlink(filepath.Dir(libFile), link); err != nil {
		t.Fatal(err)
	}

	for name, c := range map[string]struct{ storage, complete string }{
		"outside":                      {filepath.Dir(outside), complete},
		"dot-dot":                      {traversal, complete},
		"the complete dir":             {complete, complete},
		"a symlink to the Library":     {link, complete},
		"complete dir is the Library":  {filepath.Dir(libFile), filepath.Join(root, "media")},
		"complete dir inside Library":  {filepath.Dir(libFile), filepath.Join(root, "media", "Movie (2024)")},
		"storage is the Library root":  {filepath.Join(root, "media"), root},
		"storage is above the Library": {root, filepath.Dir(root)},
	} {
		srv := removeServer(t, "Completed", c.storage, c.complete)
		conn := srv.conn(key)
		conn.Keep = []string{filepath.Join(root, "media")}
		err := sabnzbd.New(nil).Remove(ctx(), conn, "job1", true)
		var left *downloadclient.FolderLeft
		if !errors.As(err, &left) {
			t.Errorf("%s: err %v, want FolderLeft", name, err)
		}
		if len(srv.deletes("history")) != 1 {
			t.Errorf("%s: the job must still leave history", name)
		}
	}
	for _, p := range []string{outside, libFile, complete} {
		if gone(p) {
			t.Errorf("%s was deleted", p)
		}
	}
}

func TestRemoveSaysWhenItCannotReachTheFolder(t *testing.T) {
	srv := removeServer(t, "Completed", "/sab-only/complete/Job", "/sab-only/complete")
	err := sabnzbd.New(nil).Remove(ctx(), srv.conn(key), "job1", true)
	var left *downloadclient.FolderLeft
	if !errors.As(err, &left) || left.Path != "/sab-only/complete/Job" || left.Reason == "" {
		t.Fatalf("err %v", err)
	}
	if len(srv.deletes("history")) != 1 {
		t.Fatal("the job must still leave history")
	}
}

func TestRemoveLeavesTheFolderWhenTheCompleteDirIsUnknown(t *testing.T) {
	root := realTemp(t)
	f := fileAt(t, filepath.Join(root, "complete", "Job", "a.mkv"))
	srv := removeServer(t, "Completed", filepath.Join(root, "complete", "Job"), "")
	err := sabnzbd.New(nil).Remove(ctx(), srv.conn(key), "job1", true)
	var left *downloadclient.FolderLeft
	if !errors.As(err, &left) || gone(f) {
		t.Fatalf("err %v, deleted %v", err, gone(f))
	}
}

func TestRemoveAFailedJobUsesDelFilesAndLeavesTheFolderAlone(t *testing.T) {
	root := realTemp(t)
	f := fileAt(t, filepath.Join(root, "complete", "Job", "a.mkv"))
	srv := removeServer(t, "Failed", filepath.Join(root, "complete", "Job"), filepath.Join(root, "complete"))
	if err := sabnzbd.New(nil).Remove(ctx(), srv.conn(key), "job1", true); err != nil {
		t.Fatal(err)
	}
	d := srv.deletes("history")
	if len(d) != 1 || d[0].Query.Get("del_files") != "1" {
		t.Fatalf("history delete %v", d)
	}
	if gone(f) {
		t.Fatal("the adapter deleted a failed job's folder itself")
	}
}
