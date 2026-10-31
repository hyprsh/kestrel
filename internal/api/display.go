package api

import (
	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/configfile"
	"github.com/hyprsh/kestrel/internal/settings/display"
)

func displayToAPI(d display.Display) oapi.Display {
	out := oapi.Display{
		SeasonOrder:      oapi.SeasonOrder(d.SeasonOrder),
		SeasonsOpen:      oapi.SeasonsOpen(d.SeasonsOpen),
		ManualSearchSort: oapi.ManualSearchSort(d.ManualSearchSort),
	}
	out.UpcomingFilters.Kind = oapi.UpcomingKind(d.UpcomingFilters.Kind)
	out.UpcomingFilters.WantedOnly = d.UpcomingFilters.WantedOnly
	out.UpcomingFilters.HideImported = d.UpcomingFilters.HideImported
	return out
}

// enumPtr converts an optional API enum to the plain string the module takes.
func enumPtr[T ~string](v *T) *string {
	if v == nil {
		return nil
	}
	s := string(*v)
	return &s
}

// declaresDisplay reports whether the Config File declares one display setting.
func (s *server) declaresDisplay(d configfile.DisplaySetting) bool {
	return s.opts.ConfigFile.DeclaresDisplay(d)
}

// refuseDeclaredDisplay answers 409 for the first display setting the patch
// names that the Config File declares. A nil patch names none.
func (s *server) refuseDeclaredDisplay(d *struct {
	ManualSearchSort *oapi.ManualSearchSort `json:"manual_search_sort,omitempty"`
	SeasonOrder      *oapi.SeasonOrder      `json:"season_order,omitempty"`
	SeasonsOpen      *oapi.SeasonsOpen      `json:"seasons_open,omitempty"`
	UpcomingFilters  *struct {
		HideImported *bool              `json:"hide_imported,omitempty"`
		Kind         *oapi.UpcomingKind `json:"kind,omitempty"`
		WantedOnly   *bool              `json:"wanted_only,omitempty"`
	} `json:"upcoming_filters,omitempty"`
}) error {
	if d == nil {
		return nil
	}
	for _, c := range []struct {
		named bool
		which configfile.DisplaySetting
	}{
		{d.SeasonOrder != nil, configfile.DisplaySeasonOrder},
		{d.SeasonsOpen != nil, configfile.DisplaySeasonsOpen},
		{d.ManualSearchSort != nil, configfile.DisplayManualSearchSort},
		{d.UpcomingFilters != nil, configfile.DisplayUpcomingFilters},
	} {
		if c.named && s.declaresDisplay(c.which) {
			return s.declaredConflict("display."+string(c.which), changeTheFile)
		}
	}
	return nil
}
