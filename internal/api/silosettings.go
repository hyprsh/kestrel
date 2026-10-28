package api

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"

	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/configfile"
	"github.com/hyprsh/kestrel/internal/settings"
)

const (
	siloKey = "silo"
	// siloPluginID is the Silo media-server plugin, whose instance holds the
	// server's URL and admin API key.
	siloPluginID = "silo"
	// siloSource is the source of Requests the Silo request-router plugin makes.
	siloSource = "silo"
)

// loadSilo reads the `silo` settings, which hold what Settings saved or the
// Config File declared (ADR 0020).
func loadSilo(ctx context.Context, s *settings.Settings) (oapi.SiloSettings, error) {
	var cfg oapi.SiloSettings
	raw, ok, err := s.Get(ctx, siloKey)
	if err != nil || !ok {
		return cfg, err
	}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return cfg, err
	}
	return normalizeSilo(cfg), nil
}

// normalizeSilo trims what people type.
func normalizeSilo(in oapi.SiloSettings) oapi.SiloSettings {
	out := oapi.SiloSettings{WatchAhead: in.WatchAhead}
	if in.Instance != nil {
		if name := strings.TrimSpace(*in.Instance); name != "" {
			out.Instance = &name
		}
	}
	return out
}

// validateSilo applies the rules both PUT /settings/silo and the Config File's
// silo follow. kinds maps each plugin instance's name to its plugin id.
func validateSilo(in oapi.SiloSettings, kinds map[string]string) *problemError {
	switch {
	case in.Instance == nil:
		if in.WatchAhead {
			return invalid("instance", "required", "Name the Silo instance whose playback history Watch-ahead reads")
		}
	case kinds[*in.Instance] == "":
		return invalid("instance", "not_found", "There is no plugin instance of that name")
	case kinds[*in.Instance] != siloPluginID:
		return invalid("instance", "wrong_plugin", "That plugin instance is not a Silo media server")
	}
	return nil
}

// siloFromFile is the Config File's silo as the settings hold it.
func siloFromFile(p configfile.Silo) oapi.SiloSettings {
	in := oapi.SiloSettings{WatchAhead: p.WatchAhead}
	if p.Instance != "" {
		in.Instance = &p.Instance
	}
	return normalizeSilo(in)
}

func (s *server) siloBody(ctx context.Context) (oapi.Silo, error) {
	cfg, err := loadSilo(ctx, s.plex.settings)
	if err != nil {
		return oapi.Silo{}, err
	}
	return oapi.Silo{WatchAhead: cfg.WatchAhead, Instance: cfg.Instance, FromConfigFile: s.declares(configfile.SectionSilo)}, nil
}

func (s *server) GetSiloSettings(ctx context.Context, _ oapi.GetSiloSettingsRequestObject) (oapi.GetSiloSettingsResponseObject, error) {
	body, err := s.siloBody(ctx)
	if err != nil {
		return nil, err
	}
	return oapi.GetSiloSettings200JSONResponse(body), nil
}

func (s *server) PutSiloSettings(ctx context.Context, req oapi.PutSiloSettingsRequestObject) (oapi.PutSiloSettingsResponseObject, error) {
	if req.Body == nil {
		return nil, invalid("body", "required", "settings are required")
	}
	if err := s.refuseDeclared(configfile.SectionSilo); err != nil {
		return nil, err
	}
	in := normalizeSilo(oapi.SiloSettings(*req.Body))
	list, err := s.plugins.List(ctx)
	if err != nil {
		return nil, err
	}
	if perr := validateSilo(in, instanceKinds(list)); perr != nil {
		return nil, perr
	}
	raw, _ := json.Marshal(in)
	if err := s.plex.settings.Put(ctx, siloKey, raw); err != nil {
		return nil, err
	}
	body, err := s.siloBody(ctx)
	if err != nil {
		return nil, err
	}
	return oapi.PutSiloSettings200JSONResponse(body), nil
}

// ---- the Config File's side ----

// CheckSilo applies PUT /settings/silo's rules to the declared section. kinds
// maps the plugin instance names that will exist once the file is applied to
// their plugin ids.
func (d *Declared) CheckSilo(p configfile.Silo, kinds map[string]string) error {
	if perr := validateSilo(siloFromFile(p), kinds); perr != nil {
		return declaredField("silo", perr)
	}
	return nil
}

// DeclareSilo saves the declared silo settings when they differ from the stored ones.
func (d *Declared) DeclareSilo(ctx context.Context, p configfile.Silo) error {
	want, _ := json.Marshal(siloFromFile(p))
	if _, ok, err := d.settings.Get(ctx, siloKey); err != nil {
		return err
	} else if ok {
		stored, err := loadSilo(ctx, d.settings)
		if err != nil {
			return err
		}
		if have, _ := json.Marshal(stored); bytes.Equal(have, want) {
			return nil
		}
	}
	return d.settings.Put(ctx, siloKey, want)
}

// siloWatchAhead is the default for a Silo Series Request that names no seasons.
func siloWatchAhead(ctx context.Context, s *settings.Settings) (bool, error) {
	cfg, err := loadSilo(ctx, s)
	return cfg.WatchAhead, err
}
