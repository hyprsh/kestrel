package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/configfile"
	"github.com/hyprsh/kestrel/internal/jobs"
	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
	"github.com/hyprsh/kestrel/internal/settings/display"
	"github.com/hyprsh/kestrel/internal/settings/rootfolders"
)

func profilesProblem(err error) error {
	var ve *profiles.ValidationError
	switch {
	case errors.Is(err, profiles.ErrNotFound):
		return problem(http.StatusNotFound, "not_found", "no such Profile")
	case errors.As(err, &ve):
		return invalid(ve.Field, ve.Code, ve.Message)
	}
	return err
}

func (s *server) profileToAPI(p profiles.Profile) oapi.Profile {
	slot := slotToAPI(p.Slot)
	rule := oapi.ProfileLanguageRule("primary")
	if p.Rule == scoring.OriginalLanguage {
		rule = "original"
	}
	return oapi.Profile{
		Key: p.Key, Name: p.Name, Slot: slot, LanguageRule: rule,
		OriginalLanguage: oapi.OriginalLanguageChoice(p.OriginalChoice), OriginalFallback: p.OriginalChoice.DeprecatedFlag(),
		Enabled: p.Enabled, DefaultMovies: p.DefaultMovies, DefaultSeries: p.DefaultSeries,
		MinHeight: p.MinHeight, MaxHeight: p.MaxHeight,
		TrashProfileMovies: p.TrashMovies, TrashProfileSeries: p.TrashSeries,
		FromConfigFile: s.declares(configfile.SectionProfiles),
	}
}

func (s *server) ListProfiles(ctx context.Context, _ oapi.ListProfilesRequestObject) (oapi.ListProfilesResponseObject, error) {
	all, err := s.profiles.List(ctx)
	if err != nil {
		return nil, err
	}
	out := oapi.ProfileList{Items: make([]oapi.Profile, len(all))}
	for i, p := range all {
		out.Items[i] = s.profileToAPI(p)
	}
	return oapi.ListProfiles200JSONResponse(out), nil
}

func (s *server) PatchProfile(ctx context.Context, r oapi.PatchProfileRequestObject) (oapi.PatchProfileResponseObject, error) {
	if r.Body == nil {
		return nil, invalid("body", "required", "a body is required")
	}
	if err := s.refuseDeclared(configfile.SectionProfiles); err != nil {
		return nil, err
	}
	b := r.Body
	original, err := scoring.OriginalChoiceOf((*scoring.OriginalChoice)(b.OriginalLanguage), b.OriginalFallback)
	if err != nil {
		return nil, invalid("original_fallback", "invalid", "original_fallback disagrees with original_language; send original_language only")
	}
	p, err := s.profiles.Patch(ctx, string(r.Key), profiles.Patch{
		Enabled: b.Enabled, OriginalChoice: original, DefaultMovies: b.DefaultMovies, DefaultSeries: b.DefaultSeries,
	})
	var ve *profiles.ValidationError
	if b.OriginalLanguage == nil && errors.As(err, &ve) && ve.Field == "original_language" {
		ve.Field = "original_fallback" // the client sent the deprecated field
	}
	if err != nil {
		return nil, profilesProblem(err)
	}
	return oapi.PatchProfile200JSONResponse(s.profileToAPI(p)), nil
}

// setRegion saves the language settings in a transaction of their own.
func (s *server) setRegion(ctx context.Context, p profiles.RegionPatch) (profiles.Region, error) {
	tx, err := s.opts.Store.Write().BeginTx(ctx, nil)
	if err != nil {
		return profiles.Region{}, err
	}
	defer tx.Rollback()
	region, err := s.settings.InTx(tx).SetRegion(ctx, p)
	if err != nil {
		return profiles.Region{}, err
	}
	return region, tx.Commit()
}

