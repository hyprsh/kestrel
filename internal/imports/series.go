package imports

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/probe"
	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring"
)

// Reasons only a Series Import gives, for an episode it leaves alone.
const (
	// ReasonUnmonitored: the episode is not monitored, so a pack's file for it is skipped.
	ReasonUnmonitored = "unmonitored"
	// ReasonUnknownEpisode: the file's name names no episode the library knows.
	ReasonUnknownEpisode = "unknown_episode"
)

// EpisodeResult is what an Import did for one episode of a Series Grab. A pack
// has one per episode its files name; the Log records each.
type EpisodeResult struct {
	// EpisodeID is 0 when the file named no known episode.
	EpisodeID int64
	Season    int
	Number    int
	// Status is Imported, Rejected (the file is not wanted or not fit: Reason
	// says why) or Stalled.
	Status Status
	Reason string
	// File is the downloaded file's name.
	File string
	// Path and Score are those of the imported file.
	Path  string
	Score int
}

// partialPath is where a file is staged before its row is committed. It
// depends on the target only, so a rerun finds the staging file of a run that
// died, whatever else changed meanwhile.
func partialPath(grabID int64, target string) string {
	sum := sha1.Sum([]byte(target))
	return filepath.Join(filepath.Dir(target), fmt.Sprintf(".kestrel-%d-%s.partial", grabID, hex.EncodeToString(sum[:6])))
}

// importSeries imports the files of a Series Grab, a single episode or a pack.
// Each video is matched to the episode(s) its name gives, probed and scored
// like a Movie's file, and imported only for the monitored episodes that have
// no file yet or that it beats. The Result carries one entry per episode. It
// is Imported when anything was imported, Stalled when the environment stopped
// a file, else Rejected.
func (s *Service) importSeries(ctx context.Context, g Grab, d library.Detail, ver *library.Version, profile *scoring.Profile, parsed release.ParsedRelease, primary, original string) Result {
	region, _, err := s.prof.Region(ctx)
	if err != nil {
		return stalledBy(err)
	}
	eps, err := s.lib.Episodes(ctx, d.ID, library.View{Country: region.Country, Now: s.clock()})
	if err != nil {
		return stalledBy(err)
	}
	name := d.Title
	if name == "" {
		name = d.OriginalTitle
	}
	title := Title{Name: name, Year: d.Year, TVDBID: d.TVDBID, OriginalLanguage: original}
	folder := d.Folder
	if folder == "" {
		if folder, err = SeriesFolder(title); err != nil {
			return stalledBy(err)
		}
	}

	if s.hl != nil {
		if err := s.hl.CheckRootFolder(ctx, d.RootFolder); err != nil {
			return stalled(StalledRootFolder)
		}
	}

	// Files an earlier run committed: finish their rename.
	recorded, err := s.lib.FilesOfGrab(ctx, g.ID)
	if err != nil {
		return stalledBy(err)
	}
	done := map[string]library.File{}
	for _, f := range recorded {
		done[f.Path] = f
		p := partialPath(g.ID, f.Path)
		if exists(p) {
			if err := os.Rename(p, f.Path); err != nil {
				return stalledBy(err)
			}
		}
		settleReplaces(p, f.Path)
	}

	src, err := selectFiles(g.SourcePath)
	switch {
	case errors.Is(err, os.ErrNotExist) && len(recorded) > 0:
		return Result{Status: Imported, Path: recorded[0].Path}
	case errors.Is(err, os.ErrNotExist):
		return stalled("download folder not found")
	case err != nil:
		return stalledBy(err)
	}
	if len(src.videos) == 0 {
		return stalled(StalledNoVideo)
	}

	held, err := s.lib.PathsOfVersion(ctx, g.VersionID)
	if err != nil {
		return stalledBy(err)
	}
	byRef := map[[2]int]library.Episode{}
	for _, ep := range eps {
		byRef[[2]int{ep.Season, ep.Number}] = ep
	}

	in := seriesImport{
		s: s, g: g, d: d, ver: ver, profile: profile, parsed: parsed, primary: primary, original: original,
		title: title, folder: folder, root: filepath.Join(d.RootFolder, folder), byRef: byRef, eps: eps, held: held, done: done, src: src,
	}
	var out Result
	for _, video := range src.videos {
		in.file(ctx, video, &out)
	}
	return summarize(out)
}

