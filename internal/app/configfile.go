package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/hyprsh/kestrel/internal/api"
	"github.com/hyprsh/kestrel/internal/configfile"
	"github.com/hyprsh/kestrel/internal/jobs"
	"github.com/hyprsh/kestrel/internal/plugin"
	"github.com/hyprsh/kestrel/internal/plugin/instances"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
	"github.com/hyprsh/kestrel/internal/settings/display"
	"github.com/hyprsh/kestrel/internal/settings/rootfolders"
	"github.com/hyprsh/kestrel/internal/updates"
)

// declarer applies a Config File through the modules that own each section,
// with the rules and writers the API uses.
type declarer struct {
	file     *configfile.File
	api      *api.Declared
	profiles *profiles.Service
	roots    *rootfolders.Service
	display  *display.Service
	updates  *updates.Service
	trash    *jobs.TrashUpdates
	plugins  *instances.Service
	log      *slog.Logger
}

// section is one declared section: check validates it and writes nothing,
// apply writes only what differs from the store.
type section struct {
	check func(context.Context) error
	apply func(context.Context) error
}

// EnforceConfigFile brings every section the Config File declares to the
// file's state (ADR 0014). It checks every section before writing any, so an
// invalid file changes nothing, then applies each section on its own and marks
// setup completed when no section is left to do. A second run with the same
// file writes nothing. A section the file leaves out goes back to the UI, so
// without a Config File it only hands the plugin instances a file once
// declared back to the UI. cmd/kestrel calls it before the loops start and the
// server listens; its error ends startup.
func (a *App) EnforceConfigFile(ctx context.Context) error {
	f := a.declarer.file
	if f == nil {
		return a.declarer.plugins.Undeclare(ctx)
	}
	sections := a.declarer.sections()
	for _, s := range sections {
		if err := s.check(ctx); err != nil {
			return fmt.Errorf("config file %s: %w", f.Path, err)
		}
	}
	for _, s := range sections {
		if err := s.apply(ctx); err != nil {
			return fmt.Errorf("config file %s: %w", f.Path, err)
		}
	}
	if err := a.declarer.api.CompleteSetup(ctx); err != nil {
		return fmt.Errorf("config file %s: completing setup: %w", f.Path, err)
	}
	return nil
}

// sections are the declared sections in the order they apply, and the hand
// back to the UI of plugin instances the file no longer declares.
func (d declarer) sections() []section {
	f := d.file
	var out []section
	if a := f.Account; a != nil {
		out = append(out, section{
			check: func(context.Context) error { return d.api.CheckAccount(*a) },
			apply: func(ctx context.Context) error { return d.api.DeclareAccount(ctx, *a) },
		})
	}
	if l := f.LanguageRegion; l != nil {
		want := profiles.Region{Primary: profiles.Language(l.PrimaryLanguage), Country: l.ReleaseDateCountry}
		out = append(out, section{
			check: func(context.Context) error { return validation("language_region", profiles.CheckRegion(want)) },
			apply: func(ctx context.Context) error { return d.declareRegion(ctx, want) },
		})
	}
	if r := f.RootFolders; r != nil {
		want := rootfolders.Folders{Movies: r.Movies, Series: r.Series}
		out = append(out, section{
			check: func(context.Context) error { return validation("", rootfolders.Check(want)) },
			apply: func(ctx context.Context) error { return d.declareRoots(ctx, want) },
		})
	}
	if dd := f.Display; dd != nil {
		patch := displayPatch(*dd)
		out = append(out, section{
			check: func(context.Context) error { return displayValidation(display.Check(patch)) },
			apply: func(ctx context.Context) error { return d.declareDisplay(ctx, patch) },
		})
	}
	if f.Profiles != nil {
		want := map[string]profiles.State{}
		for key, p := range f.Profiles {
			want[key] = profiles.State{Enabled: *p.Enabled, OriginalChoice: p.Choice(), DefaultMovies: *p.DefaultMovies, DefaultSeries: *p.DefaultSeries}
		}
		out = append(out, section{
			check: func(context.Context) error {
				return validation("profiles", deprecatedField(f.Profiles, profiles.CheckAll(want)))
			},
			apply: func(ctx context.Context) error { return d.profiles.SetAll(ctx, want) },
		})
	}
	if f.PluginInstances != nil {
		var want []instances.Declared
		out = append(out, section{
			check: func(ctx context.Context) (err error) {
				if want, err = d.declaredInstances(); err != nil {
					return err
				}
				return instanceError(d.plugins.CheckDeclared(ctx, want))
			},
			apply: func(ctx context.Context) error {
				declared, err := d.plugins.Declare(ctx, want)
				if err != nil {
					return instanceError(err)
				}
				d.testInstances(ctx, declared)
				return nil
			},
		})
	} else {
		out = append(out, section{
			check: func(context.Context) error { return nil },
			apply: d.plugins.Undeclare,
		})
	}
	if p := f.PlexSignIn; p != nil {
		out = append(out, section{
			check: func(ctx context.Context) error {
				kinds, roots, err := d.plexSignInContext(ctx)
				if err != nil {
					return err
				}
				return d.api.CheckPlexSignIn(*p, kinds, roots)
			},
			apply: func(ctx context.Context) error { return d.api.DeclarePlexSignIn(ctx, *p) },
		})
	}
	if p := f.Silo; p != nil {
		out = append(out, section{
			check: func(ctx context.Context) error {
				kinds, _, err := d.plexSignInContext(ctx)
				if err != nil {
					return err
				}
				return d.api.CheckSilo(*p, kinds)
			},
			apply: func(ctx context.Context) error { return d.api.DeclareSilo(ctx, *p) },
		})
	}
	if p := f.ReverseProxy; p != nil {
		out = append(out, section{
			check: func(context.Context) error { return d.api.CheckReverseProxy(*p) },
			apply: func(ctx context.Context) error { return d.api.DeclareReverseProxy(ctx, *p) },
		})
	}
	if on := f.CheckGitHubUpdates; on != nil {
		out = append(out, section{
			check: func(context.Context) error { return nil },
			apply: func(ctx context.Context) error { return d.declareUpdates(ctx, *on) },
		})
	}
	return out
}

