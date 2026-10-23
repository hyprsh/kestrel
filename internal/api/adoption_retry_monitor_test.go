package api_test

import (
	"fmt"
	"os"
	"strings"
	"testing"
)

func TestKeptRowsKeepTheirMonitoringAndATryAgainKeepsThePlansAndTheRowsOwn(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	pad := a.put(t, "Paddington.2014.1080p.BluRay.x264-GRP/Paddington.2014.1080p.BluRay.x264-GRP.mkv", "pad")
	a.put(t, "The Lost Film (2020) [tmdbid-77]/lost.film.mkv", "lost")
	plan := a.scan(t)
	a.monitorRow(t, a.rowOf(t, "Paddington.2014.1080p.BluRay.x264-GRP").ID, "none")
	if err := os.Remove(pad); err != nil { // the commit fails for Paddington
		t.Fatal(err)
	}
	plan = a.plan(t)

	if r := a.valid("POST", "/adoption/commit", fmt.Sprintf(`{"revision":%d,"monitor":"future"}`, plan.Revision)); r.Status != 202 {
		t.Fatalf("commit = %d %s", r.Status, r.Body)
	}
	a.settled(t, "committing")

	kept := map[string]string{}
	for _, r := range a.rows(t, "") {
		if r.Monitor != nil {
			kept[r.Entry[strings.LastIndex(r.Entry, "/")+1:]] = *r.Monitor
		}
	}
	if kept["Paddington.2014.1080p.BluRay.x264-GRP"] != "none" || kept["The Lost Film (2020) [tmdbid-77]"] != "future" {
		t.Fatalf("kept monitoring = %v, want the row's own none and the plan's future", kept)
	}

	if err := os.WriteFile(pad, []byte("pad again"), 0o644); err != nil {
		t.Fatal(err)
	}
	if r := a.valid("POST", "/adoption/retry", ""); r.Status != 202 {
		t.Fatalf("retry = %d %s", r.Status, r.Body)
	}
	retried := a.settled(t, "scanning")

	if retried.Monitor != "future" {
		t.Errorf("plan monitor after a retry = %q, want the future the commit chose", retried.Monitor)
	}
	rows := a.rows(t, "")
	if len(rows) != 1 || rows[0].Monitor == nil || *rows[0].Monitor != "none" {
		t.Fatalf("rows after retry = %+v, want Paddington with its own none", rows)
	}
	a.commit(t, retried.Revision)
	if got := a.title(t, a.titleIDOf(t, 116149)); got.Monitored {
		t.Errorf("Paddington is monitored after the retry, want the row's own unmonitored")
	}
}
