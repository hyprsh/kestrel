package api_test

import (
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
