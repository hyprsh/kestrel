package imports

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"syscall"
	"time"

	"github.com/hyprsh/kestrel/internal/health"
	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/probe"
	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
)

// Status is how an Import ended.
type Status string

const (
	// Imported means the file is in the library and the Version holds it.
	Imported Status = "imported"
	// Rejected means the Release is at fault: acquire blocklists it.
	Rejected Status = "rejected"
	// Stalled means the environment is at fault (disk full, no ffprobe, a
	// path taken by an untracked file); the Grab waits for a retry.
	Stalled Status = "stalled"
)

// Rejection reasons of a rejected Import.
const (
	ReasonInvalid    = "invalid"
	ReasonResolution = "resolution"
	ReasonLanguage   = "language"
	ReasonNotUpgrade = "not_upgrade"
)

// Stalled reasons that callers and tests name.
const (
	StalledPathOccupied = "path occupied"
	StalledNoVideo      = "no video file"
	StalledNoFFprobe    = "ffprobe not installed"
	StalledRootFolder   = "root folder unavailable"
)

// Grab is what an Import needs to know of a completed Grab. imports never
// reads or writes Grabs; acquire hands this over and records the Result.
type Grab struct {
	ID          int64
	TitleID     int64
	VersionID   int64
	ReleaseName string
	// Parsed is the JSON snapshot of the Release's parsed name.
	Parsed []byte
	// SourcePath is where the download client put the finished job.
	SourcePath string
	// CanRemove says the client lets go of the files, so the Import moves
	// them; otherwise it hardlinks.
	CanRemove bool
}

// Result is the outcome of one Import.
type Result struct {
	Status Status
	// Reason is the rejection code or the stalled reason.
	Reason string
	// Path is the imported file.
	Path string
	// Score is the probed re-score of the imported file.
	Score int
	// Inconclusive says the probe could not tell the audio languages, so the
	// parsed ones stand (for the Log).
	Inconclusive bool
	// CrossDevice says the file had to be copied because the download folder
	// and the library are on different filesystems (a health Warning).
	CrossDevice bool
	// Episodes are the per-episode results of a Series Import, in aired order.
	Episodes []EpisodeResult
}

// Library is what imports needs of the library module.
type Library interface {
	Get(ctx context.Context, id int64, view library.View) (library.Detail, error)
	ReplaceFile(ctx context.Context, titleID int64, folder string, f library.NewFile) ([]library.File, error)
	FileOfGrab(ctx context.Context, grabID int64) (library.File, bool, error)
	// The Series side: episodes with their cells, a file for several episodes
	// at once, the files an earlier run of this Grab recorded and the paths a
	// Version holds.
	Episodes(ctx context.Context, titleID int64, view library.View) ([]library.Episode, error)
	FilesReplacedBy(ctx context.Context, versionID int64, episodeIDs []int64) ([]library.File, error)
	ReplaceEpisodeFile(ctx context.Context, titleID int64, folder string, f library.NewFile, episodeIDs []int64) ([]library.File, error)
	FilesOfGrab(ctx context.Context, grabID int64) ([]library.File, error)
	PathsOfVersion(ctx context.Context, versionID int64) ([]string, error)
	FilesOfVersion(ctx context.Context, versionID int64) ([]library.File, error)
	ApplyRescore(ctx context.Context, rs []library.Rescored) error
	SetProfile(ctx context.Context, versionID int64, profile string) error
	// GetVersion and RemoveFiles delete files and keep their Version.
	GetVersion(ctx context.Context, id int64) (library.VersionRef, error)
	RemoveFiles(ctx context.Context, versionID int64, fileIDs []int64) ([]library.File, error)
}

// Profiles is what imports needs of the Profiles.
type Profiles interface {
	List(ctx context.Context) ([]profiles.Profile, error)
	Region(ctx context.Context) (profiles.Region, bool, error)
}

