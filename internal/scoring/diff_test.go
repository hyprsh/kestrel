package scoring_test

import (
	"slices"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/hyprsh/kestrel/internal/scoring"
)

// twoSets builds the snapshot before a TRaSH update and the one after: edit changes the second.
func twoSets(t *testing.T, edit func(f *fakeSnapshot)) (*scoring.Snapshot, *scoring.Snapshot) {
	t.Helper()
	base := func() *fakeSnapshot {
		return newFakeSnapshot().
			cf("radarr", "tier1", "WEB Tier 01", `{"default":1700}`, groupSpec("^(ABBIE)$", false, false)).
			cf("radarr", "x265", "x265 (HD)", `{"default":-10000}`, titleSpec("x265", false, false)).
			profile("radarr", "hd-bluray-web", "hd", "", 0, map[string]string{"WEB Tier 01": "tier1", "x265 (HD)": "x265"}).
			profile("radarr", "remux-web-1080p", "remux", "", 0, map[string]string{"WEB Tier 01": "tier1"})
	}
	before := base().load(t)
	f := base()
	edit(f)
	return before, f.load(t)
}

var hdProfile = []scoring.UsedProfile{{Name: "HD", Spec: englishHD}}

func texts(d scoring.TrashDiff, op string) []string {
	var out []string
	for _, c := range d.Changes {
		if c.Op == op {
			out = append(out, c.Text)
		}
	}
	return out
}

func TestAScoreChangeIsNamedUnderTheHouseholdsProfile(t *testing.T) {
	old, nu := twoSets(t, func(f *fakeSnapshot) {
		f.cf("radarr", "tier1", "WEB Tier 01", `{"default":1750}`, groupSpec("^(ABBIE)$", false, false))
	})
	d := scoring.DiffSnapshots(old, nu, hdProfile)
	if got := texts(d, "changed"); !slices.Equal(got, []string{"WEB Tier 01: 1700 → 1750 in HD"}) {
		t.Errorf("changed = %q", got)
	}
	// remux-web-1080p backs no enabled Profile: its Score change is one line folded away.
	if d.Unused != 1 {
		t.Errorf("unused = %d, want 1", d.Unused)
	}
}

func TestCustomFormatsAddedAndRemovedByName(t *testing.T) {
	old, nu := twoSets(t, func(f *fakeSnapshot) {
		f.cf("radarr", "dv", "DV Boost", `{"default":1000}`, titleSpec("DV", false, false))
		f.profile("radarr", "hd-bluray-web", "hd", "", 0, map[string]string{"WEB Tier 01": "tier1", "DV Boost": "dv"})
	})
	d := scoring.DiffSnapshots(old, nu, hdProfile)
	if got := texts(d, "added"); !slices.Equal(got, []string{"Custom Format DV Boost in HD"}) {
		t.Errorf("added = %q", got)
	}
	if got := texts(d, "removed"); !slices.Equal(got, []string{"Custom Format x265 (HD) in HD"}) {
		t.Errorf("removed = %q", got)
	}
}

func TestAChangedCustomFormatIsSaidInWords(t *testing.T) {
	old, nu := twoSets(t, func(f *fakeSnapshot) {
		flux := strings.Replace(groupSpec("^(FLUX)$", false, false), `"name":"s"`, `"name":"FLUX"`, 1)
		abbie := strings.Replace(groupSpec("^(ABBIE)$", false, false), `"name":"s"`, `"name":"ABBIE"`, 1)
		f.cf("radarr", "tier1", "WEB Tier 01", `{"default":1700}`, abbie, flux)
		f.cf("radarr", "x265", "x265 (HD)", `{"default":-10000}`, titleSpec("x265", false, true))
	})
	d := scoring.DiffSnapshots(old, nu, hdProfile)
	got := texts(d, "changed")
	slices.Sort(got)
	// The old tier condition was named "s"; the new ones are named for their groups.
	want := []string{
		"WEB Tier 01 in HD: release group ABBIE added, release group FLUX added, release group s removed",
		"x265 (HD) in HD: condition s now required",
	}
	if !slices.Equal(got, want) {
		t.Errorf("changed = %q\nwant      %q", got, want)
	}
}

func TestAQualityChangeHasNoEffectWhereTheOverlayOrdersTheQualities(t *testing.T) {
	old, nu := twoSets(t, func(f *fakeSnapshot) {
		f.fs["radarr/quality-profiles/hd-bluray-web.json"] = &fstest.MapFile{Data: []byte(
			`{"trash_id":"hd","minFormatScore":0,"items":[{"name":"Bluray-1080p","allowed":true},{"name":"WEBDL-1080p","allowed":true}],` +
				`"formatItems":{"WEB Tier 01":"tier1","x265 (HD)":"x265"}}`)}
	})
	own := englishHD
	own.Overlay = &scoring.Overlay{Movies: scoring.KindOverlay{Qualities: []scoring.QualityPref{{Name: "Bluray-1080p", Accepted: true}}}}
	d := scoring.DiffSnapshots(old, nu, []scoring.UsedProfile{{Name: "HD", Spec: englishHD}, {Name: "Mine", Spec: own}})
	removed := texts(d, "removed")
	if !slices.Contains(removed, "WEBRip-1080p removed from the qualities of HD") ||
		!slices.Contains(removed, "WEBRip-1080p removed from the qualities of Mine (no effect: Mine sets its own qualities)") {
		t.Errorf("removed = %q", removed)
	}
	for _, c := range d.Changes {
		if strings.Contains(c.Text, "Mine") && !c.NoEffect {
			t.Errorf("%q is not marked as having no effect", c.Text)
		}
	}
}

func TestTheSameSetHasNoChanges(t *testing.T) {
	old, nu := twoSets(t, func(*fakeSnapshot) {})
	if d := scoring.DiffSnapshots(old, nu, hdProfile); len(d.Changes) != 0 || d.Unused != 0 {
		t.Errorf("diff = %+v", d)
	}
}
