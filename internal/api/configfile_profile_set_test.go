package api_test

import (
	"slices"
	"strings"
	"testing"
)

// twoProfiles declares two Profiles, one of the builtin keys on its builtin recipe and one recipe Profile, and two Slots.
const twoProfiles = `profiles:
  hd-primary: {enabled: true, original_language: reject}
  remux-4k:   {enabled: true, original_language: offer, name: 4K Remux, release_family: remux-web, resolution: uhd, language_rule: primary}
slots:
  - {id: standard, label: Standard, default_movies: hd-primary, default_series: hd-primary, on_for_new_titles: true}
  - {id: remux, label: Remux, default_movies: remux-4k, default_series: remux-4k}
`

func profileKeysOf(m map[string]profileJSON) []string {
	var keys []string
	for k := range m {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	return keys
}

func checkTwoProfiles(t *testing.T, b *browser) {
	t.Helper()
	got := profileMapAll(t, b)
	if keys := profileKeysOf(got); !slices.Equal(keys, []string{"hd-primary", "remux-4k"}) {
		t.Fatalf("profiles = %v, want exactly hd-primary and remux-4k", keys)
	}
	r := got["remux-4k"]
	if r.Name != "4K Remux" || r.ReleaseFamily != "remux-web" || r.LanguageRule != "primary" || r.MinHeight != 2160 ||
		r.OriginalLanguage != "offer" || r.TrashProfileMovies != "remux-web-2160p" || r.TrashProfileSeries != "remux-web-2160p" {
		t.Errorf("remux-4k = %+v", r)
	}
	if h := got["hd-primary"]; h.Name != "HD" || h.ReleaseFamily != "bluray-web" || !h.Enabled {
		t.Errorf("hd-primary = %+v, want the builtin recipe", h)
	}
	if s := b.valid("GET", "/slots", "").Body; !strings.Contains(s, `"id":"remux"`) || strings.Contains(s, `"id":"4k"`) {
		t.Errorf("slots = %s", s)
	}
}

func TestAFileDeclaringTwoProfilesAndTwoSlotsOnAFreshInstallStartsWithExactlyThose(t *testing.T) {
	t.Parallel()
	in := newFreshInstance(t, "")
	in.mustDeclare(twoProfiles)
	checkTwoProfiles(t, in.setUp())
}

func TestAFileDeclaringTwoProfilesOnAnUpgradedInstallRemovesTheOthers(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	in.mustDeclare(twoProfiles)
	b := in.setUp()
	checkTwoProfiles(t, b)

	before := in.writes()
	in.mustDeclare(twoProfiles)
	if after := in.writes(); after != before {
		t.Errorf("the second start changed %d rows", after-before)
	}

	for _, c := range []struct{ method, path, body string }{
		{"POST", "/profiles", `{"name":"X","copy_from":"hd-primary"}`},
		{"PATCH", "/profiles/hd-primary", `{"enabled":false}`},
		{"DELETE", "/profiles/remux-4k", ""},
	} {
		in.conflictNamingTheFile(c.method+" "+c.path, b.valid(c.method, c.path, c.body))
	}
}

func TestADeclaredRecipeProfileNeedsANameARecipeAndAResolution(t *testing.T) {
	t.Parallel()
	for _, field := range []string{"name", "release_family", "resolution", "language_rule"} {
		t.Run(field, func(t *testing.T) {
			t.Parallel()
			var kept []string
			for _, kv := range []string{"name: 4K Remux", "release_family: remux-web", "resolution: uhd", "language_rule: primary"} {
				if !strings.HasPrefix(kv, field+":") {
					kept = append(kept, kv)
				}
			}
			body := strings.Replace(twoProfiles, "name: 4K Remux, release_family: remux-web, resolution: uhd, language_rule: primary", strings.Join(kept, ", "), 1)
			err := newInstance(t, "").declare(declaredAccount+body, "KESTREL_ADMIN_PASSWORD", "correct horse")
			if err == nil || !strings.Contains(err.Error(), "profiles.remux-4k."+field) {
				t.Fatalf("err = %v, want one naming profiles.remux-4k.%s", err, field)
			}
		})
	}
}

func TestAProfileTheFileLeavesOutThatAVersionUsesFailsStartupNamingIt(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	b := in.setUp()
	for _, q := range []string{
		`INSERT INTO titles (id, kind, title, original_title, primary_title, tmdb_id, root_folder, added_at, refreshed_at) VALUES (1, 'movie', 'T', 'T', 'T', 1, '/m', 'x', 'x')`,
		`INSERT INTO versions (title_id, slot, profile_key, added_at) VALUES (1, 'standard', '4k-original', 'x')`,
	} {
		if _, err := in.st.Write().Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	err := in.declare(twoProfiles)
	if err == nil || !strings.Contains(err.Error(), "profiles") || !strings.Contains(err.Error(), "4k-original") || !strings.Contains(err.Error(), "1 Version") {
		t.Fatalf("err = %v, want one naming the Profile 4k-original and its Version count", err)
	}
	if got := profileKeysOf(profileMapAll(t, b)); len(got) != 6 {
		t.Errorf("a failed start changed the Profiles: %v", got)
	}
}

func TestAProfileTheFileLeavesOutThatASlotDefaultsToFailsStartupNamingIt(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	// The file declares no Slots, so the saved ones stand: Standard defaults to hd-primary and 4K to 4k-primary.
	err := in.declare("profiles:\n  hd-primary: {enabled: true, original_language: reject}\n")
	if err == nil || !strings.Contains(err.Error(), "4k-primary") {
		t.Fatalf("err = %v, want one naming 4k-primary", err)
	}
}
