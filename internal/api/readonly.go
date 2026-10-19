package api

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/configfile"
	"github.com/hyprsh/kestrel/internal/plugin/instances"
)

// declares reports whether the Config File declares a section, which the API
// then reports as from_config_file and refuses to change (ADR 0014).
func (s *server) declares(sec configfile.Section) bool {
	return s.opts.ConfigFile.Declares(sec)
}

// declaredConflict answers a write to what the Config File declares, naming
// the file. what reads as the subject of "is declared"; advice says what to
// do instead.
func (s *server) declaredConflict(what, advice string) *problemError {
	return problem(http.StatusConflict, "conflict", what+" is declared in the Config File "+s.opts.ConfigFile.Path+": "+advice)
}

const changeTheFile = "change it there and restart Kestrel"

// instanceDeclared reports whether the Config File declares i. An instance it
// declared once goes back to the UI when the file leaves plugin_instances out.
func (s *server) instanceDeclared(i instances.Instance) bool {
	return i.Declared && s.declares(configfile.SectionPluginInstances)
}

// refuseDeclaredName answers 409 when name is one the Config File declares:
// an instance created or renamed here can't take it.
func (s *server) refuseDeclaredName(name string) error {
	if s.opts.ConfigFile.DeclaresInstance(name) {
		return s.declaredConflict(fmt.Sprintf("the plugin instance name %q", strings.TrimSpace(name)), "choose another name")
	}
	return nil
}

// patchedSections are the Config File sections a settings patch names.
// trash and metadata are not sections a Config File declares.
func patchedSections(p *oapi.SettingsPatch) []configfile.Section {
	var out []configfile.Section
	if p.LanguageRegion != nil {
		out = append(out, configfile.SectionLanguageRegion)
	}
	if p.RootFolders != nil {
		out = append(out, configfile.SectionRootFolders)
	}
	if p.CheckGithubUpdates != nil {
		out = append(out, configfile.SectionCheckGitHubUpdates)
	}
	return out
}

// refuseDeclared answers 409 for the first of sections the Config File
// declares, or nil when it declares none.
func (s *server) refuseDeclared(sections ...configfile.Section) error {
	for _, sec := range sections {
		if s.declares(sec) {
			return s.declaredConflict(string(sec), changeTheFile)
		}
	}
	return nil
}