// plexSignInContext is what plex_sign_in and silo are checked against: the plugin
// instances and Root folders as they will stand once the file is applied,
// which is before it is, because every section is checked before any is
// written. A declared instance that leaves the file is deleted, so only the
// ones the UI made count besides the file's own.
func (d declarer) plexSignInContext(ctx context.Context) (kinds map[string]string, roots rootfolders.Folders, err error) {
	stored, err := d.plugins.List(ctx)
	if err != nil {
		return nil, roots, err
	}
	kinds = map[string]string{}
	for _, i := range stored {
		if !i.Declared || d.file.PluginInstances == nil {
			kinds[i.Name] = i.PluginID
		}
	}
	for _, p := range d.file.PluginInstances {
		kinds[strings.TrimSpace(p.Name)] = p.PluginID
	}
	if r := d.file.RootFolders; r != nil {
		return kinds, rootfolders.Folders{Movies: r.Movies, Series: r.Series}, nil
	}
	roots, _, err = d.roots.Get(ctx)
	return kinds, roots, err
}

// declareRegion saves the Primary Language and country when they differ. A
// new Primary Language re-scores the files, as PATCH /settings does.
func (d declarer) declareRegion(ctx context.Context, want profiles.Region) error {
	cur, saved, err := d.profiles.Region(ctx)
	if err != nil || (saved && cur == want) {
		return err
	}
	set := func() error {
		_, err := d.profiles.SetRegion(ctx, profiles.RegionPatch{Primary: &want.Primary, Country: &want.Country})
		return err
	}
	if cur.Primary != want.Primary {
		return d.trash.ChangeLanguage(ctx, set)
	}
	return set()
}

// declareRoots saves the Root folders when they differ.
func (d declarer) declareRoots(ctx context.Context, want rootfolders.Folders) error {
	cur, saved, err := d.roots.Get(ctx)
	if err != nil || (saved && slices.Equal(cur.Movies, want.Movies) && slices.Equal(cur.Series, want.Series)) {
		return err
	}
	_, err = d.roots.Set(ctx, rootfolders.Patch{Movies: &want.Movies, Series: &want.Series})
	return err
}

// displayPatch is what the file's display section sets. A declared
// upcoming_filters is whole: a filter it leaves out takes its default.
func displayPatch(d configfile.Display) display.Patch {
	p := display.Patch{SeasonOrder: d.SeasonOrder, SeasonsOpen: d.SeasonsOpen, ManualSearchSort: d.ManualSearchSort}
	if u := d.UpcomingFilters; u != nil {
		def := display.Defaults().UpcomingFilters
		kind, wanted, hide := def.Kind, def.WantedOnly, def.HideImported
		if u.Kind != nil {
			kind = *u.Kind
		}
		if u.WantedOnly != nil {
			wanted = *u.WantedOnly
		}
		if u.HideImported != nil {
			hide = *u.HideImported
		}
		p.Upcoming = &display.UpcomingPatch{Kind: &kind, WantedOnly: &wanted, HideImported: &hide}
	}
	return p
}

