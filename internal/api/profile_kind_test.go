package api_test

import (
	"fmt"
	"strings"
	"testing"
)

// moviesOnly makes hd-original SQP, a Profile with a TRaSH profile for Movies and none for Series.
func (b bulkLibrary) moviesOnly(t *testing.T) {
	t.Helper()
	if _, err := b.in.st.Write().Exec(`UPDATE profiles SET release_family = 'sqp', trash_profile_movies = 'sqp-1-1080p', trash_profile_series = '' WHERE key = 'hd-original'`); err != nil {
		t.Fatal(err)
	}
}

func wantProfileKind(t *testing.T, what string, r reply) {
	t.Helper()
	if r.Status != 422 || !strings.Contains(r.Body, `"code":"profile_kind"`) {
		t.Errorf("%s = %d %s, want 422 profile_kind", what, r.Status, r.Body)
	}
}

func TestAProfileShowsTheKindsItAppliesTo(t *testing.T) {
	t.Parallel()
	b := newBulkLibrary(t)
	b.moviesOnly(t)
	m := profileMap(t, b.browser)
	if k := m["hd-primary"].Kinds; len(k) != 2 || k[0] != "movie" || k[1] != "series" {
		t.Errorf("hd-primary applies to %v, want movie and series", k)
	}
	if k := m["hd-original"].Kinds; len(k) != 1 || k[0] != "movie" {
		t.Errorf("hd-original (SQP) applies to %v, want movie only", k)
	}
}

func TestAMoviesOnlyProfileCannotBeUsedForASeries(t *testing.T) {
	t.Parallel()
	b := newBulkLibrary(t)
	b.moviesOnly(t)

	// Adding a Series under it.
	wantProfileKind(t, "POST /titles", b.do("POST", "/titles", `{"kind":"series","tmdb_id":7001,"versions":[{"slot":"standard","profile":"hd-original"}]}`))
	// Adding a Version to a Series, and switching one.
	wantProfileKind(t, "add Version", b.do("POST", fmt.Sprintf("/titles/%d/versions", b.breakingBad), `{"slot":"4k","profile":"hd-original"}`))
	var vid int64
	if err := b.in.st.Read().QueryRow(`SELECT id FROM versions WHERE title_id = ?`, b.breakingBad).Scan(&vid); err != nil {
		t.Fatal(err)
	}
	wantProfileKind(t, "switch Version", b.do("PATCH", fmt.Sprintf("/versions/%d", vid), `{"profile":"hd-original"}`))
	// A Request.
	wantProfileKind(t, "POST /requests", b.do("POST", "/requests", requestBody("r-9", "series", 7001, `[{"slot":"standard","profile":"hd-original"}]`, "null")))
	// A Movie takes it, one by one and in bulk.
	if r := b.do("POST", fmt.Sprintf("/titles/%d/versions", b.memento), `{"slot":"standard","profile":"hd-original"}`); r.Status != 201 {
		t.Errorf("a Movie Version under a Movies-only Profile = %d %s", r.Status, r.Body)
	}
}

func TestASlotsDefaultForAKindMustApplyToIt(t *testing.T) {
	t.Parallel()
	b := newBulkLibrary(t)
	b.moviesOnly(t)
	r := b.do("PATCH", "/slots/standard", `{"default_series":"hd-original"}`)
	if r.Status != 422 || !strings.Contains(r.Body, `"field":"default_series"`) {
		t.Errorf("a Movies-only Series default = %d %s, want 422 on default_series", r.Status, r.Body)
	}
	if r := b.do("PATCH", "/slots/standard", `{"default_movies":"hd-original"}`); r.Status != 200 {
		t.Errorf("a Movies-only Movies default = %d %s, want 200", r.Status, r.Body)
	}
}

// A bulk call skips the Series a Movies-only Profile cannot serve, as it skips a taken Profile, and goes on with the rest.
func TestABulkCallSkipsASeriesForAMoviesOnlyProfile(t *testing.T) {
	t.Parallel()
	b := newBulkLibrary(t)
	b.moviesOnly(t)

	got := b.bulk(t, fmt.Sprintf(`{"action":"switch_profile","slot":"standard","profile":"hd-original","title_ids":[%d,%d]}`, b.paddington, b.breakingBad))
	if o := got.outcomes(); o["changed"] != 1 || o["skipped/profile_kind"] != 1 {
		t.Errorf("switch outcomes = %v, want the Movie changed and the Series skipped as profile_kind", o)
	}
	if got.Items[1].TitleID != b.breakingBad || got.Items[1].Reason == nil || *got.Items[1].Reason != "profile_kind" {
		t.Errorf("Breaking Bad = %+v", got.Items[1])
	}
	if p := b.profileIn(t, b.breakingBad, "standard"); p == "hd-original" {
		t.Error("the Series moved to a Movies-only Profile")
	}

	got = b.bulk(t, fmt.Sprintf(`{"action":"add_version","slot":"4k","profile":"hd-original","title_ids":[%d,%d]}`, b.memento, b.breakingBad))
	if o := got.outcomes(); o["skipped/profile_kind"] != 1 {
		t.Errorf("add outcomes = %v, want the Series skipped as profile_kind", o)
	}
	if p := b.profileIn(t, b.breakingBad, "4k"); p != "" {
		t.Errorf("the Series got a Version under %q", p)
	}
}
