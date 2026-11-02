package api_test

import (
	"strings"
	"testing"
)

type presetJSON struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Slots []struct {
		Label          string  `json:"label"`
		DefaultMovies  *string `json:"default_movies"`
		DefaultSeries  *string `json:"default_series"`
		OnForNewTitles bool    `json:"on_for_new_titles"`
	} `json:"slots"`
}

type presetsJSON struct {
	Available bool         `json:"available"`
	Items     []presetJSON `json:"items"`
}

func presetList(t *testing.T, b *browser) presetsJSON {
	t.Helper()
	return decode[presetsJSON](t, b.valid("GET", "/slots/presets", ""))
}

// profileNamed is the Profile with the name, or fails.
func profileNamed(t *testing.T, b *browser, name string) profileJSON {
	t.Helper()
	for _, p := range profileMapAll(t, b) {
		if p.Name == name {
			return p
		}
	}
	t.Fatalf("no Profile named %q", name)
	return profileJSON{}
}

func slotNamed(t *testing.T, b *browser, label string) slotJSON {
	t.Helper()
	for _, s := range slotList(t, b) {
		if s.Label == label {
			return s
		}
	}
	t.Fatalf("no Slot labelled %q", label)
	return slotJSON{}
}

func TestAFreshLibraryIsOfferedTheFourPresetsLabelledWithThePrimaryLanguage(t *testing.T) {
	t.Parallel()
	b := newFreshInstance(t, "").setUp()
	setPrimary(t, b, "de")
	got := presetList(t, b)
	if !got.Available {
		t.Fatal("presets are not available on a library with no Version")
	}
	var names []string
	for _, p := range got.Items {
		names = append(names, p.Name)
	}
	if want := "One copy, Standard + 4K, Streaming + Remux archive, German + Original"; strings.Join(names, ", ") != want {
		t.Errorf("presets = %s, want %s", strings.Join(names, ", "), want)
	}
	last := got.Items[3]
	if len(last.Slots) != 2 || last.Slots[0].Label != "German" || last.Slots[1].Label != "Original" {
		t.Errorf("slots of the language preset = %+v", last.Slots)
	}
}

func TestAGermanHouseholdChoosingGermanPlusOriginalGetsBothSlotsAndTheirProfiles(t *testing.T) {
	t.Parallel()
	b := newFreshInstance(t, "").setUp()
	setPrimary(t, b, "de")

	r := b.valid("POST", "/slots/presets/language-plus-original", "")
	if r.Status != 200 {
		t.Fatalf("apply = %d %s", r.Status, r.Body)
	}
	slots := slotList(t, b)
	if len(slots) != 2 {
		t.Fatalf("slots = %+v", slots)
	}
	hd, orig := profileNamed(t, b, "HD"), profileNamed(t, b, "HD Original")
	if !hd.Enabled || !orig.Enabled || hd.LanguageRule != "primary" || orig.LanguageRule != "original" {
		t.Errorf("profiles = %+v, %+v", hd, orig)
	}
	for i, want := range []struct {
		label, profile string
	}{{"German", hd.Key}, {"Original", orig.Key}} {
		s := slots[i]
		if s.Label != want.label || !s.OnForNewTitles || s.Position != i ||
			s.DefaultMovies == nil || *s.DefaultMovies != want.profile || s.DefaultSeries == nil || *s.DefaultSeries != want.profile {
			t.Errorf("slot %d = %+v, want %s on, defaults %s", i, s, want.label, want.profile)
		}
	}
	// The wizard can finish on the Slots' defaults alone.
	if st := decode[struct {
		Sections struct {
			Profiles string `json:"profiles"`
		} `json:"sections"`
	}](t, b.valid("GET", "/setup", "")); st.Sections.Profiles != "done" {
		t.Errorf("profiles section = %q, want done", st.Sections.Profiles)
	}
}