// Health is what imports needs of the health module: the Root folder check
// before each Import and the Needs attention row for a copy across filesystems.
// *health.Service satisfies it.
type Health interface {
	CheckRootFolder(ctx context.Context, path string) error
	Raise(ctx context.Context, is health.Issue) error
	Clear(ctx context.Context, key string) error
}

// History records the Log events of moves and deletions; *history.Service
// satisfies it.
type History interface {
	Record(ctx context.Context, ev history.Event)
}

// Deps are what a Service needs.
type Deps struct {
	Library  Library
	Profiles Profiles
	Prober   probe.Prober
	Clock    func() time.Time
	// Health is optional. With it an Import into a Root folder that is missing,
	// not a directory or not writable stalls, and a copy across filesystems
	// raises a Warning.
	Health Health
	// Renames enables Rename; *library.Service satisfies it.
	Renames RenameStore
	// FolderChanged, when set, is told the path of every Title folder that
	// Rename changed, so the media servers can be asked to refresh it. The
	// media-server module wires it.
	FolderChanged func(ctx context.Context, folder string)
	// Snapshot is the TRaSH data to score with; nil means the embedded one.
	Snapshot *scoring.Snapshot
	// Scoring is the live TRaSH snapshot; it wins over Snapshot.
	Scoring *scoring.Holder
	// Step, when set, is called at "partial" (the .partial file is in place)
	// and "committed" (the database row is written). An error stops the
	// Import there as if the process had been killed; tests use it.
	Step func(step string) error
	// Link hardlinks src to dst; nil means os.Link. Tests answer EXDEV with it
	// to cross a filesystem boundary that a temp dir does not have.
	Link func(src, dst string) error
	// Rename renames a directory; nil means os.Rename. Tests answer EXDEV with
	// it to cross a filesystem boundary that a temp dir does not have.
	Rename func(oldpath, newpath string) error
	// History records the move and delete events; may be nil.
	History History
}

// Service imports completed Grabs into the library.
type Service struct {
	lib   Library
	prof  Profiles
	probe probe.Prober
	clock func() time.Time
	snap  *scoring.Holder
	step  func(string) error
	link  func(src, dst string) error
	hl    Health
	// rename renames a Title folder on a Move.
	rename func(oldpath, newpath string) error
	// guard serialises Import, Rename, Move and DeleteFiles per Title.
	guard titleGuard

	renames       RenameStore
	folderChanged func(ctx context.Context, folder string)
	hist          History
}

// New returns a Service.
func New(d Deps) (*Service, error) {
	if d.Clock == nil {
		d.Clock = time.Now
	}
	if d.Scoring == nil {
		if d.Snapshot == nil {
			snap, err := scoring.Embedded()
			if err != nil {
				return nil, err
			}
			d.Snapshot = snap
		}
		d.Scoring = scoring.NewHolder(d.Snapshot)
	}
	if d.Link == nil {
		d.Link = os.Link
	}
	if d.Rename == nil {
		d.Rename = os.Rename
	}
	return &Service{lib: d.Library, prof: d.Profiles, probe: d.Prober, clock: d.Clock, snap: d.Scoring, step: d.Step, link: d.Link, rename: d.Rename, hl: d.Health, renames: d.Renames, folderChanged: d.FolderChanged, hist: d.History}, nil
}

func (s *Service) hook(step string) error {
	if s.step == nil {
		return nil
	}
	return s.step(step)
}

func stalled(reason string) Result  { return Result{Status: Stalled, Reason: reason} }
func rejected(reason string) Result { return Result{Status: Rejected, Reason: reason} }

// stalledBy turns an environment error into a stalled Result with a reason a
// person can act on.
func stalledBy(err error) Result {
	switch {
	case errors.Is(err, probe.ErrNotInstalled):
		return stalled(StalledNoFFprobe)
	case errors.Is(err, syscall.ENOSPC):
		return stalled("disk full")
	case errors.Is(err, syscall.EACCES), errors.Is(err, syscall.EPERM), errors.Is(err, syscall.EROFS):
		return stalled("permission denied")
	case errors.Is(err, os.ErrNotExist):
		return stalled("folder not found")
	}
	return stalled(err.Error())
}

