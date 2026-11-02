package api_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/metadata/metadatatest"
)

type slotJSON struct {
	ID             string  `json:"id"`
	Label          string  `json:"label"`
	DefaultMovies  *string `json:"default_movies"`
	DefaultSeries  *string `json:"default_series"`
	OnForNewTitles bool    `json:"on_for_new_titles"`
	Position       int     `json:"position"`
	FromConfigFile bool    `json:"from_config_file"`
}

func slotList(t *testing.T, b *browser) []slotJSON {
	t.Helper()
	return decode[struct {
		Items []slotJSON `json:"items"`
	}](t, b.valid("GET", "/slots", "")).Items
}

func slotIDs(slots []slotJSON) string {
	var ids []string
	for _, s := range slots {
		ids = append(ids, s.ID)
	}
	return strings.Join(ids, ",")
}

func TestSlotsAreSeededWithTheStandardAndTheOptInFourK(t *testing.T) {
	t.Parallel()
	b := newInstance(t, "").setUp()
	got := slotList(t, b)
	if len(got) != 2 {
		t.Fatalf("slots = %+v", got)
	}
	std, fourK := got[0], got[1]
	if std.ID != "standard" || std.Label != "Standard" || !std.OnForNewTitles || std.Position != 0 || std.FromConfigFile ||
		std.DefaultMovies == nil || *std.DefaultMovies != "hd-primary" || std.DefaultSeries == nil || *std.DefaultSeries != "hd-primary" {
		t.Errorf("standard = %+v", std)
	}
	if fourK.ID != "4k" || fourK.Label != "4K" || fourK.OnForNewTitles || fourK.Position != 1 || fourK.DefaultMovies != nil || fourK.DefaultSeries != nil {
		t.Errorf("4k = %+v", fourK)
	}
}

func TestSlotEndpointsNeedALogin(t *testing.T) {
	t.Parallel()
	anon := newInstance(t, "").browser()
	for _, c := range [][2]string{{"GET", "/slots"}, {"POST", "/slots"}, {"PATCH", "/slots/standard"}, {"DELETE", "/slots/standard"}} {
		if r := anon.do(c[0], c[1], `{}`); r.Status != 401 {
			t.Errorf("anonymous %s %s = %d", c[0], c[1], r.Status)
		}
	}
}

func TestASlotIsCreatedChangedMovedAndDeleted(t *testing.T) {
	t.Parallel()
	b := newInstance(t, "").setUp()

	r := b.valid("POST", "/slots", `{"label":"Remux","default_movies":"4k-primary","on_for_new_titles":true}`)
	if r.Status != 201 {
		t.Fatalf("POST /slots = %d %s", r.Status, r.Body)
	}
	if s := decode[slotJSON](t, r); s.ID != "remux" || s.Position != 2 || !s.OnForNewTitles || s.DefaultMovies == nil || *s.DefaultMovies != "4k-primary" {
		t.Errorf("created = %+v", s)
	}

	r = b.valid("PATCH", "/slots/remux", `{"label":"Remux archive","position":0,"default_movies":""}`)
	if s := decode[slotJSON](t, r); r.Status != 200 || s.ID != "remux" || s.Label != "Remux archive" || s.Position != 0 || s.DefaultMovies != nil {
		t.Errorf("PATCH = %d %+v", r.Status, s)
	}
	if got := slotIDs(slotList(t, b)); got != "remux,standard,4k" {
		t.Errorf("order = %s", got)
	}

	if r := b.valid("DELETE", "/slots/remux", ""); r.Status != 204 {
		t.Errorf("DELETE = %d %s", r.Status, r.Body)
	}
	if got := slotIDs(slotList(t, b)); got != "standard,4k" {
		t.Errorf("after the delete = %s", got)
	}
}