// declareDisplay saves the declared display settings when they differ. A
// setting the file leaves out keeps what the UI saved.
func (d declarer) declareDisplay(ctx context.Context, p display.Patch) error {
	cur, err := d.display.Get(ctx)
	if err != nil {
		return err
	}
	var want display.Display
	want, err = display.Apply(cur, p)
	if err != nil || want == cur {
		return err
	}
	_, err = d.display.Set(ctx, p)
	return err
}

// displayValidation words a rejected display value under the file's display section.
func displayValidation(err error) error {
	var ve *display.ValidationError
	if errors.As(err, &ve) {
		return fmt.Errorf("display.%s: %s", ve.Field, ve.Message)
	}
	return err
}

// declareUpdates flips the GitHub update check when it differs. Switching it
// off clears what GitHub last said, as PATCH /settings does.
func (d declarer) declareUpdates(ctx context.Context, on bool) error {
	if d.updates.Enabled(ctx) == on {
		return nil
	}
	if err := d.updates.SetEnabled(ctx, on); err != nil || on {
		return err
	}
	return d.updates.Check(ctx)
}

// declaredInstances reads the declared plugin instances, their secrets
// resolved against each plugin's manifest.
func (d declarer) declaredInstances() ([]instances.Declared, error) {
	var out []instances.Declared
	for _, p := range d.file.PluginInstances {
		pl, _, ok := d.plugins.Registry().Lookup(p.PluginID)
		if !ok {
			return nil, fmt.Errorf("line %d: plugin_instances %q: plugin_id: no such plugin", p.Line, strings.TrimSpace(p.Name))
		}
		m := pl.Describe()
		cfg, err := p.ConfigValues(func(key string) (known, secret bool) {
			f, ok := m.Field(key)
			return ok, f.Type == plugin.FieldSecret
		})
		if err != nil {
			return nil, err
		}
		in := instances.Declared{Name: p.Name, PluginID: p.PluginID, Enabled: p.Enabled, Config: cfg}
		if p.Priority != nil {
			in.Priority = *p.Priority
		}
		out = append(out, in)
	}
	return out, nil
}

// testTimeout bounds the live test of a declared instance at startup.
const testTimeout = 10 * time.Second

// testInstances runs the live test of each enabled declared instance, all at
// once, and logs the ones that fail: a service that is down at startup does
// not stop Kestrel.
func (d declarer) testInstances(ctx context.Context, declared []instances.Instance) {
	ctx, cancel := context.WithTimeout(ctx, testTimeout)
	defer cancel()
	var wg sync.WaitGroup
	for _, inst := range declared {
		pl, _, ok := d.plugins.Registry().Lookup(inst.PluginID)
		if !inst.Enabled || !ok {
			continue
		}
		wg.Go(func() {
			if _, err := pl.Test(ctx, inst.Connection()); err != nil {
				pe := plugin.AsError(err)
				d.log.Warn("config file: a declared plugin instance failed its connection test",
					"instance", inst.Name, "plugin", inst.PluginID, "code", pe.Code, "message", pe.Message)
			}
		})
	}
	wg.Wait()
}

// instanceError words a rejected declared instance under plugin_instances.
func instanceError(err error) error {
	var de *instances.DeclaredError
	if errors.As(err, &de) {
		return fmt.Errorf("plugin_instances %w", de)
	}
	return err
}

// deprecatedField names original_fallback instead of original_language in a
// Profile's error when the file declared only the deprecated field.
func deprecatedField(declared map[string]configfile.Profile, err error) error {
	var pe *profiles.ValidationError
	if !errors.As(err, &pe) {
		return err
	}
	if key, ok := strings.CutSuffix(pe.Field, ".original_language"); ok && declared[key].OriginalChoice == nil {
		pe.Field = key + ".original_fallback"
	}
	return err
}

// validation words a module's rejected field under its Config File section.
func validation(section string, err error) error {
	field, msg := "", ""
	var pe *profiles.ValidationError
	var re *rootfolders.ValidationError
	switch {
	case err == nil:
		return nil
	case errors.As(err, &pe):
		field, msg = pe.Field, pe.Message
	case errors.As(err, &re):
		field, msg = re.Field, re.Message
	default:
		return err
	}
	switch {
	case section != "" && field != "":
		field = section + "." + field
	case section != "":
		field = section
	}
	return fmt.Errorf("%s: %s", field, msg)
}