// Import verifies a completed Movie Grab with ffprobe and puts its file into
// the Title's folder under the fixed naming scheme. It never returns an
// error: what goes wrong is either the Release's fault (Rejected) or the
// environment's (Stalled), and importing again is always safe.
func (s *Service) Import(ctx context.Context, g Grab) Result {
	unlock, _ := s.guard.lock(g.TitleID, forImport)
	defer unlock()
	defer s.snap.Hold()()
	res := s.importGrab(ctx, g)
	if res.Status == Imported && res.Path != "" && s.folderChanged != nil {
		// A movie's file lies in the Title folder, an episode's in a Season folder below it.
		folder := filepath.Dir(res.Path)
		if base := filepath.Base(folder); base == SeasonFolder(0) || strings.HasPrefix(base, "Season ") {
			folder = filepath.Dir(folder)
		}
		s.folderChanged(ctx, folder)
	}
	return res
}

func (s *Service) importGrab(ctx context.Context, g Grab) Result {
	region, _, err := s.prof.Region(ctx)
	if err != nil {
		return stalledBy(err)
	}
	d, err := s.lib.Get(ctx, g.TitleID, library.View{Country: region.Country, Now: s.clock()})
	if err != nil {
		return stalledBy(err)
	}
	var ver *library.Version
	for i := range d.Versions {
		if d.Versions[i].ID == g.VersionID {
			ver = &d.Versions[i]
		}
	}
	if ver == nil {
		return stalled("the Version no longer exists")
	}
	all, err := s.prof.List(ctx)
	if err != nil {
		return stalledBy(err)
	}
	var spec *profiles.Profile
	for i := range all {
		if all[i].Key == ver.Profile {
			spec = &all[i]
		}
	}
	if spec == nil {
		return stalled("the Version's Profile no longer exists")
	}
	profile, err := s.snap.Current().Profile(spec.Spec(region.Primary.Release()))
	if err != nil {
		return stalledBy(err)
	}
	var parsed release.ParsedRelease
	if err := json.Unmarshal(g.Parsed, &parsed); err != nil {
		return stalledBy(fmt.Errorf("read the Grab's parsed name: %w", err))
	}

	original := codeOfLanguage(release.LanguageByISO(d.OriginalLanguage))
	primary := codeOfLanguage(region.Primary.Release())
	if d.Kind == library.Series {
		return s.importSeries(ctx, g, d, ver, profile, parsed, primary, original)
	}
	name := d.Title
	if name == "" {
		name = d.OriginalTitle
	}
	title := Title{Name: name, Year: d.Year, TMDBID: d.TMDBID, OriginalLanguage: original}
	folder := d.Folder
	if folder == "" {
		if folder, err = MovieFolder(title); err != nil {
			return stalledBy(err)
		}
	}
	if s.hl != nil {
		if err := s.hl.CheckRootFolder(ctx, d.RootFolder); err != nil {
			return stalled(StalledRootFolder)
		}
	}
	dir := filepath.Join(d.RootFolder, folder)
	partial := filepath.Join(dir, fmt.Sprintf(".kestrel-%d.partial", g.ID))

	src, err := selectFiles(g.SourcePath)
	switch {
	case errors.Is(err, os.ErrNotExist):
		// The job is gone. If an earlier run already recorded the file, only
		// the rename may be left; otherwise the download folder is missing.
		if f, ok, ferr := s.lib.FileOfGrab(ctx, g.ID); ferr == nil && ok {
			return s.finish(g, f, partial, selection{}, primary, original)
		}
		return stalled("download folder not found")
	case err != nil:
		return stalledBy(err)
	}

	// An earlier run may have died after the row was written: finish it.
	if f, ok, ferr := s.lib.FileOfGrab(ctx, g.ID); ferr != nil {
		return stalledBy(ferr)
	} else if ok && (exists(partial) || exists(f.Path)) {
		return s.finish(g, f, partial, src, primary, original)
	}
	_ = os.Remove(partial) // a stale one from a run that died before the row

	if src.multiPart || parsed.Part > 0 {
		return rejected(ReasonInvalid)
	}
	if src.video == "" {
		return stalled(StalledNoVideo)
	}

	info, err := s.probe.Probe(ctx, src.video)
	if err != nil {
		if errors.Is(err, probe.ErrNotInstalled) {
			return stalled(StalledNoFFprobe)
		}
		if ctx.Err() != nil {
			return stalledBy(ctx.Err())
		}
		return rejected(ReasonInvalid)
	}
	if !info.HasVideo {
		return rejected(ReasonInvalid)
	}
	if !slices.Contains(profile.Classes(), info.Class()) {
		return rejected(ReasonResolution)
	}

	languages, inconclusive := probe.ResolveLanguages(parsedCodes(parsed, original), info.Audio)
	verdict := scoring.Evaluate(
		scoring.Release{Parsed: parsed, IndexerLanguages: languagesOf(languages, inconclusive), Size: info.Size, Filename: filepath.Base(src.video)},
		scoring.Title{Name: d.Title, Year: d.Year, OriginalLanguage: release.LanguageByISO(d.OriginalLanguage)}, profile,
	)
	if verdict.Rejected(scoring.RejectLanguage) {
		return rejected(ReasonLanguage)
	}
	var runtime time.Duration
	if d.Runtime > 0 {
		runtime = time.Duration(d.Runtime) * time.Minute
	}
	if !probe.DurationPlausible(info.Duration, runtime, probe.MovieFloor) {
		return rejected(ReasonInvalid)
	}
	// A misfit file is replaced by any fitting Release, whatever its Score.
	if ver.File != nil && !ver.File.Misfit && ver.File.Score != nil && verdict.Score <= *ver.File.Score {
		return rejected(ReasonNotUpgrade)
	}

	ext := strings.ToLower(filepath.Ext(src.video))
	fileName, err := MovieFileName(title, ver.Slot, FileFacts{Release: parsed, Probe: info, Languages: languages, Primary: primary}, ext)
	if err != nil {
		return stalledBy(err)
	}
	target := filepath.Join(dir, fileName)
	if exists(target) && (ver.File == nil || ver.File.Path != target) {
		return stalled(StalledPathOccupied)
	}

	res := Result{Status: Imported, Path: target, Score: verdict.Score, Inconclusive: inconclusive}
	if err := os.MkdirAll(dir, 0o777); err != nil {
		return stalledBy(err)
	}
	cross, err := place(s.link, src.video, partial)
	if err != nil {
		_ = os.Remove(partial)
		return stalledBy(err)
	}
	res.CrossDevice = cross
	s.noteCrossDevice(ctx, d.RootFolder, cross)
	if err := s.hook("partial"); err != nil {
		return stalledBy(err)
	}

	parsedJSON, _ := json.Marshal(parsed)
	probeJSON, _ := json.Marshal(info)
	if ver.File != nil && ver.File.Path != target {
		writeReplaces(partial, []string{ver.File.Path})
	}
	replaced, err := s.lib.ReplaceFile(ctx, g.TitleID, folder, library.NewFile{
		VersionID: g.VersionID, Path: target, Size: info.Size, ReleaseName: g.ReleaseName,
		ParsedRelease: string(parsedJSON), Probe: string(probeJSON), Score: verdict.Score, GrabID: g.ID,
	})
	if err != nil {
		_ = os.Remove(partial)
		_ = os.Remove(replacesMarker(partial))
		return stalledBy(err)
	}
	if err := s.hook("committed"); err != nil {
		return stalledBy(err)
	}
	if err := os.Rename(partial, target); err != nil {
		return stalledBy(err)
	}
	for _, old := range replaced {
		if old.Path != target {
			removeWithSidecars(old.Path)
		}
	}
	settleReplaces(partial, target)
	s.sidecars(src, target, primary, original)
	if g.CanRemove {
		_ = os.Remove(src.video)
	}
	return res
}

