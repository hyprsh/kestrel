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
	case errors.Is(err, profiles.ErrInUse):
		return problem(http.StatusConflict, "conflict", "A Version still uses that Profile: switch it to another Profile first")
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
	var custom *bool
	if p.Custom {
		yes := true
		custom = &yes
	}
	return oapi.Profile{
		Key: p.Key, Name: p.Name, Slot: slot, LanguageRule: rule,
		OriginalLanguage: oapi.OriginalLanguageChoice(p.OriginalChoice), OriginalFallback: p.OriginalChoice.DeprecatedFlag(),
		Enabled: p.Enabled, DefaultMovies: p.DefaultMovies, DefaultSeries: p.DefaultSeries,
		MinHeight: p.MinHeight, MaxHeight: p.MaxHeight,
		TrashProfileMovies: p.TrashMovies, TrashProfileSeries: p.TrashSeries,
		FromConfigFile: s.declares(configfile.SectionProfiles), Custom: custom,
	}
}

// overlayFromAPI is the Overlay a patch sets.
func overlayFromAPI(o oapi.ProfileOverlay) scoring.Overlay {
	kind := func(k oapi.ProfileKindOverlay) scoring.KindOverlay {
		out := scoring.KindOverlay{}
		if k.Cutoff != nil {
			out.Cutoff = *k.Cutoff
		}
		if k.Qualities != nil {
			for _, q := range *k.Qualities {
				out.Qualities = append(out.Qualities, scoring.QualityPref{Name: q.Name, Accepted: q.Accepted})
			}
		}
		return out
	}
	size := func(z oapi.ProfileSize) scoring.SizeLimit {
		var l scoring.SizeLimit
		if z.Min != nil {
			l.Min = *z.Min
		}
		if z.Max != nil {
			l.Max = *z.Max
		}
		return l
	}
	return scoring.Overlay{
		MinScore: o.MinScore, UpgradeUntil: o.UpgradeUntil, Series: kind(o.Series), Movies: kind(o.Movies),
		EpisodeSize: size(o.EpisodeSize), MovieSize: size(o.MovieSize),
	}
}

// overlayToAPI is the Overlay as the API shows it.
func overlayToAPI(o scoring.Overlay) oapi.ProfileOverlay {
	kind := func(k scoring.KindOverlay) oapi.ProfileKindOverlay {
		out := oapi.ProfileKindOverlay{}
		if k.Cutoff != "" {
			c := k.Cutoff
			out.Cutoff = &c
		}
		if len(k.Qualities) > 0 {
			qs := qualitiesToAPI(k.Qualities)
			out.Qualities = &qs
		}
		return out
	}
	size := func(l scoring.SizeLimit) oapi.ProfileSize {
		var z oapi.ProfileSize
		if l.Min > 0 {
			v := l.Min
			z.Min = &v
		}
		if l.Max > 0 {
			v := l.Max
			z.Max = &v
		}
		return z
	}
	return oapi.ProfileOverlay{
		MinScore: o.MinScore, UpgradeUntil: o.UpgradeUntil, Series: kind(o.Series), Movies: kind(o.Movies),
		EpisodeSize: size(o.EpisodeSize), MovieSize: size(o.MovieSize),
	}
}

func qualitiesToAPI(qs []scoring.QualityPref) []oapi.ProfileQuality {
	out := make([]oapi.ProfileQuality, len(qs))
	for i, q := range qs {
		out[i] = oapi.ProfileQuality{Name: q.Name, Accepted: q.Accepted}
	}
	return out
}

func (s *server) CreateProfile(ctx context.Context, r oapi.CreateProfileRequestObject) (oapi.CreateProfileResponseObject, error) {
	if r.Body == nil {
		return nil, invalid("body", "required", "a body is required")
	}
	if err := s.refuseDeclared(configfile.SectionProfiles); err != nil {
		return nil, err
	}
	p, err := s.profiles.Create(ctx, r.Body.Name, r.Body.CopyFrom)
	if err != nil {
		return nil, profilesProblem(err)
	}
	return oapi.CreateProfile201JSONResponse(s.profileToAPI(p)), nil
}

func (s *server) DeleteProfile(ctx context.Context, r oapi.DeleteProfileRequestObject) (oapi.DeleteProfileResponseObject, error) {
	if err := s.refuseDeclared(configfile.SectionProfiles); err != nil {
		return nil, err
	}
	if err := s.profiles.Delete(ctx, string(r.Key)); err != nil {
		return nil, profilesProblem(err)
	}
	return oapi.DeleteProfile204Response{}, nil
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
	patch := profiles.Patch{
		Enabled: b.Enabled, OriginalChoice: original, DefaultMovies: b.DefaultMovies, DefaultSeries: b.DefaultSeries, Name: b.Name,
	}
	if b.Overlay != nil {
		o := overlayFromAPI(*b.Overlay)
		patch.Overlay = &o
	}
	p, err := s.profiles.Patch(ctx, string(r.Key), patch)
	var ve *profiles.ValidationError
	if b.OriginalLanguage == nil && errors.As(err, &ve) && ve.Field == "original_language" {
		ve.Field = "original_fallback" // the client sent the deprecated field
	}
	if err != nil {
		return nil, profilesProblem(err)
	}
	if b.Overlay != nil {
		// What the Profile does has changed: work out the stored files again from what Import kept.
		if err := s.rescoreProfile(ctx, p.Key); err != nil {
			return nil, err
		}
	}
	return oapi.PatchProfile200JSONResponse(s.profileToAPI(p)), nil
}

// restoreRegion undoes setRegion, in a transaction of its own.
func (s *server) restoreRegion(ctx context.Context, before profiles.Region, saved bool) error {
	tx, err := s.opts.Store.Write().BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := s.settings.InTx(tx).RestoreRegion(ctx, before, saved); err != nil {
		return err
	}
	return tx.Commit()
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
	d, err := s.display.Get(ctx)
	if err != nil {
		return oapi.Settings{}, err
	}
	out.Display = displayToAPI(d)
	s.fillDeclaredDisplay(&out)
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
	if err := s.refuseDeclaredDisplay(r.Body); err != nil {
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
	var wasSaved bool
	s.trash.ChangeLanguage(ctx, jobs.LanguageChange{
		Language: string(want),
		Apply: func(ctx context.Context) error {
			var err error
			if before, wasSaved, err = s.profiles.Region(ctx); err != nil {
				return err
			}
			_, err = s.setRegion(ctx, profiles.RegionPatch{Primary: &want, Country: l.ReleaseDateCountry})
			return err
		},
		Undo: func(ctx context.Context) error {
			return s.restoreRegion(ctx, before, wasSaved)
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
		patch := display.Patch{SeasonOrder: enumPtr(d.SeasonOrder), SeasonsOpen: enumPtr(d.SeasonsOpen), ManualSearchSort: enumPtr(d.ManualSearchSort), UpcomingDisplay: enumPtr(d.UpcomingDisplay)}
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

// rescoreProfile re-scores the files of every Version under the Profile, as a switch of Profile does.
func (s *server) rescoreProfile(ctx context.Context, key string) error {
	vs, err := s.profiles.Versions(ctx, key)
	if err != nil {
		return err
	}
	for _, v := range vs {
		if err := s.imports.Rescore(ctx, v.TitleID, v.VersionID); err != nil {
			return err
		}
	}
	return nil
}
