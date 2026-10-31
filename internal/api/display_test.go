package api_test

import (
	"strings"
	"testing"
)

type displaySettings struct {
	Display struct {
		SeasonOrder      string `json:"season_order"`
		SeasonsOpen      string `json:"seasons_open"`
		ManualSearchSort string `json:"manual_search_sort"`
		UpcomingFilters  struct {
			Kind         string `json:"kind"`
			WantedOnly   bool   `json:"wanted_only"`
			HideImported bool   `json:"hide_imported"`
		} `json:"upcoming_filters"`
	} `json:"display"`
	FromConfigFile struct {
		Display struct {
			SeasonOrder      bool `json:"season_order"`
			SeasonsOpen      bool `json:"seasons_open"`
			ManualSearchSort bool `json:"manual_search_sort"`
			UpcomingFilters  bool `json:"upcoming_filters"`
		} `json:"display"`
	} `json:"from_config_file"`
}

func TestDisplayDefaultsMatchTodaysBehaviorAndSave(t *testing.T) {
	t.Parallel()
	b := newInstance(t, "").setUp()

	d := decode[displaySettings](t, b.valid("GET", "/settings", "")).Display
	if d.SeasonOrder != "oldest_first" || d.SeasonsOpen != "latest_and_wanted" || d.ManualSearchSort != "best_first" || d.UpcomingFilters.Kind != "all" || d.UpcomingFilters.WantedOnly || d.UpcomingFilters.HideImported {
		t.Errorf("defaults = %+v", d)
	}
	r := b.valid("PATCH", "/settings", `{"display":{"season_order":"newest_first","manual_search_sort":"size_desc","upcoming_filters":{"wanted_only":true}}}`)
	if r.Status != 200 {
		t.Fatalf("PATCH = %d %s", r.Status, r.Body)
	}
	d = decode[displaySettings](t, b.valid("GET", "/settings", "")).Display
	if d.SeasonOrder != "newest_first" || d.SeasonsOpen != "latest_and_wanted" || d.ManualSearchSort != "size_desc" || !d.UpcomingFilters.WantedOnly || d.UpcomingFilters.Kind != "all" {
		t.Errorf("saved = %+v", d)
	}
}

func TestDisplayRejectsAnUnknownValueAndSavesNothing(t *testing.T) {
	t.Parallel()
	b := newInstance(t, "").setUp()
	for _, body := range []string{
		`{"display":{"season_order":"sideways"}}`,
		`{"display":{"manual_search_sort":"score_desc"}}`,
		`{"display":{"upcoming_filters":{"kind":"anime"}}}`,
	} {
		r := b.valid("PATCH", "/settings", body)
		if r.Status != 422 && r.Status != 400 || !strings.Contains(r.Body, "display") {
			t.Errorf("%s = %d %s, want a rejection naming display", body, r.Status, r.Body)
		}
	}
	if d := decode[displaySettings](t, b.valid("GET", "/settings", "")).Display; d.SeasonOrder != "oldest_first" {
		t.Errorf("after rejected patches: %+v", d)
	}
}

func TestADeclaredDisplaySettingIsReadOnlyAndTheRestStayWithTheUI(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	b := in.setUp()
	in.mustDeclare("display:\n  season_order: newest_first\n  upcoming_filters:\n    kind: series\n")

	s := decode[displaySettings](t, b.valid("GET", "/settings", ""))
	if s.Display.SeasonOrder != "newest_first" || s.Display.UpcomingFilters.Kind != "series" {
		t.Errorf("declared values = %+v", s.Display)
	}
	if f := s.FromConfigFile.Display; !f.SeasonOrder || !f.UpcomingFilters || f.SeasonsOpen || f.ManualSearchSort {
		t.Errorf("from_config_file.display = %+v, want season_order and upcoming_filters", f)
	}
	in.conflictNamingTheFile("PATCH season_order", b.valid("PATCH", "/settings", `{"display":{"season_order":"oldest_first","seasons_open":"all"}}`))
	in.conflictNamingTheFile("PATCH upcoming_filters", b.valid("PATCH", "/settings", `{"display":{"upcoming_filters":{"wanted_only":true}}}`))
	if r := b.valid("PATCH", "/settings", `{"display":{"seasons_open":"all","manual_search_sort":"age_asc"}}`); r.Status != 200 {
		t.Errorf("PATCH of undeclared settings = %d %s, want 200", r.Status, r.Body)
	}
	s = decode[displaySettings](t, b.valid("GET", "/settings", ""))
	if s.Display.SeasonOrder != "newest_first" || s.Display.SeasonsOpen != "all" || s.Display.ManualSearchSort != "age_asc" {
		t.Errorf("after: %+v", s.Display)
	}
}

func TestAnInvalidDeclaredDisplayValueStopsStartup(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	in.setUp()
	if err := in.declare("display:\n  seasons_open: some\n"); err == nil || !strings.Contains(err.Error(), "display.seasons_open") {
		t.Errorf("err = %v, want one naming display.seasons_open", err)
	}
}
