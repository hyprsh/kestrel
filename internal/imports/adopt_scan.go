package imports

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/imports/db"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/probe"
	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/resolution"
	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
)

// maxCandidates is how many Movies a Needs choice row offers.
const maxCandidates = 8

var (
	// ID tags in folder and file names: Plex {tmdb-N}, {imdb-tt..}; Jellyfin
	// and the *arrs [tmdbid-N], [imdbid-tt..]. A tag is taken as certain.
	tmdbTagRx = regexp.MustCompile(`(?i)(?:\{tmdb-(\d+)\}|\[tmdbid[-=](\d+)\])`)
	imdbTagRx = regexp.MustCompile(`(?i)(?:\{imdb-(tt\d+)\}|\[imdbid[-=](tt\d+)\])`)
	// slotLabelRx is Kestrel's own `- [Standard]` or `- [4K]` label, which wins
	// over the probe. The old SD, HD and UHD labels are not recognised.
	slotLabelRx = regexp.MustCompile(`(?i) - \[(Standard|4K)\]`)
)

// subtitleExts are every sidecar subtitle format that moves with its video.
var subtitleExts = map[string]bool{
	".srt": true, ".ass": true, ".ssa": true, ".vtt": true, ".smi": true, ".sub": true, ".idx": true, ".sup": true,
}

// entry is one top-level item of a Root folder: a Title candidate.
type entry struct {
	Kind  library.Kind
	Root  string
	Path  string
	Name  string // the folder name, or the file name without extension
	IsDir bool
}

// env is what planning reads once per scan or edit.
type env struct {
	profiles []profiles.Profile
	region   profiles.Region
	held     map[string]bool
	// folders maps a tracked Title's folder path to it.
	folders map[string]library.Tracked
	byTMDB  map[int]library.Tracked
	// seriesByTMDB are the tracked Series.
	seriesByTMDB map[int]library.Tracked
}

func (a *Adoption) env(ctx context.Context) (*env, error) {
	e := &env{folders: map[string]library.Tracked{}, byTMDB: map[int]library.Tracked{}, seriesByTMDB: map[int]library.Tracked{}}
	var err error
	if e.profiles, err = a.d.Profiles.List(ctx); err != nil {
		return nil, err
	}
	if e.region, _, err = a.d.Profiles.Region(ctx); err != nil {
		return nil, err
	}
	if e.held, err = a.d.Library.HeldPaths(ctx); err != nil {
		return nil, err
	}
	tracked, err := a.d.Library.Tracked(ctx)
	if err != nil {
		return nil, err
	}
	for _, t := range tracked {
		if t.Kind == library.Series {
			e.seriesByTMDB[t.TMDBID] = t
		} else {
			e.byTMDB[t.TMDBID] = t
		}
		if t.Folder != "" {
			e.folders[filepath.Join(t.RootFolder, t.Folder)] = t
		}
	}
	return e, nil
}

// Scan starts the background scan of the Root folders (all of them when
// roots is empty) and replaces the stored plan.
func (a *Adoption) Scan(ctx context.Context, roots []string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	configured, _, err := a.d.Roots.Get(ctx)
	if err != nil {
		return err
	}
	scan := scanRoots{movies: configured.Movies, series: configured.Series}
	if len(roots) > 0 {
		scan = scanRoots{}
		for _, r := range roots {
			r = filepath.Clean(r)
			switch {
			case slices.Contains(configured.Movies, r):
				scan.movies = append(scan.movies, r)
			case slices.Contains(configured.Series, r):
				scan.series = append(scan.series, r)
			default:
				return fmt.Errorf("%w: %s", ErrNoRoot, r)
			}
		}
	}
	p, err := a.q.GetAdoptionPlan(ctx)
	if err != nil {
		return err
	}
	if s := PlanState(p.State); s == PlanScanning || s == PlanCommitting {
		return ErrBusy
	}
	if err := a.q.DeleteAdoptionRows(ctx); err != nil {
		return err
	}
	if err := a.q.StartAdoptionScan(ctx); err != nil {
		return err
	}
	if err := a.q.SetAdoptionMonitor(ctx, string(library.MonitorAll)); err != nil {
		return err
	}
	a.wg.Add(1)
	go func() {
		defer a.wg.Done()
		a.runScan(context.WithoutCancel(ctx), scan)
	}()
	return nil
}

