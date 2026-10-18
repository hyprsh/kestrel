package scoring_test

import (
	"github.com/hyprsh/kestrel/internal/slot"
	"reflect"
	"testing"

	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring"
)

var englishHD = scoring.ProfileSpec{
	Slot:    slot.Standard,
	Rule:    scoring.PrimaryLanguage,
	Primary: release.LangEnglish,
}

var originalEnglish = scoring.Title{Name: "A Movie", OriginalLanguage: release.LangEnglish}

func mustMovie(t testing.TB, name string) release.ParsedRelease {
	t.Helper()
	p, err := release.Parse(name, release.KindMovie)
	if err != nil {
		t.Fatalf("Parse(%q): %v", name, err)
	}
	return p
}

func evalMovie(t testing.TB, snap *scoring.Snapshot, spec scoring.ProfileSpec, name string) scoring.Verdict {
	t.Helper()
	prof, err := snap.Profile(spec)
	if err != nil {
		t.Fatalf("Profile: %v", err)
	}
	return scoring.Evaluate(scoring.Release{Parsed: mustMovie(t, name)}, originalEnglish, prof)
}

func matchedNames(v scoring.Verdict) []string {
	var out []string
	for _, m := range v.Matched {
		out = append(out, m.Name)
	}
	return out
}

func TestScoreIsTheSumOfMatchedFormatsUnderTheBackingProfilesScoreSet(t *testing.T) {
	snap := newFakeSnapshot().
		cf("radarr", "aaa", "Zeta Group", `{"default":100,"german":7}`, groupSpec("^ZETA$", false, false)).
		cf("radarr", "bbb", "Alpha Web", `{"default":50}`, titleSpec(`\bWEB[-_. ]?DL\b`, false, false)).
		cf("radarr", "ccc", "Never", `{"default":9999}`, titleSpec("NEVERMATCHES", false, false)).
		profile("radarr", "hd-bluray-web", "p1", "", 0, map[string]string{"Zeta Group": "aaa", "Alpha Web": "bbb", "Never": "ccc"}).
		load(t)

	v := evalMovie(t, snap, englishHD, "A.Movie.2020.1080p.WEB-DL.DD5.1.H264-ZETA")

	if want := 150; v.Score != want {
		t.Errorf("Score = %d, want %d (default score set)", v.Score, want)
	}
	// Matched formats come back ordered by name, like Radarr and Sonarr.
	if got, want := matchedNames(v), []string{"Alpha Web", "Zeta Group"}; !reflect.DeepEqual(got, want) {
		t.Errorf("matched = %v, want %v", got, want)
	}
}

func TestScoreUsesTheProfilesTrashScoreSet(t *testing.T) {
	snap := newFakeSnapshot().
		cf("radarr", "aaa", "Zeta Group", `{"default":100,"german":7}`, groupSpec("^ZETA$", false, false)).
		profile("radarr", "hd-bluray-web", "p1", "german", 0, map[string]string{"Zeta Group": "aaa"}).
		load(t)

	v := evalMovie(t, snap, englishHD, "A.Movie.2020.1080p.WEB-DL.DD5.1.H264-ZETA")
	if v.Score != 7 {
		t.Errorf("Score = %d, want 7 (german set)", v.Score)
	}
}

func TestDefaultGroupsThatIncludeTheBackingProfileAreApplied(t *testing.T) {
	snap := newFakeSnapshot().
		cf("radarr", "f01", "From Profile", `{"default":1}`, titleSpec("1080p", false, false)).
		cf("radarr", "g01", "Required In Group", `{"default":10}`, titleSpec("1080p", false, false)).
		cf("radarr", "g02", "Default In Group", `{"default":100}`, titleSpec("1080p", false, false)).
		cf("radarr", "g03", "Optional In Group", `{"default":1000}`, titleSpec("1080p", false, false)).
		cf("radarr", "o01", "In Other Group", `{"default":10000}`, titleSpec("1080p", false, false)).
		cf("radarr", "o02", "In Non-Default Group", `{"default":100000}`, titleSpec("1080p", false, false)).
		cf("radarr", "o03", "In Group Without Default Flag", `{"default":1000000}`, titleSpec("1080p", false, false)).
		profile("radarr", "hd-bluray-web", "p1", "", 0, map[string]string{"From Profile": "f01"}).
		group("radarr", "applied", `"true"`, `"HD":"p1"`,
			`{"name":"Required In Group","trash_id":"g01","required":true},`+
				`{"name":"Default In Group","trash_id":"g02","required":false,"default":true},`+
				`{"name":"Optional In Group","trash_id":"g03","required":false,"default":false}`).
		group("radarr", "other-profile", `"true"`, `"Other":"zzz"`,
			`{"name":"In Other Group","trash_id":"o01","required":true}`).
		group("radarr", "opt-in", `"false"`, `"HD":"p1"`,
			`{"name":"In Non-Default Group","trash_id":"o02","required":true}`).
		group("radarr", "no-flag", "", `"HD":"p1"`,
			`{"name":"In Group Without Default Flag","trash_id":"o03","required":true}`).
		load(t)

	v := evalMovie(t, snap, englishHD, "A.Movie.2020.1080p.WEB-DL.DD5.1.H264-GRP")
	got := matchedNames(v)
	want := []string{"Default In Group", "From Profile", "Required In Group"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("matched = %v, want %v", got, want)
	}
	if v.Score != 111 {
		t.Errorf("Score = %d, want 111", v.Score)
	}
}

func TestACustomFormatInSeveralPlacesCountsOnce(t *testing.T) {
	snap := newFakeSnapshot().
		cf("radarr", "f01", "Twice", `{"default":5}`, titleSpec("1080p", false, false)).
		profile("radarr", "hd-bluray-web", "p1", "", 0, map[string]string{"Twice": "f01"}).
		group("radarr", "again", `"true"`, `"HD":"p1"`, `{"name":"Twice","trash_id":"f01","required":true}`).
		load(t)

	if v := evalMovie(t, snap, englishHD, "A.Movie.2020.1080p.WEB-DL-GRP"); v.Score != 5 {
		t.Errorf("Score = %d, want 5", v.Score)
	}
}

func TestMatchedFormatsReportTheirScore(t *testing.T) {
	snap := newFakeSnapshot().
		cf("radarr", "f01", "Scored", `{"default":-35000}`, titleSpec("1080p", false, false)).
		profile("radarr", "hd-bluray-web", "p1", "", 0, map[string]string{"Scored": "f01"}).
		load(t)

	v := evalMovie(t, snap, englishHD, "A.Movie.2020.1080p.WEB-DL-GRP")
	want := []scoring.MatchedFormat{{TrashID: "f01", Name: "Scored", Score: -35000}}
	if !reflect.DeepEqual(v.Matched, want) {
		t.Errorf("Matched = %+v, want %+v", v.Matched, want)
	}
}
