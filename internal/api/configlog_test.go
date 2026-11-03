package api_test

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

type validator interface {
	valid(method, path, body string) reply
}

// configEvents is the Log's entries of one kind.
func configEvents(t *testing.T, v validator, kind string) []triggerEventJSON {
	t.Helper()
	r := v.valid("GET", "/events?routine=true&kind="+kind, "")
	if r.Status != 200 {
		t.Fatalf("GET /events = %d %s", r.Status, r.Body)
	}
	return decode[struct {
		Items []triggerEventJSON `json:"items"`
	}](t, r).Items
}

// oneConfigEvent fails unless the Log has exactly one entry of the kind, and checks that it names a person, the API
// call and a reason.
func oneConfigEvent(t *testing.T, v validator, kind, via string) triggerEventJSON {
	t.Helper()
	got := configEvents(t, v, kind)
	if len(got) != 1 {
		t.Fatalf("%d %q entries, want one: %+v", len(got), kind, got)
	}
	e := got[0]
	if e.Trigger == nil || e.Trigger.Kind != "person" || e.Trigger.Actor == nil || *e.Trigger.Actor == "" || e.Trigger.Via == nil || *e.Trigger.Via != via {
		t.Errorf("%s trigger = %+v, want the person and %s", kind, e.Trigger, via)
	}
	if e.Reason == "" || e.Message == "" {
		t.Errorf("%s entry = %+v, want a message and a reason", kind, e)
	}
	return e
}

func TestSlotChangesLeaveEntriesNamingThePerson(t *testing.T) {
	t.Parallel()
	b := newInstance(t, "").setUp()

	r := b.valid("POST", "/slots", `{"label":"Kids"}`)
	if r.Status != 201 {
		t.Fatalf("create = %d %s", r.Status, r.Body)
	}
	id := decode[slotJSON](t, r).ID
	if e := oneConfigEvent(t, b, "slot_created", "CreateSlot"); e.Data["slot"] != id || e.Data["label"] != "Kids" {
		t.Errorf("created data = %v", e.Data)
	}

	if r := b.valid("PATCH", "/slots/"+id+"?dry_run=true", `{"label":"Little"}`); r.Status != 200 {
		t.Fatalf("dry run = %d %s", r.Status, r.Body)
	}
	if got := configEvents(t, b, "slot_changed"); len(got) != 0 {
		t.Errorf("a dry run left %+v", got)
	}
	if r := b.valid("PATCH", "/slots/"+id, `{"label":"Little"}`); r.Status != 200 {
		t.Fatalf("patch = %d %s", r.Status, r.Body)
	}
	e := oneConfigEvent(t, b, "slot_changed", "PatchSlot")
	if f, _ := e.Data["fields"].([]any); len(f) != 1 || f[0] != "label" || !strings.Contains(e.Message, "Little") {
		t.Errorf("changed = %q %v", e.Message, e.Data)
	}

	if r := b.valid("DELETE", "/slots/"+id, ""); r.Status != 204 {
		t.Fatalf("delete = %d %s", r.Status, r.Body)
	}
	if e := oneConfigEvent(t, b, "slot_deleted", "DeleteSlot"); e.Data["label"] != "Little" {
		t.Errorf("deleted data = %v", e.Data)
	}
}

func TestProfileChangesLeaveEntriesNamingThePerson(t *testing.T) {
	t.Parallel()
	b := newInstance(t, "").setUp()

	r := b.valid("POST", "/profiles", `{"name":"Mine","copy_from":"hd-primary"}`)
	if r.Status != 201 {
		t.Fatalf("create = %d %s", r.Status, r.Body)
	}
	key := decode[struct {
		Key string `json:"key"`
	}](t, r).Key
	e := oneConfigEvent(t, b, "profile_created", "CreateProfile")
	if e.Data["profile"] != key || !strings.Contains(e.Reason, "hd-primary") {
		t.Errorf("created = %v, reason %q", e.Data, e.Reason)
	}

	if r := b.valid("PATCH", "/profiles/"+key, `{"enabled":false}`); r.Status != 200 {
		t.Fatalf("patch = %d %s", r.Status, r.Body)
	}
	e = oneConfigEvent(t, b, "profile_changed", "PatchProfile")
	if f, _ := e.Data["fields"].([]any); len(f) != 1 || f[0] != "enabled" {
		t.Errorf("changed data = %v", e.Data)
	}

	if r := b.valid("DELETE", "/profiles/"+key, ""); r.Status != 204 {
		t.Fatalf("delete = %d %s", r.Status, r.Body)
	}
	if e := oneConfigEvent(t, b, "profile_deleted", "DeleteProfile"); e.Data["name"] != "Mine" {
		t.Errorf("deleted data = %v", e.Data)
	}
}