func TestSlotValuesThatBreakARuleAreValidationErrors(t *testing.T) {
	t.Parallel()
	b := newInstance(t, "").setUp()
	for _, c := range []struct{ name, body, field string }{
		{"a bracket in the label", `{"label":"Re[mux"}`, "label"},
		{"an empty label", `{"label":""}`, "label"},
		{"a leading space", `{"label":" Remux"}`, "label"},
		{"too long", `{"label":"` + strings.Repeat("a", 25) + `"}`, "label"},
		{"a duplicate label", `{"label":"standard"}`, "label"},
		{"a duplicate label in another case", `{"label":"4k"}`, "label"},
		{"an unknown default Profile", `{"label":"Dub","default_movies":"nope"}`, "default_movies"},
	} {
		r := b.do("POST", "/slots", c.body)
		if r.Status != 422 || !strings.Contains(r.Body, `"code":"validation"`) || !strings.Contains(r.Body, `"field":"`+c.field+`"`) {
			t.Errorf("%s: POST = %d %s, want 422 on %s", c.name, r.Status, r.Body, c.field)
		}
	}

	for _, label := range []string{"A", "B"} {
		if r := b.valid("POST", "/slots", `{"label":"`+label+`"}`); r.Status != 201 {
			t.Fatalf("POST %s = %d %s", label, r.Status, r.Body)
		}
	}
	if r := b.do("POST", "/slots", `{"label":"Fifth"}`); r.Status != 422 {
		t.Errorf("a 5th Slot = %d %s, want 422", r.Status, r.Body)
	}

	if r := b.do("PATCH", "/slots/4k", `{"label":"STANDARD"}`); r.Status != 422 {
		t.Errorf("renaming onto another label = %d %s, want 422", r.Status, r.Body)
	}
	if r := b.do("PATCH", "/slots/4k", `{"position":9}`); r.Status != 422 || !strings.Contains(r.Body, `"field":"position"`) {
		t.Errorf("a position past the end = %d %s, want 422", r.Status, r.Body)
	}
	if r := b.do("PATCH", "/slots/nope", `{}`); r.Status != 404 {
		t.Errorf("PATCH of an unknown Slot = %d %s, want 404", r.Status, r.Body)
	}
}

func TestSlotsThatTheLibraryNeedsAreDeleteConflicts(t *testing.T) {
	t.Parallel()
	l := newLibraryInstance(t, metadatatest.Key)

	// Standard is the only Slot on for new Titles, so it cannot go while another Slot is there to stay.
	if r := l.do("DELETE", "/slots/standard", ""); r.Status != 409 {
		t.Errorf("DELETE of the last on-for-new Slot = %d %s, want 409", r.Status, r.Body)
	}
	if r := l.do("PATCH", "/slots/standard", `{"on_for_new_titles":false}`); r.Status != 409 {
		t.Errorf("switching off the last on-for-new Slot = %d %s, want 409", r.Status, r.Body)
	}

	// A Title with Versions in both Slots holds them.
	if r := l.valid("POST", "/titles", addPaddington); r.Status != 201 {
		t.Fatalf("POST /titles = %d %s", r.Status, r.Body)
	}
	if r := l.do("DELETE", "/slots/4k", ""); r.Status != 409 || !strings.Contains(r.Body, "1 Version") {
		t.Errorf("DELETE of a Slot that holds a Version = %d %s, want 409 saying how many", r.Status, r.Body)
	}

	// Once nothing uses it, 4K goes, and then the last Slot cannot.
	l.valid("DELETE", fmt.Sprintf("/versions/%d", versionOf(t, l.browser, "4k")), "")
	if r := l.valid("DELETE", "/slots/4k", ""); r.Status != 204 {
		t.Fatalf("DELETE of an empty Slot = %d %s", r.Status, r.Body)
	}
	if r := l.do("DELETE", "/slots/standard", ""); r.Status != 409 {
		t.Errorf("DELETE of the last Slot = %d %s, want 409", r.Status, r.Body)
	}
}

// versionOf is the id of the Version in sl of the only Title.
func versionOf(t *testing.T, b *browser, sl string) int64 {
	t.Helper()
	list := decode[struct {
		Items []struct {
			ID int64 `json:"id"`
		} `json:"items"`
	}](t, b.valid("GET", "/titles", ""))
	got := decode[titleJSON](t, b.valid("GET", fmt.Sprintf("/titles/%d", list.Items[0].ID), ""))
	for _, v := range got.Versions {
		if v.Slot == sl {
			return v.ID
		}
	}
	t.Fatalf("no Version in %s: %+v", sl, got.Versions)
	return 0
}

