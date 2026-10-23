package imports

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/probe"
	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
	"github.com/hyprsh/kestrel/internal/slot"
)

var (
	// tvdbTagRx is a TheTVDB id tag: Plex {tvdb-N}, Jellyfin and the *arrs [tvdbid-N].
	tvdbTagRx = regexp.MustCompile(`(?i)(?:\{tvdb-(\d+)\}|\[tvdbid[-=](\d+)\])`)
	// trailingYearRx splits "Show Name (2008)" or "Show Name 2008".
	trailingYearRx = regexp.MustCompile(`^(.*\S)\s*\(?((?:19|20)\d{2})\)?$`)
)

func isNotFound(err error) bool {
	var me *metadata.Error
	return errors.As(err, &me) && me.Code == metadata.CodeNotFound
}

// epInfo is one episode TheTVDB lists for a Series.
type epInfo struct {
	season, number int
	air            string // yyyy-mm-dd, "" when TheTVDB has none
	name           string
	// cells are the Series' Versions' cells of a tracked Series; nil elsewhere.
	cells [slot.Count]*library.EpisodeCell
}

// seriesFacts is what planning needs to know of a Series, from the Library
// when it is tracked and from TMDB and TheTVDB when it is not.
type seriesFacts struct {
	TMDBID, TVDBID int
	TitleID        int64
	Title          string
	OriginalTitle  string
	Year           int
	Runtime        int
	OriginalISO    string
	Rel            metadata.ReleaseDates
	Folder         string
	RootFolder     string
	// Detail is the tracked Title; nil when adopting adds it.
	Detail *library.Detail
	// NotOnTVDB says TheTVDB does not know the Series.
	NotOnTVDB bool
	eps       map[library.EpisodeRef]epInfo
}

func (f seriesFacts) name() string {
	if f.Title != "" {
		return f.Title
	}
	return f.OriginalTitle
}

func (f seriesFacts) originalCode() string {
	return codeOfLanguage(release.LanguageByISO(f.OriginalISO))
}

func (f seriesFacts) runtime() time.Duration { return time.Duration(f.Runtime) * time.Minute }

func (a *Adoption) seriesFacts(ctx context.Context, e *env, tmdbID int) (seriesFacts, error) {
	if t, ok := e.seriesByTMDB[tmdbID]; ok {
		view := library.View{Country: e.region.Country, Now: a.d.Clock()}
		d, err := a.d.Library.Get(ctx, t.TitleID, view)
		if err != nil {
			return seriesFacts{}, err
		}
		eps, err := a.d.Library.Episodes(ctx, t.TitleID, view)
		if err != nil {
			return seriesFacts{}, err
		}
		f := seriesFacts{
			TMDBID: tmdbID, TVDBID: d.TVDBID, TitleID: d.ID, Title: d.Title, OriginalTitle: d.OriginalTitle, Year: d.Year, Runtime: d.Runtime,
			OriginalISO: d.OriginalLanguage, Rel: d.ReleaseDates, Folder: d.Folder, RootFolder: d.RootFolder, Detail: &d,
			eps: map[library.EpisodeRef]epInfo{},
		}
		for _, ep := range eps {
			air := ""
			if ep.AirDate != nil {
				air = ep.AirDate.Format("2006-01-02")
			}
			f.eps[library.EpisodeRef{Season: ep.Season, Number: ep.Number}] = epInfo{season: ep.Season, number: ep.Number, air: air, name: ep.Name, cells: ep.Cells}
		}
		return f, nil
	}
	d, err := a.d.Meta.Series(ctx, tmdbID)
	if err != nil {
		return seriesFacts{}, err
	}
	f := seriesFacts{
		TMDBID: tmdbID, Title: d.Title, OriginalTitle: d.OriginalTitle, Year: d.Year, Runtime: d.Runtime,
		OriginalISO: d.OriginalLanguage, Rel: d.Ratings, eps: map[library.EpisodeRef]epInfo{},
	}
	f.TVDBID, err = metadata.TVDBIDOf(ctx, a.d.TVDB, d.TVDBID, d.IMDbID)
	if err != nil {
		return seriesFacts{}, err
	}
	if f.TVDBID == 0 {
		f.NotOnTVDB = true
		return f, nil
	}
	tv, err := a.d.TVDB.Series(ctx, f.TVDBID)
	if err != nil {
		if isNotFound(err) {
			f.NotOnTVDB = true
			return f, nil
		}
		return seriesFacts{}, err
	}
	for _, ep := range tv.Episodes {
		air := ""
		if ep.Aired != nil {
			air = ep.Aired.Format("2006-01-02")
		}
		f.eps[library.EpisodeRef{Season: ep.Season, Number: ep.Number}] = epInfo{season: ep.Season, number: ep.Number, air: air, name: ep.Name}
	}
	return f, nil
}