// replacesMarker is where an Import writes the paths it replaces before the
// database row swaps them, so a rerun after a crash can still delete them.
func replacesMarker(partial string) string { return partial + ".replaces" }

func writeReplaces(partial string, paths []string) {
	if len(paths) == 0 {
		return
	}
	b, _ := json.Marshal(paths)
	_ = os.WriteFile(replacesMarker(partial), b, 0o644)
}

// settleReplaces deletes the files the marker names, except keep, and the marker.
func settleReplaces(partial, keep string) {
	b, err := os.ReadFile(replacesMarker(partial))
	if err != nil {
		return
	}
	var paths []string
	if json.Unmarshal(b, &paths) == nil {
		for _, p := range paths {
			if p != keep {
				removeWithSidecars(p)
			}
		}
	}
	_ = os.Remove(replacesMarker(partial))
}

// noteCrossDevice raises the Warning that Imports into root are copied, not
// moved, and clears it on the next Import into root that was not.
func (s *Service) noteCrossDevice(ctx context.Context, root string, cross bool) {
	if s.hl == nil {
		return
	}
	key := "exdev:" + root
	if !cross {
		_ = s.hl.Clear(ctx, key)
		return
	}
	_ = s.hl.Raise(ctx, health.Issue{
		Key: key, Kind: health.KindEXDEV, Severity: health.Warning, Dismissible: true,
		Message: fmt.Sprintf("Imports into %s are copied, not moved: the download folder is on another filesystem. Put downloads and library under one mount to move or hardlink instead.", root),
	})
}