// summarize turns the per-episode results into the Grab's: Imported if
// anything was, else Stalled if the environment stopped anything, else Rejected
// with the reason of the first file that was not simply unwanted.
func summarize(r Result) Result {
	var rejected, stalledEp *EpisodeResult
	for i := range r.Episodes {
		e := &r.Episodes[i]
		switch e.Status {
		case Imported:
			if r.Status != Imported {
				r.Status, r.Path = Imported, e.Path
			}
			r.Score = max(r.Score, e.Score)
		case Stalled:
			if stalledEp == nil {
				stalledEp = e
			}
		case Rejected:
			if rejected == nil || (rejected.Reason == ReasonNotUpgrade || rejected.Reason == ReasonUnmonitored) && e.Reason != ReasonNotUpgrade && e.Reason != ReasonUnmonitored {
				rejected = e
			}
		}
	}
	switch {
	case stalledEp != nil:
		r.Status, r.Reason = Stalled, stalledEp.Reason
	case r.Status == Imported:
	case rejected != nil:
		reason := rejected.Reason
		if reason == ReasonUnmonitored || reason == ReasonUnknownEpisode {
			reason = ReasonNotUpgrade
		}
		r.Status, r.Reason = Rejected, reason
	default:
		r.Status, r.Reason = Rejected, ReasonInvalid
	}
	return r
}

type seriesImport struct {
	s        *Service
	g        Grab
	d        library.Detail
	ver      *library.Version
	profile  *scoring.Profile
	parsed   release.ParsedRelease
	primary  string
	original string
	title    Title
	folder   string
	root     string
	byRef    map[[2]int]library.Episode
	eps      []library.Episode
	held     []string
	done     map[string]library.File
	src      selection
}

// refsOf is the season and episode numbers a downloaded file holds: what its
// own name says, else (for a lone video) what the Release's name said.
func (in *seriesImport) refsOf(video string) (season int, numbers []int, ok bool) {
	try := func(p release.ParsedRelease) bool {
		if p.Series == nil {
			return false
		}
		if p.IsDaily() {
			var match []library.Episode
			for _, ep := range in.eps {
				if ep.AirDate != nil && ep.AirDate.Format("2006-01-02") == p.Series.AirDate {
					match = append(match, ep)
				}
			}
			if len(match) != 1 {
				return false
			}
			season, numbers = match[0].Season, []int{match[0].Number}
			return true
		}
		if p.Series.FullSeason || len(p.Series.Episodes) == 0 {
			return false
		}
		season, numbers = p.Series.Season, slices.Clone(p.Series.Episodes)
		return true
	}
	stem := strings.TrimSuffix(filepath.Base(video), filepath.Ext(video))
	if fp, err := release.Parse(stem, release.KindSeries); err == nil && try(fp) {
		return season, numbers, true
	}
	if len(in.src.videos) == 1 && try(in.parsed) {
		return season, numbers, true
	}
	return 0, nil, false
}

// subsOf are the subtitles that belong to a video: named after it, or in a
// folder named after it, or any when it is the only video.
func (in *seriesImport) subsOf(video string) selection {
	stem := strings.ToLower(strings.TrimSuffix(filepath.Base(video), filepath.Ext(video)))
	var sel selection
	for _, sb := range in.src.subs {
		base := strings.ToLower(filepath.Base(sb.path))
		if len(in.src.videos) == 1 || strings.HasPrefix(base, stem) || strings.ToLower(filepath.Base(filepath.Dir(sb.path))) == stem {
			sel.subs = append(sel.subs, sb)
		}
	}
	return sel
}

