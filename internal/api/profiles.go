package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"sort"

	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/configfile"
	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/jobs"
	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
	"github.com/hyprsh/kestrel/internal/settings/display"
	"github.com/hyprsh/kestrel/internal/settings/rootfolders"
	"github.com/hyprsh/kestrel/internal/slot"
)

func profilesProblem(err error) error {
	var ve *profiles.ValidationError
	var de *profiles.DefaultError
	switch {
	case errors.Is(err, profiles.ErrNotFound):
		return problem(http.StatusNotFound, "not_found", "no such Profile")
	case errors.Is(err, profiles.ErrRecipeExists):
		return problem(http.StatusConflict, "conflict", "The household already has a Profile for that recipe")
	case errors.Is(err, profiles.ErrInUse):
		return problem(http.StatusConflict, "conflict", "A Version still uses that Profile: switch it to another Profile first")
	case errors.As(err, &de):
		return problem(http.StatusConflict, "conflict", de.Error())
	case errors.As(err, &ve):
		return invalid(ve.Field, ve.Code, ve.Message)
	}
	return err
}

// profileToAPI is the Profile as the API shows it. A Profile has no Slot of its own: for v1 clients its `slot` is the
// first Slot that names it as a default, and `default_movies` and `default_series` say whether any Slot does.
func (s *server) profileToAPI(p profiles.Profile, slots []slot.Record) oapi.Profile {
	var sl *oapi.SlotId
	var movies, series bool
	for _, r := range slots {
		if r.DefaultMovies == p.Key || r.DefaultSeries == p.Key {
			if sl == nil {
				id := r.ID.Key()
				sl = &id
			}
		}
		movies = movies || r.DefaultMovies == p.Key
		series = series || r.DefaultSeries == p.Key
	}
	var applies []release.Kind
	for _, k := range []release.Kind{release.KindMovie, release.KindSeries} {
		if p.AppliesTo(k) {
			applies = append(applies, k)
		}
	}
	var custom *bool
	if p.Custom {
		yes := true
		custom = &yes
	}
	return oapi.Profile{
		Key: p.Key, Name: p.Name, Slot: sl, LanguageRule: oapi.ProfileLanguageRule(p.RuleKey()), Kinds: kindsToAPI(applies), ReleaseFamily: oapi.ProfileReleaseFamily(p.Family.OrDefault()),
		Resolution:       oapi.ProfileResolution(p.Resolution()),
		OriginalLanguage: oapi.OriginalLanguageChoice(p.OriginalChoice), OriginalFallback: p.OriginalChoice.DeprecatedFlag(),
		Enabled: p.Enabled, DefaultMovies: movies, DefaultSeries: series,
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
	b := r.Body
	var p profiles.Profile
	var err error
	recipe := b.ReleaseFamily != nil || b.Resolution != nil || b.LanguageRule != nil
	switch {
	case recipe && b.CopyFrom != nil:
		return nil, invalid("copy_from", "invalid", "Send copy_from to copy a Profile, or a recipe to import one, not both")
	case recipe:
		if b.ReleaseFamily == nil || b.Resolution == nil || b.LanguageRule == nil {
			return nil, invalid("release_family", "required", "A recipe needs release_family, resolution and language_rule")
		}
		name := ""
		if b.Name != nil {
			name = *b.Name
		}
		res, ok := profiles.ResolutionOf(string(*b.Resolution))
		if !ok {
			return nil, invalid("resolution", "invalid", "Choose hd, 4k or any")
		}
		var rc profiles.Recipe
		if rc, err = profiles.ParseRecipe(scoring.ReleaseFamily(*b.ReleaseFamily), res, string(*b.LanguageRule)); err != nil {
			return nil, profilesProblem(err)
		}
		p, err = s.profiles.Import(ctx, rc, name)
	case b.CopyFrom != nil && b.Name != nil:
		p, err = s.profiles.Create(ctx, *b.Name, *b.CopyFrom)
	default:
		return nil, invalid("copy_from", "required", "Send name and copy_from to copy a Profile, or a recipe to import one")
	}
	if err != nil {
		return nil, profilesProblem(err)
	}
	slots, err := s.slots.List(ctx)
	if err != nil {
		return nil, err
	}
	how := "created by hand on the Profiles screen"
	switch {
	case b.CopyFrom != nil:
		how = "copied from Profile " + *b.CopyFrom + " by hand on the Profiles screen"
	case recipe:
		how = "added from a suggested recipe by hand on the Profiles screen"
	}
	s.recordConfig(ctx, history.ProfileCreated, fmt.Sprintf("Profile %q created", p.Name), how, map[string]any{"profile": p.Key, "name": p.Name})
	return oapi.CreateProfile201JSONResponse(s.profileToAPI(p, slots)), nil
}

func (s *server) ListProfileSuggestions(ctx context.Context, _ oapi.ListProfileSuggestionsRequestObject) (oapi.ListProfileSuggestionsResponseObject, error) {
	all, err := s.profiles.Suggestions(ctx)
	if err != nil {
		return nil, err
	}
	out := oapi.ProfileSuggestionList{Groups: []oapi.ProfileSuggestionGroup{}}
	for _, sg := range all {
		if n := len(out.Groups); n == 0 || out.Groups[n-1].ReleaseFamily != oapi.ProfileReleaseFamily(sg.Recipe.Family) {
			out.Groups = append(out.Groups, oapi.ProfileSuggestionGroup{
				ReleaseFamily: oapi.ProfileReleaseFamily(sg.Recipe.Family), Name: sg.Recipe.Family.Name(), Items: []oapi.ProfileSuggestion{},
			})
		}
		g := &out.Groups[len(out.Groups)-1]
		g.Items = append(g.Items, oapi.ProfileSuggestion{
			Name: sg.Name, ReleaseFamily: oapi.ProfileReleaseFamily(sg.Recipe.Family), Resolution: oapi.ProfileResolution(sg.Recipe.Resolution),
			LanguageRule: oapi.ProfileLanguageRule(sg.Recipe.RuleKey()), Kinds: kindsToAPI(sg.Kinds),
		})
	}
	return oapi.ListProfileSuggestions200JSONResponse(out), nil
}

func (s *server) DeleteProfile(ctx context.Context, r oapi.DeleteProfileRequestObject) (oapi.DeleteProfileResponseObject, error) {
	if err := s.refuseDeclared(configfile.SectionProfiles); err != nil {
		return nil, err
	}
	name := s.profileName(ctx, string(r.Key))
	if err := s.profiles.Delete(ctx, string(r.Key)); err != nil {
		return nil, profilesProblem(err)
	}
	s.recordConfig(ctx, history.ProfileDeleted, fmt.Sprintf("Profile %q deleted", name), "deleted by hand on the Profiles screen",
		map[string]any{"profile": string(r.Key), "name": name})
	return oapi.DeleteProfile204Response{}, nil
}

// profileName is the name of the Profile with the key, else the key.
func (s *server) profileName(ctx context.Context, key string) string {
	all, _ := s.profiles.List(ctx)
	for _, p := range all {
		if p.Key == key {
			return p.Name
		}
	}
	return key
}

func (s *server) ListProfiles(ctx context.Context, _ oapi.ListProfilesRequestObject) (oapi.ListProfilesResponseObject, error) {
	all, err := s.profiles.List(ctx)
	if err != nil {
		return nil, err
	}
	slots, err := s.slots.List(ctx)
	if err != nil {
		return nil, err
	}
	out := oapi.ProfileList{Items: make([]oapi.Profile, len(all))}
	for i, p := range all {
		out.Items[i] = s.profileToAPI(p, slots)
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
	for field, set := range map[string]*bool{"default_movies": b.DefaultMovies, "default_series": b.DefaultSeries} {
		if set != nil {
			return nil, invalid(field, "invalid", "The defaults for new Titles belong to the Slots: set it with PATCH /slots/{id}")
		}
	}
	original, err := scoring.OriginalChoiceOf((*scoring.OriginalChoice)(b.OriginalLanguage), b.OriginalFallback)
	if err != nil {
		return nil, invalid("original_fallback", "invalid", "original_fallback disagrees with original_language; send original_language only")
	}
	patch := profiles.Patch{
		Enabled: b.Enabled, OriginalChoice: original, Name: b.Name,
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
	var fields []string
	for name, set := range map[string]bool{"enabled": b.Enabled != nil, "name": b.Name != nil, "original_language": b.OriginalLanguage != nil || b.OriginalFallback != nil, "overlay": b.Overlay != nil} {
		if set {
			fields = append(fields, name)
		}
	}
	sort.Strings(fields)
	s.recordConfig(ctx, history.ProfileChanged, fmt.Sprintf("Profile %q changed: %s", p.Name, said(fields)), "edited by hand on the Profiles screen",
		map[string]any{"profile": p.Key, "name": p.Name, "fields": fields})
	if b.Overlay != nil {
		// What the Profile does has changed: work out the stored files again from what Import kept.
		if err := s.rescoreProfile(ctx, p.Key); err != nil {
			return nil, err
		}
	}
	slots, err := s.slots.List(ctx)
	if err != nil {
		return nil, err
	}
	return oapi.PatchProfile200JSONResponse(s.profileToAPI(p, slots)), nil
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
	recs, err := s.slots.List(ctx)
	if err != nil {
		return oapi.Settings{}, err
	}
	all, err := s.profiles.List(ctx)
	if err != nil {
		return oapi.Settings{}, err
	}
	if w := append(settingsWarnings(recs), duplicateWarnings(all, region.Primary)...); len(w) > 0 {
		out.Warnings = &w
	}
	out.FromConfigFile.LanguageRegion = s.declares(configfile.SectionLanguageRegion)
	out.FromConfigFile.RootFolders = s.declares(configfile.SectionRootFolders)
	out.FromConfigFile.CheckGithubUpdates = s.declares(configfile.SectionCheckGitHubUpdates)
	return out, nil
}

// settingsWarnings is slot.SharedDefaults as the API shows them.
func settingsWarnings(recs []slot.Record) []oapi.SettingsWarning {
	var out []oapi.SettingsWarning
	for _, w := range slot.SharedDefaults(recs) {
		kind, profile := "movies", w.Profile
		if w.Kind == release.KindSeries {
			kind = "series"
		}
		ids := make([]string, len(w.Slots))
		for i, id := range w.Slots {
			ids[i] = id.Key()
		}
		out = append(out, oapi.SettingsWarning{Code: oapi.SharedSlotDefault, Kind: &kind, Profile: &profile, Slots: &ids, Message: w.Message()})
	}
	return out
}

// duplicateWarnings names each pair of Profiles that became the same recipe by a change of Primary Language.
func duplicateWarnings(all []profiles.Profile, primary profiles.Language) []oapi.SettingsWarning {
	var out []oapi.SettingsWarning
	for _, d := range profiles.Duplicates(all, primary) {
		keys := []string{d.A.Key, d.B.Key}
		out = append(out, oapi.SettingsWarning{Code: oapi.DuplicateProfile, Profiles: &keys, Message: d.Message(primary)})
	}
	return out
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
	before, err := s.settingsBody(ctx)
	if err != nil {
		return nil, err
	}
	var resp oapi.PatchSettingsResponseObject
	if l := r.Body.LanguageRegion; l != nil && l.PrimaryLanguage != nil {
		resp, err = s.queueLanguage(ctx, r)
	} else {
		resp, err = s.patchSettings(ctx, r)
	}
	if err != nil {
		return resp, err
	}
	s.recordSettings(ctx, before, r.Body)
	return resp, nil
}

// recordSettings writes the one entry for a settings save: the keys it changed. Pause Grabs has its own entries.
// The entry names keys and never values, so a secret (an API key) cannot reach it.
func (s *server) recordSettings(ctx context.Context, before oapi.Settings, body *oapi.PatchSettingsJSONRequestBody) {
	if p := body.PauseGrabs; p != nil && *p != before.PauseGrabs {
		kind, msg, why := history.GrabsPaused, "Pause Grabs turned on", "turned on by hand in Settings: new Grabs wait until it is turned off"
		if !*p {
			kind, msg, why = history.GrabsResumed, "Pause Grabs turned off", "turned off by hand in Settings: searches that waited are due again"
		}
		s.recordConfig(ctx, kind, msg, why, nil)
	}
	keys := slices.DeleteFunc(changedSettings(before, body), func(k string) bool { return k == "pause_grabs" })
	if len(keys) > 0 {
		s.recordConfig(ctx, history.SettingsChanged, "Settings changed: "+said(keys), "saved by hand in Settings", map[string]any{"keys": keys})
	}
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
	// Refuse now, naming the Profiles, rather than fail in the background pass that saves the Language.
	if err := s.profiles.CheckPrimary(ctx, want); err != nil {
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
		if err := s.imports.Rescore(ctx, v.TitleID, v.VersionID, "the Profile "+key+" was edited"); err != nil {
			return err
		}
	}
	return nil
}