// refsOf are the episodes TheTVDB lists that a parsed file name names: by
// season and number, or by air date for a daily show. Absolute numbering and
// whole-season names name none.
func (f seriesFacts) refsOf(p release.ParsedRelease) []library.EpisodeRef {
	si := p.Series
	if si == nil {
		return nil
	}
	var refs []library.EpisodeRef
	switch {
	case si.AirDate != "":
		for ref, ep := range f.eps {
			if ep.air == si.AirDate {
				refs = append(refs, ref)
			}
		}
		if len(refs) != 1 {
			return nil
		}
	case si.FullSeason, len(si.Episodes) == 0:
		return nil
	default:
		for _, n := range si.Episodes {
			ref := library.EpisodeRef{Season: si.Season, Number: n}
			if _, ok := f.eps[ref]; ok {
				refs = append(refs, ref)
			}
		}
	}
	slices.SortFunc(refs, func(x, y library.EpisodeRef) int { return x.Number - y.Number })
	return refs
}

// planSeries plans one entry of a Series Root folder; see planEntry.
func (a *Adoption) planSeries(ctx context.Context, e *env, en entry, force int) (*Row, error) {
	row := &Row{Kind: library.Series, Entry: en.Path, EntryRoot: en.Root, Root: en.Root, Ticked: true}
	skip := func(reason string) (*Row, error) {
		row.Status, row.SkipReason, row.Ticked = Skipped, reason, false
		return row, nil
	}
	tracked, isTracked := e.folders[en.Path]
	isTracked = isTracked && tracked.Kind == library.Series

	videos, anyHeld, err := findVideos(en, e.held)
	if err != nil {
		return nil, err
	}
	if len(videos) == 0 {
		if isTracked || anyHeld {
			return nil, nil
		}
		return skip(SkipNoVideo)
	}
	slices.Sort(videos)
	files, err := a.probeAll(ctx, videos)
	if err != nil {
		return nil, err
	}
	if len(files) == 0 {
		return skip(SkipInvalid)
	}

	var tmdbID int
	var source string
	switch {
	case force != 0:
		tmdbID, source = force, SourceChosen
	case isTracked:
		tmdbID, source = tracked.TMDBID, SourceTag
	default:
		if tmdbID, err = a.byTagSeries(ctx, en); err != nil {
			return nil, err
		}
		source = SourceTag
	}
	if tmdbID == 0 {
		cands, confident, err := a.byNameSeries(ctx, en, files)
		if err != nil {
			return nil, err
		}
		if confident == 0 {
			row.Status, row.Ticked, row.Candidates = NeedsChoice, false, cands
			return row, nil
		}
		tmdbID, source = confident, SourceName
	}

	facts, err := a.seriesFacts(ctx, e, tmdbID)
	if err != nil {
		if force != 0 && isNotFound(err) {
			return nil, ErrNotSettleable
		}
		return nil, err
	}
	if facts.NotOnTVDB {
		return skip(SkipNotOnTVDB)
	}
	title := Title{Name: facts.name(), Year: facts.Year, TVDBID: facts.TVDBID, OriginalLanguage: facts.originalCode()}
	folder := facts.Folder
	if folder == "" {
		if folder, err = SeriesFolder(title); err != nil {
			return skip(SkipInvalid)
		}
	}
	row.Match = &Match{TMDBID: tmdbID, TVDBID: facts.TVDBID, Title: facts.name(), Year: facts.Year, TitleID: facts.TitleID, Source: source, Folder: folder}
	if facts.RootFolder != "" {
		row.Root = facts.RootFolder
	}

	if force == 0 {
		for _, f := range files {
			if !probe.DurationPlausible(f.info.Duration, facts.runtime(), probe.EpisodeFloor) {
				row.Status, row.Ticked, row.Match = NeedsChoice, false, nil
				row.Candidates = []Candidate{{TMDBID: tmdbID, Title: facts.name(), Year: facts.Year, Suggested: true, Confident: true}}
				return row, nil
			}
		}
	}

	row.Status = Matched
	dir := filepath.Join(row.Root, folder)
	for _, f := range files {
		pf, reason, err := a.planSeriesFile(e, facts, title, en, f, dir)
		if err != nil {
			return nil, err
		}
		if reason != "" {
			return skip(reason)
		}
		row.Files = append(row.Files, pf)
	}
	return row, nil
}