func TestStreamingPlusRemuxArchiveMakesAMoviesOnlyDefaultThatIsOffForNewTitles(t *testing.T) {
	t.Parallel()
	b := newFreshInstance(t, "").setUp()
	setPrimary(t, b, "fr")

	if r := b.valid("POST", "/slots/presets/streaming-remux-archive", ""); r.Status != 200 {
		t.Fatalf("apply = %d %s", r.Status, r.Body)
	}
	std, remux := slotNamed(t, b, "Standard"), slotNamed(t, b, "Remux")
	rmx := profileNamed(t, b, "4K Remux")
	if !rmx.Enabled || len(rmx.Kinds) != 1 || rmx.Kinds[0] != "movie" {
		t.Errorf("4K Remux = %+v, want enabled and Movies only under a French household", rmx)
	}
	if remux.OnForNewTitles || remux.DefaultMovies == nil || *remux.DefaultMovies != rmx.Key || remux.DefaultSeries != nil {
		t.Errorf("Remux slot = %+v", remux)
	}
	if !std.OnForNewTitles || std.DefaultMovies == nil || std.DefaultSeries == nil {
		t.Errorf("Standard slot = %+v", std)
	}
	if std.Position != 0 || remux.Position != 1 {
		t.Errorf("order = %d, %d", std.Position, remux.Position)
	}
}

func TestChoosingAPresetReusesAProfileTheHouseholdAlreadyHas(t *testing.T) {
	t.Parallel()
	b := newInstance(t, "").setUp() // the six Profiles of an existing install
	if r := b.valid("POST", "/slots/presets/standard-plus-4k", ""); r.Status != 200 {
		t.Fatalf("apply = %d %s", r.Status, r.Body)
	}
	if n := len(profileMapAll(t, b)); n != 6 {
		t.Errorf("%d Profiles, want the same six", n)
	}
	if s := slotNamed(t, b, "4K"); s.DefaultMovies == nil || *s.DefaultMovies != "4k-primary" || s.OnForNewTitles {
		t.Errorf("4K slot = %+v", s)
	}
}

func TestOnceAVersionExistsNoPresetsAreOfferedOrApplied(t *testing.T) {
	t.Parallel()
	b := newBulkLibrary(t)
	got := presetList(t, b.browser)
	if got.Available || len(got.Items) != 0 {
		t.Errorf("presets = %+v, want none", got)
	}
	before := slotList(t, b.browser)
	if r := b.do("POST", "/slots/presets/one-copy", ""); r.Status != 409 {
		t.Errorf("apply = %d %s, want 409", r.Status, r.Body)
	}
	if after := slotList(t, b.browser); len(after) != len(before) {
		t.Errorf("slots changed: %+v", after)
	}
}

func TestAnUnknownPresetIsNotFound(t *testing.T) {
	t.Parallel()
	b := newFreshInstance(t, "").setUp()
	if r := b.do("POST", "/slots/presets/nope", ""); r.Status != 404 && r.Status != 400 {
		t.Errorf("unknown preset = %d %s", r.Status, r.Body)
	}
}

func TestAFailingPresetLeavesTheSlotsAndProfilesAsTheyWere(t *testing.T) {
	t.Parallel()
	b := newFreshInstance(t, "").setUp()
	// A Profile that already has the name the preset's second Profile would get, after the first has been made.
	b.valid("POST", "/profiles", `{"release_family":"bluray-web","resolution":"uhd","language_rule":"primary","name":"HD Original"}`)
	slotsBefore, profilesBefore := slotList(t, b), profileMapAll(t, b)

	r := b.do("POST", "/slots/presets/language-plus-original", "")
	if r.Status != 422 {
		t.Fatalf("apply = %d %s, want 422", r.Status, r.Body)
	}
	if got := slotList(t, b); len(got) != len(slotsBefore) || got[0].ID != slotsBefore[0].ID || got[0].DefaultMovies != nil {
		t.Errorf("slots = %+v, want %+v", got, slotsBefore)
	}
	if got := profileMapAll(t, b); len(got) != len(profilesBefore) {
		t.Errorf("%d Profiles, want %d", len(got), len(profilesBefore))
	}
}