// file imports one downloaded video and appends what it did to out.
func (in *seriesImport) file(ctx context.Context, video string, out *Result) {
	s := in.s
	fileName := filepath.Base(video)
	season, numbers, ok := in.refsOf(video)
	if !ok {
		out.Episodes = append(out.Episodes, EpisodeResult{Status: Rejected, Reason: ReasonUnknownEpisode, File: fileName})
		return
	}
	slices.Sort(numbers)
	var named []library.Episode
	for _, n := range numbers {
		if ep, ok := in.byRef[[2]int{season, n}]; ok {
			named = append(named, ep)
		} else {
			out.Episodes = append(out.Episodes, EpisodeResult{Season: season, Number: n, Status: Rejected, Reason: ReasonUnknownEpisode, File: fileName})
		}
	}
	if len(named) == 0 {
		return
	}
	add := func(ep library.Episode, st Status, reason, path string, score int) {
		out.Episodes = append(out.Episodes, EpisodeResult{
			EpisodeID: ep.ID, Season: ep.Season, Number: ep.Number, Status: st, Reason: reason, File: fileName, Path: path, Score: score,
		})
	}
	var wanted []library.Episode
	for _, ep := range named {
		if ep.Monitored {
			wanted = append(wanted, ep)
		} else {
			add(ep, Rejected, ReasonUnmonitored, "", 0)
		}
	}
	if len(wanted) == 0 {
		return
	}
	if in.parsed.Part > 0 {
		for _, ep := range wanted {
			add(ep, Rejected, ReasonInvalid, "", 0)
		}
		return
	}

	info, err := s.probe.Probe(ctx, video)
	if err != nil {
		if errors.Is(err, probe.ErrNotInstalled) {
			for _, ep := range wanted {
				add(ep, Stalled, StalledNoFFprobe, "", 0)
			}
			return
		}
		if ctx.Err() != nil {
			for _, ep := range wanted {
				add(ep, Stalled, stalledBy(ctx.Err()).Reason, "", 0)
			}
			return
		}
		for _, ep := range wanted {
			add(ep, Rejected, ReasonInvalid, "", 0)
		}
		return
	}
	reject := func(reason string) {
		for _, ep := range wanted {
			add(ep, Rejected, reason, "", 0)
		}
	}
	if !info.HasVideo {
		reject(ReasonInvalid)
		return
	}
	if !slices.Contains(in.profile.Classes(), info.Class()) {
		reject(ReasonResolution)
		return
	}

	languages, inconclusive := probe.ResolveLanguages(parsedCodes(in.parsed, in.original), info.Audio)
	fileParsed := in.parsed
	si := release.SeriesInfo{}
	if in.parsed.Series != nil {
		si = *in.parsed.Series
	}
	si.Season, si.Episodes, si.FullSeason, si.AirDate = season, numbers, false, ""
	fileParsed.Series = &si
	var epTitles []string
	for _, ep := range named {
		if ep.Name != "" {
			epTitles = append(epTitles, ep.Name)
		}
	}
	verdict := scoring.Evaluate(
		scoring.Release{Parsed: fileParsed, IndexerLanguages: languagesOf(languages, inconclusive), Size: info.Size, Filename: fileName},
		scoring.Title{Name: in.d.Title, Year: in.d.Year, OriginalLanguage: release.LanguageByISO(in.d.OriginalLanguage), EpisodeTitles: epTitles}, in.profile,
	)
	if verdict.Rejected(scoring.RejectLanguage) {
		reject(ReasonLanguage)
		return
	}
	var runtime time.Duration
	if in.d.Runtime > 0 {
		runtime = time.Duration(in.d.Runtime) * time.Minute
	}
	if !probe.DurationPlausible(info.Duration, runtime, probe.EpisodeFloor) {
		reject(ReasonInvalid)
		return
	}

	first, last := numbers[0], numbers[len(numbers)-1]
	ext := strings.ToLower(filepath.Ext(video))
	name, err := EpisodeFileName(in.title, in.ver.Slot, Episode{Season: season, First: first, Last: last},
		FileFacts{Release: fileParsed, Probe: info, Languages: languages, Primary: in.primary}, ext)
	if err != nil {
		for _, ep := range wanted {
			add(ep, Stalled, stalledBy(err).Reason, "", 0)
		}
		return
	}
	dir := filepath.Join(in.root, SeasonFolder(season))
	target := filepath.Join(dir, name)
	if f, ok := in.done[target]; ok {
		for _, ep := range wanted {
			add(ep, Imported, "", target, scoreOf(f))
		}
		return
	}
	// Only episodes with no file yet, or one this beats, take the file.
	var take []library.Episode
	for _, ep := range wanted {
		c := ep.Cells[in.ver.Slot]
		if c != nil && c.State == library.Filled && c.Score != nil && verdict.Score <= *c.Score {
			add(ep, Rejected, ReasonNotUpgrade, "", 0)
			continue
		}
		take = append(take, ep)
	}
	if len(take) == 0 {
		return
	}

	if exists(target) && !slices.Contains(in.held, target) {
		for _, ep := range take {
			add(ep, Stalled, StalledPathOccupied, "", 0)
		}
		return
	}

	stall := func(err error) {
		for _, ep := range take {
			add(ep, Stalled, stalledBy(err).Reason, "", 0)
		}
	}
	if err := os.MkdirAll(dir, 0o777); err != nil {
		stall(err)
		return
	}
	partial := partialPath(in.g.ID, target)
	_ = os.Remove(partial)
	cross, err := place(s.link, video, partial)
	if err != nil {
		_ = os.Remove(partial)
		stall(err)
		return
	}
	out.CrossDevice = out.CrossDevice || cross
	if err := s.hook("partial"); err != nil {
		stall(err)
		return
	}
	ids := make([]int64, len(take))
	for i, ep := range take {
		ids[i] = ep.ID
	}
	parsedJSON, _ := json.Marshal(fileParsed)
	probeJSON, _ := json.Marshal(info)
	// Name the files this one replaces before the row swaps them, so a crash after the commit still deletes them.
	going, err := s.lib.FilesReplacedBy(ctx, in.g.VersionID, ids)
	if err != nil {
		_ = os.Remove(partial)
		stall(err)
		return
	}
	var goingPaths []string
	for _, f := range going {
		if f.Path != target {
			goingPaths = append(goingPaths, f.Path)
		}
	}
	writeReplaces(partial, goingPaths)
	replaced, err := s.lib.ReplaceEpisodeFile(ctx, in.g.TitleID, in.folder, library.NewFile{
		VersionID: in.g.VersionID, Path: target, Size: info.Size, ReleaseName: in.g.ReleaseName,
		ParsedRelease: string(parsedJSON), Probe: string(probeJSON), Score: verdict.Score, GrabID: in.g.ID,
	}, ids)
	if err != nil {
		_ = os.Remove(partial)
		_ = os.Remove(replacesMarker(partial))
		stall(err)
		return
	}
	if err := s.hook("committed"); err != nil {
		stall(err)
		return
	}
	if err := os.Rename(partial, target); err != nil {
		stall(err)
		return
	}
	for _, old := range replaced {
		if old.Path != target {
			removeWithSidecars(old.Path)
		}
	}
	settleReplaces(partial, target)
	in.held = append(in.held, target)
	s.sidecars(in.subsOf(video), target, in.primary, in.original)
	if in.g.CanRemove {
		_ = os.Remove(video)
	}
	if inconclusive {
		out.Inconclusive = true
	}
	for _, ep := range take {
		add(ep, Imported, "", target, verdict.Score)
	}
}

func scoreOf(f library.File) int {
	if f.Score != nil {
		return *f.Score
	}
	return 0
}