func notFoundAsZero(id int, ok bool, err error) (int, error) {
	if err != nil {
		if isNotFound(err) {
			return 0, nil
		}
		return 0, err
	}
	if !ok {
		return 0, nil
	}
	return id, nil
}

// byTagSeries reads an ID tag off the entry's name and returns the TMDB id of
// the Series it names, or 0 when there is no tag or the providers do not know it.
func (a *Adoption) byTagSeries(ctx context.Context, en entry) (int, error) {
	if m := tvdbTagRx.FindStringSubmatch(en.Name); m != nil {
		if n, _ := strconv.Atoi(m[1] + m[2]); n > 0 {
			if id, err := notFoundAsZero(a.d.Meta.FindSeriesByTVDB(ctx, n)); err != nil || id != 0 {
				return id, err
			}
		}
	}
	if m := tmdbTagRx.FindStringSubmatch(en.Name); m != nil {
		if n, _ := strconv.Atoi(m[1] + m[2]); n > 0 {
			return n, nil
		}
	}
	if m := imdbTagRx.FindStringSubmatch(en.Name); m != nil {
		return notFoundAsZero(a.d.Meta.FindSeriesByIMDb(ctx, m[1]+m[2]))
	}
	return 0, nil
}

// seriesNameOf is the title and year an entry's name gives: a folder named
// "Title (Year)" or a release-style name, else the name of its first video.
func seriesNameOf(en entry, files []probed) (title string, year int) {
	if en.IsDir {
		if p, err := release.ParseFolder(en.Name, release.KindSeries); err == nil && p.Series != nil && p.Series.TitleWithoutYear != "" {
			return p.Series.TitleWithoutYear, p.Year
		}
		plain := plainTitle(en.Name)
		if m := trailingYearRx.FindStringSubmatch(plain); m != nil {
			y, _ := strconv.Atoi(m[2])
			return m[1], y
		}
		if plain != "" && !seasonFolderRx.MatchString(plain) {
			return plain, 0
		}
	}
	base := strings.TrimSuffix(filepath.Base(files[0].path), filepath.Ext(files[0].path))
	if p, err := release.Parse(base, release.KindSeries); err == nil && p.Series != nil && p.Series.TitleWithoutYear != "" {
		return p.Series.TitleWithoutYear, p.Year
	}
	return plainTitle(en.Name), 0
}

var seasonFolderRx = regexp.MustCompile(`(?i)^(season|series|s)\s*\d+$|^specials$`)

// byNameSeries searches TMDB for the entry's name. A result is confident when
// it is the only Series whose normalised title is the parsed one and whose
// first air year is within one of the parsed year.
func (a *Adoption) byNameSeries(ctx context.Context, en entry, files []probed) ([]Candidate, int, error) {
	title, year := seriesNameOf(en, files)
	if title == "" {
		return nil, 0, nil
	}
	found, err := a.d.Meta.Search(ctx, title)
	if err != nil {
		return nil, 0, err
	}
	want := normalise(title)
	var series, exact []metadata.SearchResult
	for _, r := range found {
		if r.Kind != metadata.Series {
			continue
		}
		series = append(series, r)
		if (normalise(r.Title) == want || normalise(r.OriginalTitle) == want) && year != 0 && r.Year != 0 && r.Year >= year-1 && r.Year <= year+1 {
			exact = append(exact, r)
		}
	}
	if len(exact) == 1 {
		return nil, exact[0].TMDBID, nil
	}
	if len(series) == 0 {
		return nil, 0, nil
	}
	return suggest(rankResults([]string{title}, year, series), nil), 0, nil
}

// slotFor is a file's Slot: Kestrel's own label wins, else a file probed at
// 2160p is 4K and anything else Standard.
func slotFor(base string, info probe.Info) Slot {
	if lm := slotLabelRx.FindStringSubmatch(base); lm != nil {
		if s, ok := slot.Parse(strings.ToLower(lm[1])); ok {
			return s
		}
	}
	return slot.OfClass(info.Class())
}

