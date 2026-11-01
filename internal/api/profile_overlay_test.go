package api_test

import (
	"fmt"
	"strings"
	"testing"
)

type overlayJSON struct {
	MinScore     *int `json:"min_score"`
	UpgradeUntil *int `json:"upgrade_until"`
	Series       struct {
		Cutoff    *string `json:"cutoff"`
		Qualities *[]struct {
			Name     string `json:"name"`
			Accepted bool   `json:"accepted"`
		} `json:"qualities"`
	} `json:"series"`
	EpisodeSize struct {
		Min *int64 `json:"min"`
		Max *int64 `json:"max"`
	} `json:"episode_size"`
}

type overlayDetailJSON struct {
	Key         string      `json:"key"`
	Rescores    int         `json:"rescores"`
	BelowCutoff int         `json:"below_cutoff"`
	Overlay     overlayJSON `json:"overlay"`
	Series      struct {
		Cutoff *string `json:"cutoff"`
		Ladder []struct {
			Name     string `json:"name"`
			Accepted bool   `json:"accepted"`
		} `json:"ladder"`
		TrashLadder []struct {
			Name string `json:"name"`
		} `json:"trash_ladder"`
		MinScore      int `json:"min_score"`
		TrashMinScore int `json:"trash_min_score"`
	} `json:"series"`
}

func (w wantedRig) details(t *testing.T, key string) overlayDetailJSON {
	t.Helper()
	for _, d := range decode[struct {
		Items []overlayDetailJSON `json:"items"`
	}](t, w.valid("GET", "/profiles/details", "")).Items {
		if d.Key == key {
			return d
		}
	}
	t.Fatalf("no details for %q", key)
	return overlayDetailJSON{}
}

const overlayBody = `{"overlay":{"min_score":5,"upgrade_until":2000,
 "series":{"cutoff":"WEBDL-1080p","qualities":[{"name":"WEBDL-1080p","accepted":true},{"name":"Bluray-1080p","accepted":false}]},
 "movies":{"cutoff":null,"qualities":null},
 "episode_size":{"min":1073741824,"max":10737418240},"movie_size":{"min":null,"max":null}}}`

func TestPatchingAnOverlayShowsInTheDetailsAndEmptyingItRestoresTrash(t *testing.T) {
	t.Parallel()
	w := newWantedRig(t)
	before := w.details(t, "hd-primary")
	if before.Overlay.UpgradeUntil != nil || before.Series.Cutoff != nil || len(before.Series.Ladder) == 0 || len(before.Series.TrashLadder) != len(before.Series.Ladder) {
		t.Fatalf("a fresh Profile has no overlay: %+v", before)
	}
	if r := w.valid("PATCH", "/profiles/hd-primary", overlayBody); r.Status != 200 {
		t.Fatalf("PATCH = %d %s", r.Status, r.Body)
	}
	d := w.details(t, "hd-primary")
	if d.Overlay.UpgradeUntil == nil || *d.Overlay.UpgradeUntil != 2000 || d.Series.Cutoff == nil || *d.Series.Cutoff != "WEBDL-1080p" {
		t.Errorf("overlay = %+v, series cutoff %v", d.Overlay, d.Series.Cutoff)
	}
	if d.Series.MinScore != 5 || d.Series.TrashMinScore != before.Series.TrashMinScore {
		t.Errorf("min score %d (trash %d)", d.Series.MinScore, d.Series.TrashMinScore)
	}
	if d.Series.Ladder[0].Name != "WEBDL-1080p" || d.Series.Ladder[1].Name != "Bluray-1080p" || d.Series.Ladder[1].Accepted {
		t.Errorf("ladder starts %+v", d.Series.Ladder[:3])
	}
	if d.Overlay.EpisodeSize.Min == nil || *d.Overlay.EpisodeSize.Max != 10<<30 {
		t.Errorf("episode size = %+v", d.Overlay.EpisodeSize)
	}
	if w.details(t, "4k-primary").Overlay.UpgradeUntil != nil {
		t.Error("the overlay leaked into another Profile")
	}

	empty := `{"overlay":{"min_score":null,"upgrade_until":null,"series":{"cutoff":null,"qualities":null},"movies":{"cutoff":null,"qualities":null},"episode_size":{"min":null,"max":null},"movie_size":{"min":null,"max":null}}}`
	w.valid("PATCH", "/profiles/hd-primary", empty)
	if d = w.details(t, "hd-primary"); d.Overlay.UpgradeUntil != nil || d.Series.Cutoff != nil || d.Series.MinScore != before.Series.MinScore {
		t.Errorf("after the empty overlay: %+v", d)
	}
}

