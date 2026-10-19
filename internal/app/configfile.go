package app

import (
	"context"
	"errors"
	"fmt"
	"slices"

	"github.com/hyprsh/kestrel/internal/api"
	"github.com/hyprsh/kestrel/internal/configfile"
	"github.com/hyprsh/kestrel/internal/jobs"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
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
	updates  *updates.Service
	trash    *jobs.TrashUpdates
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
// file writes nothing. Without a Config File it does nothing. cmd/kestrel calls
// it before the loops start and the server listens; its error ends startup.
func (a *App) EnforceConfigFile(ctx context.Context) error {
	f := a.declarer.file
	if f == nil {
		return nil
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

// sections are the declared sections in the order they apply.
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
	if f.Profiles != nil {
		want := map[string]profiles.State{}
		for key, p := range f.Profiles {
			want[key] = profiles.State{Enabled: *p.Enabled, OriginalFallback: *p.OriginalFallback, DefaultMovies: *p.DefaultMovies, DefaultSeries: *p.DefaultSeries}
		}
		out = append(out, section{
			check: func(context.Context) error { return validation("profiles", profiles.CheckAll(want)) },
			apply: func(ctx context.Context) error { return d.profiles.SetAll(ctx, want) },
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