func (s *server) settingsBody(ctx context.Context) (oapi.Settings, error) {
	region, _, err := s.profiles.Region(ctx)
	if err != nil {
		return oapi.Settings{}, err
	}
	roots, _, err := s.rootFolders.Get(ctx)
	if err != nil {
		return oapi.Settings{}, err
	}
	var out oapi.Settings
	out.CheckGithubUpdates = s.updates.Enabled(ctx)
	out.RootFolders = oapi.RootFolders{Movies: roots.Movies, Series: roots.Series}
	out.LanguageRegion.PrimaryLanguage = oapi.PrimaryLanguage(region.Primary)
	out.LanguageRegion.ReleaseDateCountry = region.Country
	if pending, ok := s.trash.PendingLanguage(); ok {
		out.LanguageRegion.PendingPrimaryLanguage = (*oapi.PrimaryLanguage)(&pending)
	}
	out.Trash.AutoUpdate, err = s.trash.AutoUpdate(ctx)
	if err != nil {
		return oapi.Settings{}, err
	}
	set, err := s.keys.OverridesSet(ctx)
	if err != nil {
		return oapi.Settings{}, err
	}
	out.Metadata.TmdbApiKeySet, out.Metadata.TvdbApiKeySet = set.TMDB, set.TVDB
	if out.PauseGrabs, err = s.pause.Paused(ctx); err != nil {
		return oapi.Settings{}, err
	}
	if d, err := s.display.Get(ctx); err != nil {
		return oapi.Settings{}, err
	} else {
		out.Display = displayToAPI(d)
	}
	out.FromConfigFile.Display.SeasonOrder = s.declaresDisplay(configfile.DisplaySeasonOrder)
	out.FromConfigFile.Display.SeasonsOpen = s.declaresDisplay(configfile.DisplaySeasonsOpen)
	out.FromConfigFile.Display.ManualSearchSort = s.declaresDisplay(configfile.DisplayManualSearchSort)
	out.FromConfigFile.Display.UpcomingFilters = s.declaresDisplay(configfile.DisplayUpcomingFilters)
	out.FromConfigFile.LanguageRegion = s.declares(configfile.SectionLanguageRegion)
	out.FromConfigFile.RootFolders = s.declares(configfile.SectionRootFolders)
	out.FromConfigFile.CheckGithubUpdates = s.declares(configfile.SectionCheckGitHubUpdates)
	return out, nil
}

func (s *server) GetSettings(ctx context.Context, _ oapi.GetSettingsRequestObject) (oapi.GetSettingsResponseObject, error) {
	out, err := s.settingsBody(ctx)
	if err != nil {
		return nil, err
	}
	return oapi.GetSettings200JSONResponse(out), nil
}

func (s *server) PatchSettings(ctx context.Context, r oapi.PatchSettingsRequestObject) (oapi.PatchSettingsResponseObject, error) {
	if r.Body == nil {
		return nil, invalid("body", "required", "a body is required")
	}
	if err := s.refuseDeclared(patchedSections(r.Body)...); err != nil {
		return nil, err // before any write, so the patch's other sections stay unsaved too
	}
	if err := s.refuseDeclaredDisplay(r.Body.Display); err != nil {
		return nil, err
	}
	if l := r.Body.LanguageRegion; l != nil && l.PrimaryLanguage != nil {
		return s.queueLanguage(ctx, r)
	}
	return s.patchSettings(ctx, r)
}

// queueLanguage answers a patch that names a Primary Language. A new Language
// is not saved here: the trash loop's pass saves it and re-scores every file in
// one step, so no Grab decides on a mix of old and new Scores (Settled 6). The
// rest of the patch is saved now. The Language and the country, which follows
// it, wait for the pass.
func (s *server) queueLanguage(ctx context.Context, r oapi.PatchSettingsRequestObject) (oapi.PatchSettingsResponseObject, error) {
	l := r.Body.LanguageRegion
	want := profiles.Language(*l.PrimaryLanguage)
	cur, _, err := s.profiles.Region(ctx)
	if err != nil {
		return nil, err
	}
	next := cur
	next.Primary = want
	if l.ReleaseDateCountry != nil {
		next.Country = *l.ReleaseDateCountry
	}
	if err := profiles.CheckRegion(next); err != nil {
		return nil, profilesProblem(err)
	}
	if _, pending := s.trash.PendingLanguage(); want == cur.Primary && !pending {
		return s.patchSettings(ctx, r) // no new Language: the country alone changes, as it always did
	}
	rest := *r.Body
	rest.LanguageRegion = nil
	if _, err := s.patchSettings(ctx, oapi.PatchSettingsRequestObject{Body: &rest}); err != nil {
		return nil, err
	}
	var before profiles.Region
	s.trash.ChangeLanguage(ctx, jobs.LanguageChange{
		Language: string(want),
		Apply: func(ctx context.Context) error {
			var err error
			if before, _, err = s.profiles.Region(ctx); err != nil {
				return err
			}
			_, err = s.setRegion(ctx, profiles.RegionPatch{Primary: &want, Country: l.ReleaseDateCountry})
			return err
		},
		Undo: func(ctx context.Context) error {
			_, err := s.setRegion(ctx, profiles.RegionPatch{Primary: &before.Primary, Country: &before.Country})
			return err
		},
	})
	out, err := s.settingsBody(ctx)
	if err != nil {
		return nil, err
	}
	return oapi.PatchSettings200JSONResponse(out), nil
}

