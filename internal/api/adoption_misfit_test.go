package api_test

import (
	"fmt"
	"testing"
)

func TestTheSlotLabelWinsOverTheProbeAndAProfileMisfitIsStillAdopted(t *testing.T) {
	a := newAdopting(t)
	// A 1080p file that Kestrel's own label puts in SD: the SD Profile does not take
	// 1080p, but gates never block Adoption.
	a.put(t, "Paddington (2014) {tmdb-116149}/Paddington (2014) {tmdb-116149} - [SD][Bluray-1080p][English][h264]-GRP.mkv", "x")

	plan := a.scan(t)

	f := a.rows(t, "matched")[0].Files[0]
	if f.Slot != "sd" || f.Profile != "sd-primary" || f.Left != nil || !f.Ticked {
		t.Fatalf("file = %+v", f)
	}
	a.commit(t, plan.Revision)
	if files := a.titleFiles(t, a.titleIDOf(t, 116149)); files["sd"] == "" {
		t.Errorf("the misfit was not adopted: %v", files)
	}
}

func TestDiscardingThePlanForgetsItWithoutTouchingAnyFile(t *testing.T) {
	a := newAdopting(t)
	a.put(t, "Paddington (2014) {tmdb-116149}/Paddington.2014.1080p.BluRay.x264-GRP.mkv", "x")
	a.scan(t)

	if r := a.do("DELETE", "/adoption", ""); r.Status != 204 {
		t.Fatalf("DELETE /adoption = %d %s", r.Status, r.Body)
	}
	if got := decode[adoptionJSON](t, a.valid("GET", "/adoption", "")); got.State != "idle" || got.Summary.Matched != 0 {
		t.Errorf("after discarding = %+v", got)
	}
	if rows := a.rows(t, ""); len(rows) != 0 {
		t.Errorf("rows = %+v", rows)
	}
}

func TestAFileOnlyAnyAcceptsGetsTheAnyProfile(t *testing.T) {
	a := newAdopting(t)
	// A 576p file that Kestrel's own label puts in HD: HD takes 720-1080 only, Any takes it.
	a.put(t, "Paddington (2014) {tmdb-116149}/Paddington (2014) {tmdb-116149} - [HD][Bluray-576p][English][h264]-GRP 576p.mkv", "x")

	plan := a.scan(t)

	f := a.rows(t, "matched")[0].Files[0]
	if f.Slot != "hd" || f.Profile != "any-primary" || f.Left != nil || !f.Ticked {
		t.Fatalf("file = %+v", f)
	}
	a.commit(t, plan.Revision)
	d := decode[struct {
		Versions []struct {
			Slot    string `json:"slot"`
			Profile string `json:"profile"`
			File    *struct {
				Misfit bool `json:"misfit"`
			} `json:"file"`
		} `json:"versions"`
	}](t, a.valid("GET", fmt.Sprintf("/titles/%d", a.titleIDOf(t, 116149)), ""))
	if len(d.Versions) != 1 || d.Versions[0].Profile != "any-primary" || d.Versions[0].File == nil || d.Versions[0].File.Misfit {
		t.Fatalf("versions = %+v, want the HD Version under Any with no misfit", d.Versions)
	}
}
