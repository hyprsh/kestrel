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

// displaySettings is every display setting the API knows, in one list: whether
// a patch names it and where Settings reports that the Config File declares it.
var displaySettings = []struct {
	key      configfile.DisplaySetting
	named    func(*oapi.SettingsPatch) bool
	declared func(*oapi.Settings) *bool
}{
	{configfile.DisplaySeasonOrder, func(p *oapi.SettingsPatch) bool { return p.Display.SeasonOrder != nil }, func(o *oapi.Settings) *bool { return &o.FromConfigFile.Display.SeasonOrder }},
	{configfile.DisplaySeasonsOpen, func(p *oapi.SettingsPatch) bool { return p.Display.SeasonsOpen != nil }, func(o *oapi.Settings) *bool { return &o.FromConfigFile.Display.SeasonsOpen }},
	{configfile.DisplayManualSearchSort, func(p *oapi.SettingsPatch) bool { return p.Display.ManualSearchSort != nil }, func(o *oapi.Settings) *bool { return &o.FromConfigFile.Display.ManualSearchSort }},
	{configfile.DisplayUpcomingFilters, func(p *oapi.SettingsPatch) bool { return p.Display.UpcomingFilters != nil }, func(o *oapi.Settings) *bool { return &o.FromConfigFile.Display.UpcomingFilters }},
}

// fillDeclaredDisplay sets from_config_file.display for each setting the Config File declares.
func (s *server) fillDeclaredDisplay(out *oapi.Settings) {
	for _, d := range displaySettings {
		*d.declared(out) = s.opts.ConfigFile.DeclaresDisplay(d.key)
	}
}

// refuseDeclaredDisplay answers 409 for the first display setting the patch
// names that the Config File declares. A patch with no display section names none.
func (s *server) refuseDeclaredDisplay(p *oapi.SettingsPatch) error {
	if p.Display == nil {
		return nil
	}
	for _, d := range displaySettings {
		if d.named(p) && s.opts.ConfigFile.DeclaresDisplay(d.key) {
			return s.declaredConflict("display."+string(d.key), changeTheFile)
		}
	}
	return nil
}