func TestPatchingABadOverlayIsAValidationError(t *testing.T) {
	t.Parallel()
	w := newWantedRig(t)
	bad := strings.Replace(overlayBody, `"cutoff":"WEBDL-1080p"`, `"cutoff":"Bluray-1080p"`, 1) // unticked in the list
	r := w.valid("PATCH", "/profiles/hd-primary", bad)
	if r.Status != 422 || !strings.Contains(r.Body, "overlay.series.cutoff") {
		t.Errorf("PATCH = %d %s", r.Status, r.Body)
	}
}

func TestCustomProfilesAreMadeRenamedAndDeletedUnlessAVersionUsesThem(t *testing.T) {
	t.Parallel()
	w := newWantedRig(t)
	p := decode[profileJSON](t, w.valid("POST", "/profiles", `{"name":"Mine","copy_from":"hd-primary"}`))
	if !strings.HasPrefix(p.Key, "custom-") || p.Name != "Mine" || p.Slot != "standard" {
		t.Fatalf("created %+v", p)
	}
	if r := w.valid("POST", "/profiles", `{"name":"mine","copy_from":"hd-primary"}`); r.Status != 422 {
		t.Errorf("a taken name = %d", r.Status)
	}
	if r := w.valid("POST", "/profiles", `{"name":"X","copy_from":"nope"}`); r.Status != 404 {
		t.Errorf("an unknown source = %d", r.Status)
	}
	if r := w.valid("PATCH", "/profiles/"+p.Key, `{"name":"Renamed"}`); r.Status != 200 {
		t.Errorf("rename = %d %s", r.Status, r.Body)
	}
	if r := w.valid("DELETE", "/profiles/hd-primary", ""); r.Status != 422 {
		t.Errorf("deleting a builtin Profile = %d", r.Status)
	}

	title := decode[titleJSON](t, w.valid("POST", "/titles", fmt.Sprintf(addHD, 116149)))
	w.exec(t, `UPDATE versions SET profile_key = ? WHERE title_id = ?`, p.Key, title.ID)
	if r := w.valid("DELETE", "/profiles/"+p.Key, ""); r.Status != 409 {
		t.Errorf("deleting a Profile in use = %d %s", r.Status, r.Body)
	}
	w.exec(t, `UPDATE versions SET profile_key = 'hd-primary' WHERE title_id = ?`, title.ID)
	if r := w.valid("DELETE", "/profiles/"+p.Key, ""); r.Status != 204 {
		t.Errorf("deleting an unused custom Profile = %d %s", r.Status, r.Body)
	}
	if r := w.valid("DELETE", "/profiles/"+p.Key, ""); r.Status != 404 {
		t.Errorf("deleting it twice = %d", r.Status)
	}
}

func TestFilesBelowTheCutoffAreCountedPerProfileAndInTheStats(t *testing.T) {
	t.Parallel()
	w := newWantedRig(t)
	decode[titleJSON](t, w.valid("POST", "/titles", fmt.Sprintf(addHD, 116149)))
	decode[titleJSON](t, w.valid("POST", "/titles", fmt.Sprintf(addHD, 77)))
	parsed := func(q string) string { return `{"quality":{"quality":{"name":"` + q + `"}}}` }
	w.exec(t, `INSERT INTO files (version_id, path, size, release_name, parsed_release, score, imported_at) SELECT id, 'a.mkv', 1, 'a', ?, 500, '2026-10-01T00:00:00Z' FROM versions WHERE title_id = (SELECT MIN(title_id) FROM versions)`, parsed("WEBDL-1080p"))
	w.exec(t, `INSERT INTO files (version_id, path, size, release_name, parsed_release, score, imported_at) SELECT id, 'b.mkv', 1, 'b', ?, 3000, '2026-10-01T00:00:00Z' FROM versions WHERE title_id = (SELECT MAX(title_id) FROM versions)`, parsed("WEBDL-1080p"))

	if d := w.details(t, "hd-primary"); d.BelowCutoff != 0 || d.Rescores != 2 {
		t.Errorf("no cutoff: below %d, rescores %d, want 0 and 2", d.BelowCutoff, d.Rescores)
	}
	if s := w.stats(t, ""); s.BelowCutoff != 0 {
		t.Errorf("stats below_cutoff = %d without a cutoff", s.BelowCutoff)
	}
	w.valid("PATCH", "/profiles/hd-primary", `{"overlay":{"min_score":null,"upgrade_until":1000,"series":{"cutoff":null,"qualities":null},"movies":{"cutoff":"WEBDL-1080p","qualities":null},"episode_size":{"min":null,"max":null},"movie_size":{"min":null,"max":null}}}`)
	if d := w.details(t, "hd-primary"); d.BelowCutoff != 1 {
		t.Errorf("below_cutoff = %d, want the 500-point file", d.BelowCutoff)
	}
	if s := w.stats(t, ""); s.BelowCutoff != 1 {
		t.Errorf("stats below_cutoff = %d, want 1", s.BelowCutoff)
	}
}
