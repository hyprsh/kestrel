package scoring_test

import (
	"fmt"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/hyprsh/kestrel/internal/scoring"
)

// fakeSnapshot builds a small TRaSH-shaped snapshot in memory, so engine
// behaviour can be tested without depending on TRaSH's current data.
type fakeSnapshot struct {
	fs fstest.MapFS
}

func newFakeSnapshot() *fakeSnapshot {
	return &fakeSnapshot{fs: fstest.MapFS{
		"COMMIT":  {Data: []byte("fake-commit\n")},
		"LICENSE": {Data: []byte("MIT")},
	}}
}

// cf adds a Custom Format. specs are raw JSON specification objects.
func (f *fakeSnapshot) cf(app, id, name, scores string, specs ...string) *fakeSnapshot {
	f.fs[fmt.Sprintf("%s/cf/%s.json", app, id)] = &fstest.MapFile{Data: []byte(fmt.Sprintf(
		`{"trash_id":%q,"name":%q,"trash_scores":%s,"specifications":[%s]}`,
		id, name, scores, strings.Join(specs, ",")))}
	return f
}

// profile adds a backing profile with formatItems name->trash_id.
func (f *fakeSnapshot) profile(app, file, id, scoreSet string, minScore int, formatItems map[string]string) *fakeSnapshot {
	var items []string
	for n, tid := range formatItems {
		items = append(items, fmt.Sprintf("%q:%q", n, tid))
	}
	set := ""
	if scoreSet != "" {
		set = fmt.Sprintf(`"trash_score_set":%q,`, scoreSet)
	}
	f.fs[fmt.Sprintf("%s/quality-profiles/%s.json", app, file)] = &fstest.MapFile{Data: []byte(fmt.Sprintf(
		`{"trash_id":%q,"name":%q,%s"minFormatScore":%d,"items":%s,"formatItems":{%s}}`,
		id, file, set, minScore, fakeQualityItems, strings.Join(items, ","))),
	}
	return f
}

// group adds a CF group. defaultFlag is the raw JSON value of "default"
// ("" leaves it out); cfs are raw {name, trash_id, required, default} objects.
func (f *fakeSnapshot) group(app, file, defaultFlag, include string, cfs ...string) *fakeSnapshot {
	def := ""
	if defaultFlag != "" {
		def = `"default":` + defaultFlag + `,`
	}
	f.fs[fmt.Sprintf("%s/cf-groups/%s.json", app, file)] = &fstest.MapFile{Data: []byte(fmt.Sprintf(
		`{"name":%q,"trash_id":%q,%s"custom_formats":[%s],"quality_profiles":{"include":{%s}}}`,
		file, file, def, strings.Join(cfs, ","), include))}
	return f
}

func (f *fakeSnapshot) load(t testing.TB) *scoring.Snapshot {
	t.Helper()
	// Both apps need their three directories to exist.
	for _, app := range []string{"radarr", "sonarr"} {
		for _, dir := range []string{"cf", "cf-groups", "quality-profiles"} {
			keep := app + "/" + dir + "/.keep"
			if _, ok := f.fs[keep]; !ok {
				f.fs[keep] = &fstest.MapFile{}
			}
		}
	}
	// Profile() resolves both apps, so give every backing profile a home
	// unless the test supplied one.
	for app, names := range backingNames {
		for _, n := range names {
			file := app + "/quality-profiles/" + n + ".json"
			if _, ok := f.fs[file]; !ok {
				f.fs[file] = &fstest.MapFile{Data: []byte(`{"trash_id":"` + file + `","minFormatScore":0,"items":` + fakeQualityItems + `,"formatItems":{}}`)}
			}
		}
	}
	s, err := scoring.LoadSnapshot(f.fs)
	if err != nil {
		t.Fatalf("LoadSnapshot: %v", err)
	}
	return s
}

func specJSON(impl, fields string, negate, required bool) string {
	return fmt.Sprintf(`{"name":"s","implementation":%q,"negate":%t,"required":%t,"fields":%s}`, impl, negate, required, fields)
}

func titleSpec(regex string, negate, required bool) string {
	return specJSON("ReleaseTitleSpecification", fmt.Sprintf(`{"value":%q}`, regex), negate, required)
}

func groupSpec(regex string, negate, required bool) string {
	return specJSON("ReleaseGroupSpecification", fmt.Sprintf(`{"value":%q}`, regex), negate, required)
}

// backingNames are the TRaSH profile files of PRD Settled 5.
var backingNames = map[string][]string{
	"radarr": {
		"hd-bluray-web", "uhd-bluray-web",
		"german-hd-bluray-web", "german-uhd-bluray-web",
		"french-multi-vf-hd-bluray-web", "french-multi-vf-uhd-bluray-web",
		"french-multi-vo-hd-bluray-web", "french-multi-vo-uhd-bluray-web",
	},
	"sonarr": {
		"web-1080p", "web-2160p",
		"german-hd-bluray-web", "german-uhd-bluray-web",
		"french-multi-vf-bluray-web-1080p", "french-multi-vf-bluray-web-2160p",
		"french-multi-vo-bluray-web-1080p", "french-multi-vo-bluray-web-2160p",
	},
}

// fakeQualityItems allows the usual 720p-2160p WEB and Bluray qualities and
// nothing else, like TRaSH's "bluray-web" profiles.
const fakeQualityItems = `[` +
	`{"name":"WEBDL-720p","allowed":true},{"name":"WEBRip-720p","allowed":true},{"name":"Bluray-720p","allowed":true},` +
	`{"name":"WEBDL-1080p","allowed":true},{"name":"WEBRip-1080p","allowed":true},{"name":"Bluray-1080p","allowed":true},` +
	`{"name":"WEBDL-2160p","allowed":true},{"name":"WEBRip-2160p","allowed":true},{"name":"Bluray-2160p","allowed":true},` +
	`{"name":"Remux-1080p","allowed":false},{"name":"HDTV-1080p","allowed":false},{"name":"Unknown","allowed":false}]`