func (s *server) patchSettings(ctx context.Context, r oapi.PatchSettingsRequestObject) (oapi.PatchSettingsResponseObject, error) {
	// Every section saves in one transaction, so a rejected patch changes nothing.
	tx, err := s.opts.Store.Write().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	w := s.settings.InTx(tx)
	wasPaused, err := s.pause.Paused(ctx)
	if err != nil {
		return nil, err
	}
	pausedSince, err := s.pause.PausedSince(ctx)
	if err != nil {
		return nil, err
	}
	if rf := r.Body.RootFolders; rf != nil {
		if _, err := w.SetRootFolders(ctx, rootfolders.Patch{Movies: rf.Movies, Series: rf.Series}); err != nil {
			var ve *rootfolders.ValidationError
			if errors.As(err, &ve) {
				return nil, invalid(ve.Field, ve.Code, ve.Message)
			}
			return nil, err
		}
	}
	if l := r.Body.LanguageRegion; l != nil {
		var patch profiles.RegionPatch
		if l.PrimaryLanguage != nil {
			lang := profiles.Language(*l.PrimaryLanguage)
			patch.Primary = &lang
		}
		patch.Country = l.ReleaseDateCountry
		if _, err := w.SetRegion(ctx, patch); err != nil {
			return nil, profilesProblem(err)
		}
	}
	if d := r.Body.Display; d != nil {
		patch := display.Patch{SeasonOrder: enumPtr(d.SeasonOrder), SeasonsOpen: enumPtr(d.SeasonsOpen), ManualSearchSort: enumPtr(d.ManualSearchSort)}
		if u := d.UpcomingFilters; u != nil {
			patch.Upcoming = &display.UpcomingPatch{Kind: enumPtr(u.Kind), WantedOnly: u.WantedOnly, HideImported: u.HideImported}
		}
		if _, err := w.SetDisplay(ctx, patch); err != nil {
			var ve *display.ValidationError
			if errors.As(err, &ve) {
				return nil, invalid("display."+ve.Field, "invalid", ve.Message)
			}
			return nil, err
		}
	}
	if t := r.Body.Trash; t != nil && t.AutoUpdate != nil {
		if err := w.SetTrashAutoUpdate(ctx, *t.AutoUpdate); err != nil {
			return nil, err
		}
	}
	if p := r.Body.PauseGrabs; p != nil {
		if err := w.SetGrabsPaused(ctx, *p); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	if p := r.Body.PauseGrabs; p != nil && !*p && wasPaused {
		// What the sweep searched while paused is due again, so the next sweep grabs.
		if err := s.library.SearchAfterPause(ctx, pausedSince); err != nil {
			return nil, err
		}
		s.jobs.Kick(jobs.Search)
	}
	if m := r.Body.Metadata; m != nil {
		if err := s.keys.SetOverrides(ctx, m.TmdbApiKey, m.TvdbApiKey); err != nil {
			return nil, err
		}
	}
	if on := r.Body.CheckGithubUpdates; on != nil {
		if err := s.updates.SetEnabled(ctx, *on); err != nil {
			return nil, err
		}
		if !*on { // nothing from GitHub stays on screen once the switch is off
			if err := s.updates.Check(ctx); err != nil {
				return nil, err
			}
		}
	}
	out, err := s.settingsBody(ctx)
	if err != nil {
		return nil, err
	}
	return oapi.PatchSettings200JSONResponse(out), nil
}
