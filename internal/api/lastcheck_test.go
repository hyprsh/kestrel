package api_test

import (
	"testing"
	"time"
)

type lastCheckJSON struct {
	LastCheck *struct {
		At      time.Time `json:"at"`
		OK      bool      `json:"ok"`
		Code    *string   `json:"code"`
		Message *string   `json:"message"`
	} `json:"last_check"`
}

func TestPluginInstanceReportsItsLastCheck(t *testing.T) {
	t.Parallel()
	sab := fakeSAB(t)
	in := newInstance(t, "", withSAB(t))
	b := in.setUp()

	created := decode[instanceJSON](t, b.valid("POST", "/plugin-instances", sabBody(sab.URL, sabKey, "")))
	id := "/plugin-instances/" + itoa(created.ID)
	if got := decode[lastCheckJSON](t, b.valid("GET", id, "")); got.LastCheck != nil {
		t.Fatalf("no check yet: %+v", got.LastCheck)
	}

	// The Settings test button on the saved connection is a check.
	b.valid("POST", id+"/test", "")
	got := decode[lastCheckJSON](t, b.valid("GET", id, ""))
	if got.LastCheck == nil || !got.LastCheck.OK || got.LastCheck.Code != nil || got.LastCheck.At.IsZero() {
		t.Fatalf("after a good test: %+v", got.LastCheck)
	}

	// A test of edits is of the form, not of the saved connection: it leaves the last check alone.
	b.valid("POST", id+"/test", `{"config":{"api_key":"edited-wrong"}}`)
	if got := decode[lastCheckJSON](t, b.valid("GET", id, "")); !got.LastCheck.OK {
		t.Fatalf("an edited test should not count: %+v", got.LastCheck)
	}

	// A failing check reports its code and message, in the list too.
	b.valid("PATCH", id, `{"config":{"api_key":"revoked"}}`)
	b.valid("POST", id+"/test", "")
	list := decode[struct {
		Items []lastCheckJSON `json:"items"`
	}](t, b.valid("GET", "/plugin-instances", ""))
	lc := list.Items[0].LastCheck
	if lc == nil || lc.OK || lc.Code == nil || *lc.Code != "auth" || lc.Message == nil || *lc.Message == "" {
		t.Fatalf("after a failed test: %+v", lc)
	}
}