func TestPauseGrabsOnAndOffLeaveEntries(t *testing.T) {
	t.Parallel()
	b := newInstance(t, "").setUp()

	for _, step := range []struct {
		on   bool
		kind string
	}{{true, "grabs_paused"}, {false, "grabs_resumed"}} {
		if r := b.valid("PATCH", "/settings", fmt.Sprintf(`{"pause_grabs":%v}`, step.on)); r.Status != 200 {
			t.Fatalf("pause %v = %d %s", step.on, r.Status, r.Body)
		}
		oneConfigEvent(t, b, step.kind, "PatchSettings")
	}
	// Saving what is already set changes nothing and says nothing.
	if r := b.valid("PATCH", "/settings", `{"pause_grabs":false}`); r.Status != 200 {
		t.Fatal(r.Body)
	}
	if got := configEvents(t, b, "grabs_resumed"); len(got) != 1 {
		t.Errorf("%d resumed entries after a repeat, want 1", len(got))
	}
	if got := configEvents(t, b, "settings_changed"); len(got) != 0 {
		t.Errorf("Pause Grabs alone left a settings entry: %+v", got)
	}
}

func TestASettingsEntryNamesTheKeysAndNeverASecret(t *testing.T) {
	t.Parallel()
	b := newInstance(t, "").setUp()

	const tmdb, tvdb = "SECRET-tmdb-0123456789", "SECRET-tvdb-9876543210"
	body := fmt.Sprintf(`{"metadata":{"tmdb_api_key":%q,"tvdb_api_key":%q},"display":{"season_order":"newest_first"}}`, tmdb, tvdb)
	if r := b.valid("PATCH", "/settings", body); r.Status != 200 {
		t.Fatalf("patch = %d %s", r.Status, r.Body)
	}
	e := oneConfigEvent(t, b, "settings_changed", "PatchSettings")
	keys, _ := e.Data["keys"].([]any)
	var got []string
	for _, k := range keys {
		got = append(got, fmt.Sprint(k))
	}
	for _, want := range []string{"metadata.tmdb_api_key", "metadata.tvdb_api_key", "display.season_order"} {
		if !slices.Contains(got, want) {
			t.Errorf("keys = %v, missing %s", got, want)
		}
	}

	// Nothing the Log serves holds a secret: not the settings entry, not any other.
	all := b.valid("GET", "/events?routine=true", "")
	for _, secret := range []string{tmdb, tvdb} {
		if strings.Contains(string(all.Body), secret) {
			t.Errorf("the Log holds the secret %q: %s", secret, all.Body)
		}
	}

	// A repeat that changes no plain setting writes nothing for it.
	if r := b.valid("PATCH", "/settings", `{"display":{"season_order":"newest_first"}}`); r.Status != 200 {
		t.Fatal(r.Body)
	}
	if n := len(configEvents(t, b, "settings_changed")); n != 1 {
		t.Errorf("%d settings entries after a repeat, want 1", n)
	}
}

func TestTakingAReleaseOffTheBlocklistLeavesAnEntry(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	s.publish(t, goodRelease)
	rel := s.releases(t, s.hd).find(t, goodRelease)
	if r := s.valid("POST", "/blocklist", fmt.Sprintf(`{"version_id":%d,"release_id":%q}`, s.hd, rel.ReleaseID)); r.Status != 204 {
		t.Fatalf("blocklist = %d %s", r.Status, r.Body)
	}
	list := decode[blocklistJSON](t, s.valid("GET", "/blocklist", ""))
	if r := s.valid("DELETE", fmt.Sprintf("/blocklist/%d", list.Items[0].ID), ""); r.Status != 204 {
		t.Fatalf("delete = %d %s", r.Status, r.Body)
	}
	e := oneConfigEvent(t, s, "blocklist_removed", "DeleteBlocklistEntry")
	if !strings.Contains(e.Message, goodRelease) || e.Data["release"] != goodRelease {
		t.Errorf("entry = %q %v, want the Release named", e.Message, e.Data)
	}
	// An entry that is already gone is a 404 and leaves nothing.
	if r := s.valid("DELETE", fmt.Sprintf("/blocklist/%d", list.Items[0].ID), ""); r.Status != 404 {
		t.Fatalf("second delete = %d", r.Status)
	}
	if got := configEvents(t, s, "blocklist_removed"); len(got) != 1 {
		t.Errorf("%d entries, want 1", len(got))
	}
}
