package imports

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"slices"

	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/probe"
	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
)

// SwitchProfile moves a Version of a Title to another Profile, makes it due a
// search now and re-scores its files under the new Profile; the caller kicks
// the sweep. Whether the Profile belongs to the Version's Slot is for the
// caller to check.
func (s *Service) SwitchProfile(ctx context.Context, titleID, versionID int64, profile string) error {
	if err := s.lib.SetProfile(ctx, versionID, profile); err != nil {
		return err
	}
	return s.Rescore(ctx, titleID, versionID, "the Version moved to the Profile "+profile)
}

// Rescore re-scores the files of a Version under the Version's current Profile
// after a Profile switch. It reads the snapshots stored at Import time: no
// re-parse, no new ffprobe and no rename. A file whose probed resolution class
// or languages the Profile's hard rules no longer accept is marked a misfit,
// which makes the Version Wanted until a fitting Release replaces it. A file
// without snapshots (nothing to judge by) keeps its Score and stays fitting.
//
// why says what changed ("the Profile Standard was edited"); the Log gets an entry for each file whose Score
// changed and each file newly marked misfit, with why as the start of their reason.
func (s *Service) Rescore(ctx context.Context, titleID, versionID int64, why string) error {
	defer s.snap.Hold()()
	region, _, err := s.prof.Region(ctx)
	if err != nil {
		return err
	}
	all, err := s.prof.List(ctx)
	if err != nil {
		return err
	}
	out, changes, err := s.rescoreVersion(ctx, s.snap.Current(), region, all, titleID, versionID)
	if err != nil {
		return err
	}
	if err := s.lib.ApplyRescore(ctx, out); err != nil {
		return err
	}
	s.recordRescored(ctx, why, changes)
	return nil
}

// RescoreTitles re-scores every file of the given Titles under snap and the
// current Primary Language, in one write: either every file has its new Score or
// none does. It reads the stored parse and probe, so nothing is re-parsed,
// renamed or searched. A TRaSH update and a Primary Language change both use it;
// the caller holds the snapshot gate (scoring.Holder.Exclusive). progress, if
// not nil, is told how many Titles are re-scored so far as it goes. why says
// what changed, for the Log (see Rescore).
func (s *Service) RescoreTitles(ctx context.Context, snap *scoring.Snapshot, titleIDs []int64, why string, progress func(done int)) error {
	region, _, err := s.prof.Region(ctx)
	if err != nil {
		return err
	}
	all, err := s.prof.List(ctx)
	if err != nil {
		return err
	}
	var out []library.Rescored
	var changes []fileChange
	for i, id := range titleIDs {
		d, err := s.lib.Get(ctx, id, library.View{Country: region.Country, Now: s.clock()})
		if err != nil {
			return err
		}
		for _, v := range d.Versions {
			rs, cs, err := s.rescoreVersion(ctx, snap, region, all, id, v.ID)
			if err != nil {
				return err
			}
			out = append(out, rs...)
			changes = append(changes, cs...)
		}
		if progress != nil {
			progress(i + 1)
		}
	}
	if err := s.lib.ApplyRescore(ctx, out); err != nil {
		return err
	}
	s.recordRescored(ctx, why, changes)
	return nil
}

// fileChange is what a re-score changed about one file, for the Log.
type fileChange struct {
	titleID, versionID, fileID int64
	path                       string
	oldScore                   *int
	newScore                   int
	// misfit is why the file is newly marked misfit, "" when it is not.
	misfit string
}

// recordRescored writes the Log entries of a re-score that was stored: one for each file whose Score changed and
// one for each newly marked misfit, none for the files the pass only looked at.
func (s *Service) recordRescored(ctx context.Context, why string, changes []fileChange) {
	trigger := history.TriggerOr(ctx, history.Job(history.TriggerJob, "rescore"))
	for _, c := range changes {
		if c.misfit != "" {
			s.record(ctx, history.Event{
				Kind: history.FileMisfit, TitleID: c.titleID, VersionID: c.versionID,
				Message: "Marked " + filepath.Base(c.path) + " as a misfit",
				Trigger: trigger, Reason: why + ": " + c.misfit,
				Data: jsonOf(map[string]any{"file_id": c.fileID, "path": c.path}),
			})
		}
		if c.oldScore == nil || *c.oldScore != c.newScore {
			from := "no Score"
			data := map[string]any{"file_id": c.fileID, "path": c.path, "to": c.newScore}
			if c.oldScore != nil {
				from = fmt.Sprintf("%d", *c.oldScore)
				data["from"] = *c.oldScore
			}
			s.record(ctx, history.Event{
				Kind: history.FileRescored, TitleID: c.titleID, VersionID: c.versionID,
				Message: fmt.Sprintf("Re-scored %s from %s to %d", filepath.Base(c.path), from, c.newScore),
				Trigger: trigger, Reason: why, Data: jsonOf(data),
			})
		}
	}
}