// scanRoots are the Root folders a scan covers; the folder a file sits in
// decides its kind.
type scanRoots struct{ movies, series []string }

func (a *Adoption) runScan(ctx context.Context, roots scanRoots) {
	rows, err := a.scan(ctx, roots)
	a.mu.Lock()
	defer a.mu.Unlock()
	if err != nil {
		a.d.Logger.Error("adoption scan failed", "err", err)
		_ = a.q.DeleteAdoptionRows(ctx)
		_ = a.q.FailAdoptionScan(ctx, sql.NullString{String: errorText(err), Valid: true})
		return
	}
	if err := a.save(ctx, rows); err != nil {
		a.d.Logger.Error("adoption: storing the plan failed", "err", err)
		_ = a.q.FailAdoptionScan(ctx, sql.NullString{String: errorText(err), Valid: true})
		return
	}
	_ = a.q.FinishAdoptionScan(ctx, sql.NullString{String: a.d.Clock().UTC().Format("2006-01-02T15:04:05Z07:00"), Valid: true})
	s := summarizeRows(rows)
	a.d.History.Record(ctx, history.Event{
		Kind: history.AdoptionScanned, Message: fmt.Sprintf("Adoption scan: %d matched, %d need a choice, %d skipped", s.Matched, s.NeedsChoice, s.Skipped),
	})
}

func errorText(err error) string {
	var me *metadata.Error
	switch {
	case errors.As(err, &me) && me.Code == metadata.CodeAuth:
		return "The metadata provider refused or lacks an API key; set one in Settings or KESTREL_TMDB_API_KEY"
	case errors.Is(err, probe.ErrNotInstalled):
		return "ffprobe is not installed, so files cannot be checked"
	}
	return err.Error()
}