// finish completes an Import whose row an earlier run already wrote: the
// rename, the subtitles and the move's cleanup.
func (s *Service) finish(g Grab, f library.File, partial string, src selection, primary, original string) Result {
	if exists(partial) {
		if err := os.Rename(partial, f.Path); err != nil {
			return stalledBy(err)
		}
	}
	settleReplaces(partial, f.Path)
	s.sidecars(src, f.Path, primary, original)
	if g.CanRemove && src.video != "" {
		_ = os.Remove(src.video)
	}
	res := Result{Status: Imported, Path: f.Path}
	if f.Score != nil {
		res.Score = *f.Score
	}
	return res
}

func exists(path string) bool {
	_, err := os.Lstat(path)
	return err == nil
}

func parsedCodes(p release.ParsedRelease, original string) []string {
	var out []string
	for _, l := range p.Languages {
		switch {
		case l.ID == release.LangOriginal.ID:
			if original != "" {
				out = append(out, original)
			}
		default:
			if c := codeOfLanguage(l); c != "" {
				out = append(out, c)
			}
		}
	}
	return out
}

// languagesOf turns the languages the probe settled on into *arr languages for
// the re-score. An inconclusive probe leaves the parsed ones to stand.
func languagesOf(codes []string, inconclusive bool) []release.Language {
	if inconclusive {
		return nil
	}
	var out []release.Language
	for _, c := range codes {
		if l := release.LanguageByName(languageNames[c]); l.ID != release.LangUnknown.ID {
			out = append(out, l)
		}
	}
	return out
}

// codeOfLanguage is the canonical ISO 639-2/T code of an *arr language, or ""
// when it has none.
func codeOfLanguage(l release.Language) string {
	if l.ID == release.LangUnknown.ID {
		return ""
	}
	for code, name := range languageNames {
		if strings.EqualFold(name, l.Name) {
			return code
		}
	}
	return ""
}