// planSeriesFile plans one probed video of a matched Series entry. reason is a
// skip reason for the whole entry.
func (a *Adoption) planSeriesFile(e *env, m seriesFacts, title Title, en entry, f probed, dir string) (PlanFile, string, error) {
	base := strings.TrimSuffix(filepath.Base(f.path), filepath.Ext(f.path))
	slot := slotFor(base, f.info)

	rel, _ := filepath.Rel(en.Root, f.path)
	rel = filepath.ToSlash(rel)
	parsed, perr := release.ParsePath(rel, release.KindSeries)
	if perr != nil {
		if parsed, perr = release.Parse(base, release.KindSeries); perr != nil {
			parsed = release.ParsedRelease{Kind: release.KindSeries}
		}
	}
	refs := m.refsOf(parsed)
	if len(refs) == 0 {
		return PlanFile{Path: f.path, To: f.path, Size: f.info.Size, Slot: slot, Action: ActionCreate, Left: LeftUnmatched, ReleaseName: base}, "", nil
	}
	parsed = withProbedResolution(parsed, f.info, strings.TrimSuffix(rel, filepath.Ext(rel)))

	// The Profile is the Version's own, else Profile resolution picks one.
	var ver *library.Version
	if m.Detail != nil {
		for i := range m.Detail.Versions {
			if m.Detail.Versions[i].Slot == slot {
				ver = &m.Detail.Versions[i]
			}
		}
	}
	profileKey := ""
	if ver != nil {
		profileKey = ver.Profile
	} else {
		r, err := profiles.ResolveAccepting(e.profiles, release.KindSeries, slot, a.accepts(e, f.info.Class()))
		if err != nil {
			return PlanFile{}, SkipNoEnabledProfile, nil
		}
		profileKey = r.Key
	}
	var spec *profiles.Profile
	for i := range e.profiles {
		if e.profiles[i].Key == profileKey {
			spec = &e.profiles[i]
		}
	}
	if spec == nil {
		return PlanFile{}, SkipNoEnabledProfile, nil
	}
	profile, err := a.snap.Current().Profile(spec.Spec(e.region.Primary.Release()))
	if err != nil {
		return PlanFile{}, "", err
	}

	original := title.OriginalLanguage
	primary := codeOfLanguage(e.region.Primary.Release())
	languages, inconclusive := probe.ResolveLanguages(parsedCodes(parsed, original), f.info.Audio)
	si := release.SeriesInfo{}
	if parsed.Series != nil {
		si = *parsed.Series
	}
	si.Season, si.FullSeason = refs[0].Season, false
	si.Episodes = si.Episodes[:0:0]
	var epTitles []string
	for _, r := range refs {
		si.Episodes = append(si.Episodes, r.Number)
		if n := m.eps[r].name; n != "" {
			epTitles = append(epTitles, n)
		}
	}
	parsed.Series = &si
	verdict := scoring.Evaluate(
		scoring.Release{Parsed: parsed, IndexerLanguages: languagesOf(languages, inconclusive), Size: f.info.Size, Filename: filepath.Base(f.path)},
		scoring.Title{Name: m.name(), Year: m.Year, OriginalLanguage: release.LanguageByISO(m.OriginalISO), EpisodeTitles: epTitles}, profile,
	)

	ext := strings.ToLower(filepath.Ext(f.path))
	season, first, last := refs[0].Season, refs[0].Number, refs[len(refs)-1].Number
	name, err := EpisodeFileName(title, slot, Episode{Season: season, First: first, Last: last},
		FileFacts{Release: parsed, Probe: f.info, Languages: languages, Primary: primary}, ext)
	if err != nil {
		return PlanFile{}, SkipInvalid, nil
	}
	to := filepath.Join(dir, SeasonFolder(season), name)
	parsedJSON, _ := json.Marshal(parsed)
	probeJSON, _ := json.Marshal(f.info)
	misfit, _ := fitOf(profile, f.info, verdict, false)
	pf := PlanFile{
		Path: f.path, To: to, Size: f.info.Size, Slot: slot, Profile: profileKey, Score: verdict.Score, Action: ActionCreate, Ticked: true,
		Misfit: misfit, ReleaseName: base, Parsed: parsedJSON, Probe: probeJSON, Episodes: refs,
	}
	if ver != nil {
		pf.Action = ActionFill
		for _, r := range refs {
			if c := m.eps[r].cells[slot]; c != nil && c.Score != nil {
				pf.Action, pf.Ticked = ActionReplace, false
				if pf.HeldScore == nil || *c.Score > *pf.HeldScore {
					held := *c.Score
					pf.HeldScore = &held
				}
			}
		}
	}
	if exists(to) && to != f.path {
		pf.Left = LeftPathOccupied
	}
	pf.Subtitles = planSubtitles(f.path, strings.TrimSuffix(to, filepath.Ext(to)))
	return pf, "", nil
}

// rehomeSeries points a file's new path into dir, for a Title whose folder is
// not the one the scan planned.
func rehomeSeries(f PlanFile, dir string) PlanFile {
	season := 0
	if len(f.Episodes) > 0 {
		season = f.Episodes[0].Season
	}
	target := filepath.Join(dir, SeasonFolder(season))
	if filepath.Dir(f.To) == target {
		return f
	}
	f.To = filepath.Join(target, filepath.Base(f.To))
	subs := make([]PlanSub, len(f.Subtitles))
	for i, s := range f.Subtitles {
		subs[i] = PlanSub{From: s.From, To: filepath.Join(target, filepath.Base(s.To))}
	}
	f.Subtitles = subs
	return f
}

