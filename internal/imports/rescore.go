package imports

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"slices"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/probe"
	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
)

// Rescore re-scores the files of a Version under the Version's current Profile
// after a Profile switch. It reads the snapshots stored at Import time: no
// re-parse, no new ffprobe and no rename. A file whose probed resolution class
// or languages the Profile's hard rules no longer accept is marked a misfit,
// which makes the Version Wanted until a fitting Release replaces it. A file
// without snapshots (nothing to judge by) keeps its Score and stays fitting.
func (s *Service) Rescore(ctx context.Context, titleID, versionID int64) error {
	region, _, err := s.prof.Region(ctx)
	if err != nil {
		return err
	}
	d, err := s.lib.Get(ctx, titleID, library.View{Country: region.Country, Now: s.clock()})
	if err != nil {
		return err
	}
	var ver *library.Version
	for i := range d.Versions {
		if d.Versions[i].ID == versionID {
			ver = &d.Versions[i]
		}
	}
	if ver == nil {
		return library.ErrVersionNotFound
	}
	all, err := s.prof.List(ctx)
	if err != nil {
		return err
	}
	i := slices.IndexFunc(all, func(p profiles.Profile) bool { return p.Key == ver.Profile })
	if i < 0 {
		return fmt.Errorf("the Version's Profile %q no longer exists", ver.Profile)
	}
	profile, err := s.snap.Profile(all[i].Spec(region.Primary.Release()))
	if err != nil {
		return err
	}
	files, err := s.lib.FilesOfVersion(ctx, versionID)
	if err != nil {
		return err
	}
	original := codeOfLanguage(release.LanguageByISO(d.OriginalLanguage))
	var out []library.Rescored
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
		misfit := !slices.Contains(profile.Classes(), info.Class()) || verdict.Rejected(scoring.RejectLanguage)
		out = append(out, library.Rescored{FileID: f.ID, Score: verdict.Score, Misfit: misfit})
	}
	return s.lib.ApplyRescore(ctx, out)
}

// RemoveFile deletes a library file from disk with the subtitles named after
// it. A file that is already gone is fine.
func RemoveFile(path string) { removeWithSidecars(path) }