func (a *Adoption) save(ctx context.Context, rows []Row) error {
	tx, err := a.d.Store.Write().BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	q := db.New(tx)
	if err := q.DeleteAdoptionRows(ctx); err != nil {
		return err
	}
	for _, r := range rows {
		data, err := json.Marshal(r)
		if err != nil {
			return err
		}
		if _, err := q.InsertAdoptionRow(ctx, db.InsertAdoptionRowParams{Status: string(r.Status), Ticked: b2i(r.Ticked), Data: string(data)}); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// entries lists the Title candidates of the Root folders.
func entries(roots scanRoots) ([]entry, error) {
	var out []entry
	for _, kr := range []struct {
		kind  library.Kind
		roots []string
	}{{library.Movie, roots.movies}, {library.Series, roots.series}} {
		kind := kr.kind
		for _, root := range kr.roots {
			list, err := os.ReadDir(root)
			if err != nil {
				return nil, fmt.Errorf("read the Root folder %s: %w", root, err)
			}
			for _, d := range list {
				name := d.Name()
				if strings.HasPrefix(name, ".") || strings.HasPrefix(name, "@") || strings.HasPrefix(name, "#") || name == "lost+found" {
					continue
				}
				p := filepath.Join(root, name)
				switch {
				case d.IsDir():
					out = append(out, entry{Kind: kind, Root: root, Path: p, Name: name, IsDir: true})
				case videoExts[strings.ToLower(filepath.Ext(name))]:
					out = append(out, entry{Kind: kind, Root: root, Path: p, Name: strings.TrimSuffix(name, filepath.Ext(name))})
				}
			}
		}
	}
	return out, nil
}

func (a *Adoption) scan(ctx context.Context, roots scanRoots) ([]Row, error) {
	list, err := entries(roots)
	if err != nil {
		return nil, err
	}
	e, err := a.env(ctx)
	if err != nil {
		return nil, err
	}
	_ = a.q.SetAdoptionProgress(ctx, db.SetAdoptionProgressParams{Done: 0, Total: int64(len(list))})
	var rows []Row
	for i, en := range list {
		row, err := a.planEntry(ctx, e, en, 0)
		if err != nil {
			return nil, err
		}
		if row != nil {
			rows = append(rows, *row)
		}
		_ = a.q.SetAdoptionProgress(ctx, db.SetAdoptionProgressParams{Done: int64(i + 1), Total: int64(len(list))})
	}
	settle(rows)
	return rows, nil
}

// findVideos lists the entry's videos that no Version holds, skipping
// samples, extras and Kestrel's partial files. anyHeld says some Version holds
// a file under the entry.
func findVideos(en entry, held map[string]bool) (videos []string, anyHeld bool, err error) {
	if !en.IsDir {
		if held[en.Path] {
			return nil, true, nil
		}
		return []string{en.Path}, false, nil
	}
	err = filepath.WalkDir(en.Path, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if p != en.Path && (sampleRx.MatchString(d.Name()) || extraDirs[strings.ToLower(d.Name())] || strings.HasPrefix(d.Name(), ".")) {
				return filepath.SkipDir
			}
			return nil
		}
		ext := strings.ToLower(filepath.Ext(p))
		base := strings.TrimSuffix(d.Name(), filepath.Ext(p))
		if !videoExts[ext] || strings.HasPrefix(d.Name(), ".") || sampleRx.MatchString(base) || extraRx.MatchString(base) {
			return nil
		}
		if held[p] {
			anyHeld = true
			return nil
		}
		videos = append(videos, p)
		return nil
	})
	return videos, anyHeld, err
}

type probed struct {
	path string
	info probe.Info
}

// probeAll probes the videos; one that is unreadable or has no video stream
// is left out. An error is the environment's.
func (a *Adoption) probeAll(ctx context.Context, videos []string) ([]probed, error) {
	var files []probed
	for _, v := range videos {
		info, err := a.d.Prober.Probe(ctx, v)
		switch {
		case errors.Is(err, probe.ErrNotInstalled):
			return nil, err
		case ctx.Err() != nil:
			return nil, ctx.Err()
		case err != nil || !info.HasVideo:
			continue
		}
		if info.Size == 0 {
			if st, err := os.Stat(v); err == nil {
				info.Size = st.Size()
			}
		}
		files = append(files, probed{v, info})
	}
	return files, nil
}

// planEntry plans one entry. force, when set, is the TMDB id the admin chose.
// It returns nil when there is nothing to adopt and nothing to say about the
// entry (a tracked folder with no new files). An error is the environment's
// (the metadata provider, a missing ffprobe) and stops the scan.
func (a *Adoption) planEntry(ctx context.Context, e *env, en entry, force int) (*Row, error) {
	if en.Kind == library.Series {
		return a.planSeries(ctx, e, en, force)
	}
	return a.planMovie(ctx, e, en, force)
}