// adoptSeriesRow renames a Series row's ticked files into the scheme and
// writes the Title's Versions and episode files in one transaction. If the
// transaction fails, every rename is undone.
func (a *Adoption) adoptSeriesRow(ctx context.Context, e *env, row Row) (err error) {
	m := row.Match
	titleID, tracked, err := a.d.Library.Find(ctx, library.Series, m.TMDBID, 0)
	if err != nil {
		return err
	}
	dir := filepath.Join(row.Root, m.Folder)
	root := row.Root
	var folder string
	if tracked {
		d, err := a.d.Library.Get(ctx, titleID, library.View{Country: e.region.Country, Now: a.d.Clock()})
		if err != nil {
			return err
		}
		root, folder = d.RootFolder, d.Folder
		if d.Folder != "" {
			dir = filepath.Join(d.RootFolder, d.Folder)
		}
	}
	if folder == "" {
		folder = m.Folder
	}

	var done []move
	defer func() {
		if err != nil {
			for i := len(done) - 1; i >= 0; i-- {
				_ = os.Rename(done[i].to, done[i].from)
			}
		}
	}()

	var versions []library.AdoptSeriesVersion
	var moved []PlanFile
	for _, f := range row.Files {
		if !f.adopts() {
			continue
		}
		f = rehomeSeries(f, dir)
		if _, serr := os.Lstat(f.Path); serr != nil {
			continue // the file is gone since the scan
		}
		if f.Path != f.To {
			if exists(f.To) {
				continue // something took the name since the scan
			}
			if err = os.MkdirAll(filepath.Dir(f.To), 0o777); err != nil {
				return err
			}
			if err = os.Rename(f.Path, f.To); err != nil {
				return err
			}
			done = append(done, move{f.Path, f.To})
		}
		for _, s := range f.Subtitles {
			if s.From == s.To || exists(s.To) {
				continue
			}
			if _, serr := os.Lstat(s.From); serr != nil {
				continue
			}
			if err = os.Rename(s.From, s.To); err != nil {
				return err
			}
			done = append(done, move{s.From, s.To})
		}
		moved = append(moved, f)
		at := slices.IndexFunc(versions, func(v library.AdoptSeriesVersion) bool { return v.Slot == f.Slot })
		if at < 0 {
			versions = append(versions, library.AdoptSeriesVersion{Slot: f.Slot, Profile: f.Profile})
			at = len(versions) - 1
		}
		versions[at].Files = append(versions[at].Files, library.AdoptSeriesFile{
			Replace:  f.Action == ActionReplace,
			Episodes: f.Episodes,
			File: library.NewFile{
				Path: f.To, Size: f.Size, ReleaseName: f.ReleaseName, ParsedRelease: string(f.Parsed), Probe: string(f.Probe), Score: f.Score, Misfit: f.Misfit,
			},
		})
	}
	if len(versions) == 0 {
		return errors.New("none of the files could be adopted")
	}

	adopt := library.AdoptSeries{TitleID: titleID, PrimaryLanguage: string(e.region.Primary), RootFolder: root, Folder: folder, Versions: versions, Monitor: row.Monitor}
	if !tracked {
		if adopt.TMDB, err = a.d.Meta.Series(ctx, m.TMDBID); err != nil {
			return err
		}
		if adopt.TVDB, err = metadata.SeriesIn(ctx, a.d.TVDB, m.TVDBID, adopt.PrimaryLanguage); err != nil {
			return err
		}
	}
	id, replaced, err := a.d.Library.AdoptSeries(ctx, adopt)
	if err != nil {
		return err
	}
	a.rescored(ctx, id)
	for _, old := range replaced {
		keep := false
		for _, f := range moved {
			keep = keep || f.To == old.Path
		}
		if !keep {
			removeWithSidecars(old.Path)
		}
	}
	counts := map[Slot]int{}
	for _, f := range moved {
		counts[f.Slot] += len(f.Episodes)
	}
	var parts []string
	for _, v := range versions {
		parts = append(parts, fmt.Sprintf("%s: %d episodes", v.Slot, counts[v.Slot]))
	}
	a.d.History.Record(ctx, history.Event{
		Kind: history.AdoptionDone, TitleID: id,
		Message: fmt.Sprintf("Adopted %s (%d) — %s", m.Title, m.Year, strings.Join(parts, ", ")),
	})
	a.folderChanged(ctx, dir)
	return nil
}