func (s *Service) rescoreVersion(ctx context.Context, snap *scoring.Snapshot, region profiles.Region, all []profiles.Profile, titleID, versionID int64) ([]library.Rescored, []fileChange, error) {
	d, err := s.lib.Get(ctx, titleID, library.View{Country: region.Country, Now: s.clock()})
	if err != nil {
		return nil, nil, err
	}
	var ver *library.Version
	for i := range d.Versions {
		if d.Versions[i].ID == versionID {
			ver = &d.Versions[i]
		}
	}
	if ver == nil {
		return nil, nil, library.ErrVersionNotFound
	}
	i := slices.IndexFunc(all, func(p profiles.Profile) bool { return p.Key == ver.Profile })
	if i < 0 {
		return nil, nil, fmt.Errorf("the Version's Profile %q no longer exists", ver.Profile)
	}
	profile, err := snap.Profile(all[i].Spec(region.Primary.Release()))
	if err != nil {
		return nil, nil, err
	}
	files, err := s.lib.FilesOfVersion(ctx, versionID)
	if err != nil {
		return nil, nil, err
	}
	original := codeOfLanguage(release.LanguageByISO(d.OriginalLanguage))
	var out []library.Rescored
	var changes []fileChange
	for _, f := range files {
		var parsed release.ParsedRelease
		var info probe.Info
		if json.Unmarshal([]byte(f.ParsedRelease), &parsed) != nil || json.Unmarshal([]byte(f.Probe), &info) != nil {
			continue
		}
		languages, inconclusive := probe.ResolveLanguages(parsedCodes(parsed, original), info.Audio)
		verdict := scoring.Evaluate(
			scoring.Release{Parsed: parsed, IndexerLanguages: languagesOf(languages, inconclusive), Size: info.Size, Filename: filepath.Base(f.Path)},
			scoring.Title{Name: d.Title, Year: d.Year, OriginalLanguage: release.LanguageByISO(d.OriginalLanguage)}, profile,
		)
		misfit, original := fitOf(profile, info, verdict, f.Original)
		out = append(out, library.Rescored{FileID: f.ID, Score: verdict.Score, Misfit: misfit, Original: original})
		c := fileChange{titleID: titleID, versionID: versionID, fileID: f.ID, path: f.Path, oldScore: f.Score, newScore: verdict.Score}
		if misfit && !f.Misfit {
			c.misfit = misfitWhy(profile, info, verdict, f.Original)
		}
		if c.misfit != "" || f.Score == nil || *f.Score != verdict.Score {
			changes = append(changes, c)
		}
	}
	return out, changes, nil
}

// FileFormats names the Custom Formats each file of a Title matches, by file id,
// as its Version's Profile scores the file now: from the stored parse and probe
// snapshots, the way Rescore does, so the points add up to the file's Score. The
// Grab's own verdict is not used: it predates any Profile switch or TRaSH update,
// and an adopted file has none. A file without snapshots is left out.
func (s *Service) FileFormats(ctx context.Context, titleID int64) (map[int64][]scoring.MatchedFormat, error) {
	defer s.snap.Hold()()
	region, _, err := s.prof.Region(ctx)
	if err != nil {
		return nil, err
	}
	all, err := s.prof.List(ctx)
	if err != nil {
		return nil, err
	}
	d, err := s.lib.Get(ctx, titleID, library.View{Country: region.Country, Now: s.clock()})
	if err != nil {
		return nil, err
	}
	out := map[int64][]scoring.MatchedFormat{}
	for _, ver := range d.Versions {
		i := slices.IndexFunc(all, func(p profiles.Profile) bool { return p.Key == ver.Profile })
		if i < 0 {
			continue
		}
		profile, err := s.snap.Current().Profile(all[i].Spec(region.Primary.Release()))
		if err != nil {
			return nil, err
		}
		files, err := s.lib.FilesOfVersion(ctx, ver.ID)
		if err != nil {
			return nil, err
		}
		original := codeOfLanguage(release.LanguageByISO(d.OriginalLanguage))
		for _, f := range files {
			var parsed release.ParsedRelease
			var info probe.Info
			if json.Unmarshal([]byte(f.ParsedRelease), &parsed) != nil || json.Unmarshal([]byte(f.Probe), &info) != nil {
				continue
			}
			languages, inconclusive := probe.ResolveLanguages(parsedCodes(parsed, original), info.Audio)
			verdict := scoring.Evaluate(
				scoring.Release{Parsed: parsed, IndexerLanguages: languagesOf(languages, inconclusive), Size: info.Size, Filename: filepath.Base(f.Path)},
				scoring.Title{Name: d.Title, Year: d.Year, OriginalLanguage: release.LanguageByISO(d.OriginalLanguage)}, profile,
			)
			out[f.ID] = verdict.Matched
		}
	}
	return out, nil
}