func (a *Adoption) planMovie(ctx context.Context, e *env, en entry, force int) (*Row, error) {
	row := &Row{Kind: library.Movie, Entry: en.Path, EntryRoot: en.Root, Root: en.Root, Ticked: true}
	skip := func(reason string) (*Row, error) {
		row.Status, row.SkipReason, row.Ticked = Skipped, reason, false
		return row, nil
	}
	tracked, isTracked := e.folders[en.Path]

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
	if multiPart(videos) {
		return skip(SkipInvalid)
	}
	files, err := a.probeAll(ctx, videos)
	if err != nil {
		return nil, err
	}
	if len(files) == 0 {
		return skip(SkipInvalid)
	}

	// Which Movie is it?
	var tmdbID int
	var source string
	switch {
	case force != 0:
		tmdbID, source = force, SourceChosen
	case isTracked:
		tmdbID, source = tracked.TMDBID, SourceTag
	default:
		id, src, err := a.byTag(ctx, en)
		if err != nil {
			return nil, err
		}
		tmdbID, source = id, src
	}
	if tmdbID == 0 {
		var cands []Candidate
		var confident int
		cands, confident, err = a.byName(ctx, en, files)
		if err != nil {
			return nil, err
		}
		if confident != 0 {
			tmdbID, source = confident, SourceName
		} else {
			row.Status, row.Ticked, row.Candidates = NeedsChoice, false, cands
			return row, nil
		}
	}

	facts, err := a.facts(ctx, e, tmdbID)
	if err != nil {
		var me *metadata.Error
		if force != 0 && errors.As(err, &me) && me.Code == metadata.CodeNotFound {
			return nil, ErrNotSettleable
		}
		return nil, err
	}
	title := Title{Name: facts.name(), Year: facts.Year, TMDBID: tmdbID, OriginalLanguage: facts.originalCode()}
	folder := facts.Folder
	if folder == "" {
		if folder, err = MovieFolder(title); err != nil {
			return skip(SkipInvalid)
		}
	}
	row.Match = &Match{TMDBID: tmdbID, Title: facts.name(), Year: facts.Year, TitleID: facts.TitleID, Source: source, Folder: folder}
	if facts.RootFolder != "" {
		row.Root = facts.RootFolder
	}

	// A file far shorter than the Movie is likely a wrong match; a choice
	// the admin made stands.
	if force == 0 {
		runtime := facts.runtime()
		for _, f := range files {
			if !probe.DurationPlausible(f.info.Duration, runtime, probe.MovieFloor) {
				row.Status, row.Ticked, row.Match = NeedsChoice, false, nil
				// The name matched the Movie and only the runtime does not fit.
				row.Candidates = []Candidate{{TMDBID: tmdbID, Title: facts.name(), Year: facts.Year, Suggested: true, Confident: true}}
				return row, nil
			}
		}
	}

	row.Status = Matched
	dir := filepath.Join(row.Root, folder)
	for _, f := range files {
		pf, reason, err := a.planFile(e, facts, title, en, f, dir)
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

// multiPart says the videos are the discs or parts of one Movie (CD1, CD2).
func multiPart(videos []string) bool {
	parts := map[string]bool{}
	for _, v := range videos {
		if m := partRx.FindStringSubmatch(filepath.Base(v)); m != nil {
			parts[m[2]] = true
		}
	}
	return len(parts) >= 2
}

// byTag reads an ID tag off the entry's name; ok is false when it has none
// (or IMDb does not know the id).
func (a *Adoption) byTag(ctx context.Context, en entry) (int, string, error) {
	if m := tmdbTagRx.FindStringSubmatch(en.Name); m != nil {
		n, _ := strconv.Atoi(m[1] + m[2])
		if n > 0 {
			return n, SourceTag, nil
		}
	}
	if m := imdbTagRx.FindStringSubmatch(en.Name); m != nil {
		id, ok, err := a.d.Meta.FindMovieByIMDb(ctx, m[1]+m[2])
		if err != nil {
			var me *metadata.Error
			if errors.As(err, &me) && me.Code == metadata.CodeNotFound {
				return 0, "", nil
			}
			return 0, "", err
		}
		if ok {
			return id, SourceTag, nil
		}
	}
	return 0, "", nil
}

// byName parses the folder name (a loose file or an unreadable folder name
// falls back to the largest video's file name) and searches TMDB for it. A
// result is confident when it is the only Movie whose normalised title is
// the parsed one and whose year is exactly the parsed one.
func (a *Adoption) byName(ctx context.Context, en entry, files []probed) ([]Candidate, int, error) {
	parsed, err := release.ParseFolder(en.Name, release.KindMovie)
	if err != nil || parsed.Title() == "" {
		biggest := files[0]
		for _, f := range files[1:] {
			if f.info.Size > biggest.info.Size {
				biggest = f
			}
		}
		base := strings.TrimSuffix(filepath.Base(biggest.path), filepath.Ext(biggest.path))
		if parsed, err = release.Parse(base, release.KindMovie); err != nil || parsed.Title() == "" {
			// Nothing reads as "title year": search for the folder's name as it is.
			plain := plainTitle(en.Name)
			if plain == "" {
				return nil, 0, nil
			}
			parsed = release.ParsedRelease{Kind: release.KindMovie, Titles: []string{plain}}
		}
	}
	found, err := a.d.Meta.Search(ctx, parsed.Title())
	if err != nil {
		return nil, 0, err
	}
	want := map[string]bool{}
	for _, t := range parsed.Titles {
		want[normalise(t)] = true
	}
	var movies, exact []metadata.SearchResult
	for _, r := range found {
		if r.Kind != metadata.Movie {
			continue
		}
		movies = append(movies, r)
		if (want[normalise(r.Title)] || want[normalise(r.OriginalTitle)]) && parsed.Year != 0 && r.Year == parsed.Year {
			exact = append(exact, r)
		}
	}
	if len(exact) == 1 {
		return nil, exact[0].TMDBID, nil
	}
	if len(movies) == 0 {
		return nil, 0, nil
	}
	fits := func(tmdbID int) bool {
		d, err := a.d.Meta.Movie(ctx, tmdbID)
		if err != nil {
			return false
		}
		for _, f := range files {
			if !probe.DurationPlausible(f.info.Duration, time.Duration(d.Runtime)*time.Minute, probe.MovieFloor) {
				return false
			}
		}
		return true
	}
	return suggest(rankResults(parsed.Titles, parsed.Year, movies), fits), 0, nil
}

var (
	tagGroupRx = regexp.MustCompile(`[\[{][^\]}]*[\]}]`)
	dotsRx     = regexp.MustCompile(`[._]+`)
)

// plainTitle is a folder name with its tags removed and dots read as spaces.
func plainTitle(name string) string {
	name = tagGroupRx.ReplaceAllString(name, " ")
	return strings.Join(strings.Fields(dotsRx.ReplaceAllString(name, " ")), " ")
}

// withProbedResolution keeps the quality a name states when it agrees with
// the file; a name that says nothing about the resolution (or the wrong
// thing) is read again with the probed one, so the file is named for what it is.
func withProbedResolution(p release.ParsedRelease, info probe.Info, name string) release.ParsedRelease {
	kind := p.Kind
	if kind == "" {
		kind = release.KindMovie
	}
	if c, known := resolution.OfHeight(p.Quality.Quality.Resolution); known && c == info.Class() && p.Quality.ResolutionDetection == release.DetectedName {
		return p
	}
	height := 480
	switch info.Class() {
	case resolution.HD:
		height = 1080
		if info.Height < 900 {
			height = 720
		}
	case resolution.UHD:
		height = 2160
	}
	p.Quality = release.ParseQualityOf(fmt.Sprintf("%s %dp", name, height), kind)
	return p
}

// normalise is a title reduced to lower-case letters and digits.
func normalise(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(strings.ReplaceAll(s, "&", " and ")) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// movieFacts is what planning needs to know of a Movie, from the Library when
// it is tracked and from the provider when it is not.
type movieFacts struct {
	TMDBID        int
	TitleID       int64
	Title         string
	OriginalTitle string
	Year          int
	Runtime       int
	OriginalISO   string
	Rel           metadata.ReleaseDates
	Folder        string
	RootFolder    string
	// Detail is the tracked Title; nil when adopting adds it.
	Detail *library.Detail
}

func (f movieFacts) name() string {
	if f.Title != "" {
		return f.Title
	}
	return f.OriginalTitle
}

func (f movieFacts) originalCode() string {
	return codeOfLanguage(release.LanguageByISO(f.OriginalISO))
}

func (f movieFacts) runtime() time.Duration { return time.Duration(f.Runtime) * time.Minute }

func (a *Adoption) facts(ctx context.Context, e *env, tmdbID int) (movieFacts, error) {
	if t, ok := e.byTMDB[tmdbID]; ok {
		d, err := a.d.Library.Get(ctx, t.TitleID, library.View{Country: e.region.Country, Now: a.d.Clock()})
		if err != nil {
			return movieFacts{}, err
		}
		return movieFacts{
			TMDBID: tmdbID, TitleID: d.ID, Title: d.Title, OriginalTitle: d.OriginalTitle, Year: d.Year, Runtime: d.Runtime,
			OriginalISO: d.OriginalLanguage, Rel: d.ReleaseDates, Folder: d.Folder, RootFolder: d.RootFolder, Detail: &d,
		}, nil
	}
	d, err := a.d.Meta.Movie(ctx, tmdbID)
	if err != nil {
		return movieFacts{}, err
	}
	return movieFacts{
		TMDBID: tmdbID, Title: d.Title, OriginalTitle: d.OriginalTitle, Year: d.Year, Runtime: d.Runtime,
		OriginalISO: d.OriginalLanguage, Rel: d.ReleaseDates,
	}, nil
}

// accepts reports whether a Profile takes files of the class, under the household's Primary Language.
func (a *Adoption) accepts(e *env, class probe.Class) func(profiles.Profile) bool {
	return func(p profiles.Profile) bool {
		sp, err := a.snap.Current().Profile(p.Spec(e.region.Primary.Release()))
		return err == nil && slices.Contains(sp.Classes(), class)
	}
}

// planFile plans one probed video of a matched entry. reason is a skip reason
// for the whole entry.
func (a *Adoption) planFile(e *env, m movieFacts, title Title, en entry, f probed, dir string) (PlanFile, string, error) {
	base := strings.TrimSuffix(filepath.Base(f.path), filepath.Ext(f.path))
	slot := slotFor(base, f.info)

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
		r, err := profiles.ResolveAccepting(e.profiles, release.KindMovie, slot, a.accepts(e, f.info.Class()))
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

	rel, _ := filepath.Rel(en.Root, f.path)
	parsed, perr := release.ParsePath(rel, release.KindMovie)
	if perr != nil {
		if parsed, perr = release.Parse(base, release.KindMovie); perr != nil {
			parsed = release.ParsedRelease{Kind: release.KindMovie}
		}
	}
	parsed = withProbedResolution(parsed, f.info, strings.TrimSuffix(rel, filepath.Ext(rel)))
	original := title.OriginalLanguage
	primary := codeOfLanguage(e.region.Primary.Release())
	languages, inconclusive := probe.ResolveLanguages(parsedCodes(parsed, original), f.info.Audio)
	verdict := scoring.Evaluate(
		scoring.Release{Parsed: parsed, IndexerLanguages: languagesOf(languages, inconclusive), Size: f.info.Size, Filename: filepath.Base(f.path)},
		scoring.Title{Name: m.Title, Year: m.Year, OriginalLanguage: release.LanguageByISO(m.OriginalISO)}, profile,
	)

	ext := strings.ToLower(filepath.Ext(f.path))
	name, err := MovieFileName(title, slot, FileFacts{Release: parsed, Probe: f.info, Languages: languages, Primary: primary}, ext)
	if err != nil {
		return PlanFile{}, SkipInvalid, nil
	}
	to := filepath.Join(dir, name)
	parsedJSON, _ := json.Marshal(parsed)
	probeJSON, _ := json.Marshal(f.info)
	misfit, _ := fitOf(profile, f.info, verdict, false)
	pf := PlanFile{
		Path: f.path, To: to, Size: f.info.Size, Slot: slot, Profile: profileKey, Score: verdict.Score, Action: ActionCreate, Ticked: true,
		Misfit: misfit, ReleaseName: base, Parsed: parsedJSON, Probe: probeJSON,
	}
	switch {
	case ver == nil:
	case ver.File == nil:
		pf.Action = ActionFill
	default:
		pf.Action, pf.Ticked = ActionReplace, false
		pf.HeldScore = ver.File.Score
	}
	if exists(to) && to != f.path {
		pf.Left = LeftPathOccupied
	}
	pf.Subtitles = planSubtitles(f.path, strings.TrimSuffix(to, filepath.Ext(to)))
	return pf, "", nil
}

// planSubtitles names every sidecar of a video after the video's new name:
// `<stem>.<lang>[.forced][.sdh].<ext>`, `und` for a language it cannot read.
func planSubtitles(video, newStem string) []PlanSub {
	dir := filepath.Dir(video)
	stem := strings.TrimSuffix(filepath.Base(video), filepath.Ext(video))
	list, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var out []PlanSub
	used := map[string]bool{}
	for _, d := range list {
		name := d.Name()
		ext := strings.ToLower(filepath.Ext(name))
		if d.IsDir() || !subtitleExts[ext] || !strings.HasPrefix(name, stem+".") {
			continue
		}
		rest := strings.TrimPrefix(strings.TrimPrefix(strings.TrimSuffix(name, filepath.Ext(name)), stem), ".")
		s := subOf(rest + ext)
		to, err := SubtitleFileName(filepath.Base(newStem), s.lang, s.forced, s.sdh, ext, func(n string) bool {
			return used[n] || (exists(filepath.Join(filepath.Dir(newStem), n)) && filepath.Join(filepath.Dir(newStem), n) != filepath.Join(dir, name))
		})
		if err != nil {
			continue
		}
		used[to] = true
		out = append(out, PlanSub{From: filepath.Join(dir, name), To: filepath.Join(filepath.Dir(newStem), to)})
	}
	return out
}

// settle resolves what the rows leave open between them: files for one Slot
// of one Movie, or of one episode of one Series, go to the higher Score, then
// the larger size, and the others stay where they are as duplicates.
func settle(rows []Row) {
	type claim struct {
		kind    library.Kind
		tmdb    int
		slot    Slot
		episode library.EpisodeRef
	}
	type ref struct{ row, file int }
	var contenders []ref
	for i := range rows {
		r := &rows[i]
		if r.Status != Matched || r.Match == nil {
			continue
		}
		for j := range r.Files {
			f := &r.Files[j]
			if f.Left == LeftDuplicate {
				f.Left = ""
			}
			if f.Left == "" {
				contenders = append(contenders, ref{i, j})
			}
		}
	}
	file := func(r ref) *PlanFile { return &rows[r.row].Files[r.file] }
	slices.SortStableFunc(contenders, func(x, y ref) int {
		fx, fy := file(x), file(y)
		switch {
		case fx.Score != fy.Score:
			return fy.Score - fx.Score
		case fx.Size != fy.Size:
			if fx.Size > fy.Size {
				return -1
			}
			return 1
		}
		return strings.Compare(fx.Path, fy.Path)
	})
	claimed := map[claim]bool{}
	for _, c := range contenders {
		r, f := &rows[c.row], file(c)
		var keys []claim
		if r.kind() == library.Series {
			for _, ep := range f.Episodes {
				keys = append(keys, claim{library.Series, r.Match.TMDBID, f.Slot, ep})
			}
		} else {
			keys = append(keys, claim{library.Movie, r.Match.TMDBID, f.Slot, library.EpisodeRef{}})
		}
		taken := false
		for _, k := range keys {
			taken = taken || claimed[k]
		}
		if taken {
			f.Left = LeftDuplicate
			continue
		}
		for _, k := range keys {
			claimed[k] = true
		}
	}
}