func TestASlotFieldNamingNoSlotIsAValidationError(t *testing.T) {
	t.Parallel()
	l := newLibraryInstance(t, metadatatest.Key)
	r := l.do("POST", "/titles", `{"kind":"movie","tmdb_id":116149,"versions":[{"slot":"remux","profile":"hd-primary"}]}`)
	if r.Status != 422 || !strings.Contains(r.Body, `"field":"versions[0].slot"`) {
		t.Errorf("an unknown Slot = %d %s, want 422 on versions[0].slot", r.Status, r.Body)
	}
	if r := l.do("GET", "/events?slot=remux", ""); r.Status != 422 {
		t.Errorf("an unknown Slot in a filter = %d %s, want 422", r.Status, r.Body)
	}
	// Once the Slot exists, the id is a Slot like any other, and the filter takes it.
	l.valid("POST", "/slots", `{"label":"Remux"}`)
	if r := l.valid("GET", "/events?slot=remux", ""); r.Status != 200 {
		t.Errorf("a defined Slot in a filter = %d %s", r.Status, r.Body)
	}
}

const declaredSlots = `slots:
  - id: standard
    label: Everyday
    default_movies: hd-primary
    default_series: any-primary
    on_for_new_titles: true
  - label: Remux
`

func TestDeclaredSlotsAreAppliedAndReadOnly(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	b := in.setUp()
	in.mustDeclare(declaredSlots)

	got := slotList(t, b)
	if slotIDs(got) != "standard,remux" || got[0].Label != "Everyday" || got[0].DefaultSeries == nil || *got[0].DefaultSeries != "any-primary" || got[1].OnForNewTitles {
		t.Errorf("slots = %+v", got)
	}
	for _, s := range got {
		if !s.FromConfigFile {
			t.Errorf("%s: from_config_file = false, want true while the file declares slots", s.ID)
		}
	}
	in.conflictNamingTheFile("POST /slots", b.valid("POST", "/slots", `{"label":"Dub"}`))
	in.conflictNamingTheFile("PATCH /slots/standard", b.valid("PATCH", "/slots/standard", `{"label":"Other"}`))
	in.conflictNamingTheFile("DELETE /slots/remux", b.valid("DELETE", "/slots/remux", ""))
	if after := slotList(t, b); len(after) != 2 || after[0].Label != "Everyday" {
		t.Errorf("after the refused writes: %+v", after)
	}

	before := in.writes()
	in.mustDeclare(declaredSlots)
	if after := in.writes(); after != before {
		t.Errorf("the second start changed %d rows", after-before)
	}
}

func TestDroppingANonEmptySlotFromTheFileFailsStartupNamingIt(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	b := in.setUp()
	for _, q := range []string{
		`INSERT INTO titles (id, kind, title, original_title, primary_title, tmdb_id, root_folder, added_at, refreshed_at) VALUES (1, 'movie', 'T', 'T', 'T', 1, '/m', 'x', 'x')`,
		`INSERT INTO versions (title_id, slot, profile_key, added_at) VALUES (1, '4k', '4k-primary', 'x')`,
	} {
		if _, err := in.st.Write().Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	err := in.declare("slots:\n  - {id: standard, label: Standard, on_for_new_titles: true}\n")
	if err == nil || !strings.Contains(err.Error(), "slots") || !strings.Contains(err.Error(), `"4k"`) || !strings.Contains(err.Error(), "1 Version") {
		t.Fatalf("err = %v, want one naming the Slot 4k and its Version count", err)
	}
	if got := slotIDs(slotList(t, b)); got != "standard,4k" {
		t.Errorf("a failed start changed the Slots: %s", got)
	}
}

func TestAnInvalidSlotsSectionFailsStartup(t *testing.T) {
	t.Parallel()
	for name, c := range map[string]struct{ body, want string }{
		"none on for new Titles": {"slots:\n  - {label: A}\n", "on for new Titles"},
		"a bad label":            {"slots:\n  - {label: 'A[', on_for_new_titles: true}\n", "label"},
		"a duplicate label":      {"slots:\n  - {label: A, on_for_new_titles: true}\n  - {label: a}\n", "labels are unique"},
		"no label":               {"slots:\n  - {id: a, on_for_new_titles: true}\n", "slots[0].label"},
		"five Slots":             {"slots:\n  - {label: A, on_for_new_titles: true}\n  - {label: B}\n  - {label: C}\n  - {label: D}\n  - {label: E}\n", "at most 4"},
		"an unknown Profile":     {"slots:\n  - {label: A, on_for_new_titles: true, default_movies: nope}\n", "no such Profile"},
		"an unknown key":         {"slots:\n  - {label: A, root_folder: /x}\n", "root_folder"},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			in := newInstance(t, "")
			err := in.declare(c.body)
			if err == nil || !strings.Contains(err.Error(), c.want) || !strings.Contains(err.Error(), "slots") {
				t.Fatalf("err = %v, want one naming slots and %q", err, c.want)
			}
		})
	}
}
