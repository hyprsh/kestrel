package health

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// Thresholds from #17 and PRD Settled 16/17.
const (
	// downloadClientGrace: SABnzbd must fail for this long, poll after poll, before it is a row.
	downloadClientGrace = 2 * time.Minute
	// noIndexerGrace: an indexer with an error other than bad credentials counts as failing
	// for "No indexer can search" once it has failed for this long.
	noIndexerGrace = 2 * time.Minute
	// indexerGrace: errors other than bad credentials make an Indexer failing row after this long.
	indexerGrace = 6 * time.Hour
	// metadataGrace: a provider failing without an auth error is a Warning after this long.
	metadataGrace = 24 * time.Hour

	// MediaServerEvery: how often every enabled media server is tested (see TestMediaServers).
	MediaServerEvery = 15 * time.Minute
	// mediaServerFailures: failed checks in a row before a server that is not
	// refusing Kestrel's credentials is a row. Two checks is 30 min.
	mediaServerFailures = 2
	// metadataEvery: a provider without a real call for this long is probed.
	metadataEvery = time.Hour
	// dueSlack lets a timed check run on the loop tick that lands just before its
	// interval is up, so the loop's jitter does not push it a whole tick later.
	dueSlack = time.Minute

	// Low disk space: under 5 % or under 50 GB free, whichever is larger.
	lowDiskFraction = 0.05
	lowDiskBytes    = 50 << 30
)

// Ref names an instance a row is about.
type Ref struct {
	ID   int64
	Name string
}

// Failure is one failed call seen by an observer. Nil means the call worked.
type Failure struct {
	// Auth is true when the credentials were rejected.
	Auth    bool
	Message string
}

// Space is the room on a mount.
type Space struct {
	Free, Total uint64
}

// Disk is one line of the health strip.
type Disk struct {
	Path        string
	Free, Total uint64
	// Low is the free space under which the low disk space check fires.
	Low uint64
}

// lowDiskFloor is the free space under which a mount of this size counts as nearly full.
func lowDiskFloor(total uint64) uint64 {
	return max(uint64(float64(total)*lowDiskFraction), lowDiskBytes)
}

// ChecksDeps are what the periodic checks look at. Every field is optional: a
// check whose input is nil is skipped.
type ChecksDeps struct {
	// SetupDone says whether the wizard finished; the checks that need
	// configuration stay quiet until then. Nil means always.
	SetupDone func(ctx context.Context) bool
	// RootFolders lists every configured Root folder.
	RootFolders func(ctx context.Context) ([]string, error)
	// DataDir is the media mount (KESTREL_DATA_DIR) whose free space is watched.
	DataDir string
	// Disk reads the space on a path; nil means the operating system's.
	Disk func(path string) (Space, error)
	// EnabledIndexers lists the enabled indexer instances.
	EnabledIndexers func(ctx context.Context) ([]Ref, error)
	// Ping calls the download client once so the watch sees an idle outage too.
	Ping func(ctx context.Context) error
	// MediaServers lists the enabled media server instances.
	MediaServers func(ctx context.Context) ([]Ref, error)
	// MetadataProbes make one cheap call to each metadata provider, by name. A
	// probe reports its outcome through ObserveMetadata, as a real call does.
	MetadataProbes map[string]func(ctx context.Context) error
}

// Check inspects one condition and raises or clears its rows.
type Check func(ctx context.Context, h *Service) error

type namedCheck struct {
	name string
	run  Check
	// every is the check's own interval; 0 runs it on every RunChecks.
	every time.Duration
}

// AddCheck registers a check for RunChecks: the way a module that owns a
// condition (the api's proxy header table) keeps its rows current every 5 min.
func (s *Service) AddCheck(name string, c Check) { s.AddCheckEvery(name, 0, c) }

// AddCheckEvery is AddCheck for a check with its own interval, longer than
// the health loop's: RunChecks runs it only once every has passed since its
// last run. Its name must be unique, as it keys the last run.
func (s *Service) AddCheckEvery(name string, every time.Duration, c Check) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.checks = append(s.checks, namedCheck{name: name, run: c, every: every})
}

func (s *Service) addBuiltinChecks() {
	own := func(f func(context.Context) error) Check {
		return func(ctx context.Context, _ *Service) error { return f(ctx) }
	}
	s.checks = []namedCheck{
		{name: "download client", run: own(s.checkDownloadClient)},
		{name: "indexers", run: own(s.checkIndexers)},
		{name: "root folders", run: own(s.checkRootFolders)},
		{name: "disk space", run: own(s.checkDisk)},
		{name: "media server rows", run: own(s.retireMediaServers)},
		{name: "metadata providers", run: own(s.checkMetadata)},
	}
}

// RunChecks runs every check, the built-in ones first. A failing check does not
// stop the others; their errors are joined.
func (s *Service) RunChecks(ctx context.Context) error {
	s.mu.Lock()
	checks := append([]namedCheck(nil), s.checks...)
	s.mu.Unlock()
	var errs []error
	for _, c := range checks {
		if c.every > 0 && !s.due(c.name, c.every) {
			continue
		}
		if err := c.run(ctx, s); err != nil {
			errs = append(errs, fmt.Errorf("health check %s: %w", c.name, err))
		}
	}
	return errors.Join(errs...)
}

func (s *Service) setupDone(ctx context.Context) bool {
	return s.deps.SetupDone == nil || s.deps.SetupDone(ctx)
}

// ---- download client ----

// ObserveDownloadClient reports one call to the download client. Failures that
// last two minutes make the Blocking "unreachable" row; a good call clears it.
func (s *Service) ObserveDownloadClient(ctx context.Context, ref Ref, f *Failure) {
	s.mu.Lock()
	w := &s.watches.downloadClient
	if f == nil {
		wasRaised := w.raised != ""
		*w = watch{}
		s.mu.Unlock()
		if wasRaised {
			s.logErr(s.Clear(ctx, keyDownloadClient))
		}
		return
	}
	if w.since.IsZero() {
		w.since = s.clock()
	}
	w.auth, w.message = f.Auth, f.Message
	msg := fmt.Sprintf("%s is unreachable: %s", ref.Name, f.Message)
	if f.Auth {
		msg = fmt.Sprintf("%s rejected Kestrel's credentials: %s", ref.Name, f.Message)
	}
	raise := s.clock().Sub(w.since) >= downloadClientGrace && w.raised != msg
	if raise {
		w.raised = msg
	}
	s.mu.Unlock()
	if raise {
		s.logErr(s.Raise(ctx, Issue{
			Key: keyDownloadClient, Kind: KindDownloadClient, Severity: Blocking,
			Subject: Subject{PluginInstanceID: ref.ID}, Message: msg,
		}))
	}
}

const keyDownloadClient = "download_client"

func (s *Service) checkDownloadClient(ctx context.Context) error {
	if s.deps.Ping != nil {
		_ = s.deps.Ping(ctx) // the client host reports the outcome through ObserveDownloadClient
	}
	return nil
}

// ClientState is how the download client's last call went.
func (s *Service) ClientState() State {
	s.mu.Lock()
	defer s.mu.Unlock()
	w := s.watches.downloadClient
	if w.since.IsZero() {
		return State{}
	}
	return State{Failing: true, Auth: w.auth, Message: w.message, Since: w.since}
}

// ---- indexers ----

// State is what the health strip shows of one indexer or of the download client.
type State struct {
	Failing bool
	Auth    bool
	Message string
	Since   time.Time
}

// IndexerStates are the indexers that failed their last call, by instance id.
func (s *Service) IndexerStates() map[int64]State {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make(map[int64]State, len(s.watches.indexers))
	for id, w := range s.watches.indexers {
		out[id] = State{Failing: true, Auth: w.auth, Message: w.message, Since: w.since}
	}
	return out
}

func indexerKey(id int64) string { return fmt.Sprintf("indexer:%d", id) }

// ObserveIndexer reports one call to an indexer; callers leave out rate limits,
// which are pauses and not failures. Bad credentials make the Warning at once,
// other errors after six hours of failing; a good call clears it. Every
// observation re-evaluates "No indexer can search".
func (s *Service) ObserveIndexer(ctx context.Context, ref Ref, f *Failure) {
	s.mu.Lock()
	ws := s.watches.indexers
	w, had := ws[ref.ID]
	if f == nil {
		delete(ws, ref.ID)
		s.mu.Unlock()
		if had {
			s.logErr(s.Clear(ctx, indexerKey(ref.ID)))
		}
		s.logErr(s.evaluateNoIndexer(ctx))
		return
	}
	if !had {
		w = &indexerWatch{since: s.clock()}
		ws[ref.ID] = w
	}
	w.auth, w.message = f.Auth, f.Message
	msg := fmt.Sprintf("%s keeps failing: %s", ref.Name, f.Message)
	if f.Auth {
		msg = fmt.Sprintf("%s rejected its credentials: %s", ref.Name, f.Message)
	}
	raise := (f.Auth || s.clock().Sub(w.since) >= indexerGrace) && w.raised != msg
	if raise {
		w.raised = msg
	}
	s.mu.Unlock()
	if raise {
		s.logErr(s.Raise(ctx, Issue{
			Key: indexerKey(ref.ID), Kind: KindIndexer, Severity: Warning,
			Subject: Subject{PluginInstanceID: ref.ID}, Message: msg,
		}))
	}
	s.logErr(s.evaluateNoIndexer(ctx))
}

const keyNoIndexer = "no_indexer"

// evaluateNoIndexer raises the Blocking "No indexer can search" row when none is
// enabled or every enabled one is failing, and clears it otherwise.
func (s *Service) evaluateNoIndexer(ctx context.Context) error {
	if s.deps.EnabledIndexers == nil {
		return nil
	}
	if !s.setupDone(ctx) {
		return s.Clear(ctx, keyNoIndexer)
	}
	enabled, err := s.deps.EnabledIndexers(ctx)
	if err != nil {
		return err
	}
	usable := 0
	s.mu.Lock()
	for _, ref := range enabled {
		w, failing := s.watches.indexers[ref.ID]
		if !failing || !(w.auth || s.clock().Sub(w.since) >= noIndexerGrace) {
			usable++
		}
	}
	s.mu.Unlock()
	switch {
	case len(enabled) == 0:
		return s.Raise(ctx, Issue{Key: keyNoIndexer, Kind: KindNoIndexer, Severity: Blocking, Message: "No indexer is enabled, so nothing can be searched"})
	case usable == 0:
		return s.Raise(ctx, Issue{Key: keyNoIndexer, Kind: KindNoIndexer, Severity: Blocking, Message: "Every enabled indexer is failing, so nothing can be searched"})
	}
	return s.Clear(ctx, keyNoIndexer)
}

func (s *Service) checkIndexers(ctx context.Context) error {
	if s.deps.EnabledIndexers == nil {
		return nil
	}
	enabled, err := s.deps.EnabledIndexers(ctx)
	if err != nil {
		return err
	}
	// An indexer that was deleted or disabled takes its failure with it.
	keep := make([]string, 0, len(enabled))
	live := map[int64]bool{}
	for _, ref := range enabled {
		keep = append(keep, indexerKey(ref.ID))
		live[ref.ID] = true
	}
	s.mu.Lock()
	for id := range s.watches.indexers {
		if !live[id] {
			delete(s.watches.indexers, id)
		}
	}
	s.mu.Unlock()
	if err := s.ClearExcept(ctx, KindIndexer, keep...); err != nil {
		return err
	}
	return s.evaluateNoIndexer(ctx)
}

// due says whether a timed check last ran an interval ago, and if so marks it run now.
func (s *Service) due(name string, every time.Duration) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.clock()
	if last, ok := s.watches.lastRun[name]; ok && now.Sub(last) < every-dueSlack {
		return false
	}
	s.watches.lastRun[name] = now
	return true
}

// ---- media servers ----

func mediaServerKey(id int64) string { return fmt.Sprintf("media_server:%d", id) }

// ObserveMediaServer reports one check of a media server. Rejected credentials
// make the Warning at once; other failures after two checks in a row, which is
// 30 min. A good check clears it. Downloads and Imports go on without a media
// server, so this is never Blocking.
func (s *Service) ObserveMediaServer(ctx context.Context, ref Ref, f *Failure) {
	s.mu.Lock()
	ws := s.watches.mediaServers
	w, had := ws[ref.ID]
	if f == nil {
		delete(ws, ref.ID)
		s.mu.Unlock()
		if had {
			s.logErr(s.Clear(ctx, mediaServerKey(ref.ID)))
		}
		return
	}
	if !had {
		w = &mediaServerWatch{}
		ws[ref.ID] = w
	}
	w.failures++
	msg := fmt.Sprintf("%s is unreachable: %s", ref.Name, f.Message)
	if f.Auth {
		msg = fmt.Sprintf("%s rejected Kestrel's credentials: %s", ref.Name, f.Message)
	}
	raise := (f.Auth || w.failures >= mediaServerFailures) && w.raised != msg
	if raise {
		w.raised = msg
	}
	s.mu.Unlock()
	if raise {
		s.logErr(s.Raise(ctx, Issue{
			Key: mediaServerKey(ref.ID), Kind: KindMediaServer, Severity: Warning,
			Subject: Subject{PluginInstanceID: ref.ID}, Message: msg,
		}))
	}
}

// retireMediaServers drops the row and watch of a media server that was
// deleted or disabled. It runs every loop, so the row goes at once, not at the
// next test.
func (s *Service) retireMediaServers(ctx context.Context) error {
	if s.deps.MediaServers == nil {
		return nil
	}
	enabled, err := s.deps.MediaServers(ctx)
	if err != nil {
		return err
	}
	keep := make([]string, 0, len(enabled))
	live := map[int64]bool{}
	for _, ref := range enabled {
		keep = append(keep, mediaServerKey(ref.ID))
		live[ref.ID] = true
	}
	s.mu.Lock()
	for id := range s.watches.mediaServers {
		if !live[id] {
			delete(s.watches.mediaServers, id)
		}
	}
	s.mu.Unlock()
	return s.ClearExcept(ctx, KindMediaServer, keep...)
}

// TestMediaServers is the check that runs test on every enabled media server
// and reports each outcome through ObserveMediaServer; nil means it worked.
// Register it with AddCheckEvery and MediaServerEvery.
func TestMediaServers(test func(ctx context.Context, ref Ref) *Failure) Check {
	return func(ctx context.Context, h *Service) error {
		if h.deps.MediaServers == nil {
			return nil
		}
		enabled, err := h.deps.MediaServers(ctx)
		if err != nil {
			return err
		}
		for _, ref := range enabled {
			h.ObserveMediaServer(ctx, ref, test(ctx, ref))
		}
		return nil
	}
}

// ---- metadata providers ----

func metadataKey(provider string) string { return "metadata:" + provider }

// ObserveMetadata reports one call to a metadata provider (TMDB, TheTVDB).
// Rejected credentials make a Blocking row at once; other failures a Warning
// once they have lasted a day. A good call clears the row.
func (s *Service) ObserveMetadata(ctx context.Context, provider string, f *Failure) {
	s.mu.Lock()
	s.watches.metadataCall[provider] = s.clock()
	w, had := s.watches.metadata[provider]
	if f == nil {
		delete(s.watches.metadata, provider)
		s.mu.Unlock()
		if had {
			s.logErr(s.Clear(ctx, metadataKey(provider)))
		}
		return
	}
	if !had {
		w = &watch{since: s.clock()}
		s.watches.metadata[provider] = w
	}
	sev, msg := Warning, fmt.Sprintf("%s has been failing for a day: %s", provider, f.Message)
	if f.Auth {
		sev, msg = Blocking, fmt.Sprintf("%s rejected its API key: %s", provider, f.Message)
	}
	raise := (f.Auth || s.clock().Sub(w.since) >= metadataGrace) && w.raised != msg
	if raise {
		w.raised = msg
	}
	s.mu.Unlock()
	if raise {
		s.logErr(s.Raise(ctx, Issue{Key: metadataKey(provider), Kind: KindMetadata, Severity: sev, Message: msg}))
	}
}

// checkMetadata makes one cheap call to each provider that had no call, real or
// probed, in the last hour. The probe reports through ObserveMetadata, so the
// row and its thresholds are the ones a real call gets.
func (s *Service) checkMetadata(ctx context.Context) error {
	for name, probe := range s.deps.MetadataProbes {
		s.mu.Lock()
		last, ok := s.watches.metadataCall[name]
		skip := ok && s.clock().Sub(last) < metadataEvery-dueSlack
		if !skip {
			s.watches.metadataCall[name] = s.clock() // a probe that counts for nothing (rate limited) waits an hour too
		}
		s.mu.Unlock()
		if !skip {
			_ = probe(ctx)
		}
	}
	return nil
}

// ---- Root folders ----

// ErrRootFolderUnavailable means a Root folder is missing, not a directory or
// not writable. Imports into it must wait.
var ErrRootFolderUnavailable = errors.New("root folder unavailable")

func rootFolderKey(path string) string { return "root_folder:" + path }

// rootFolderProblem says what is wrong with a Root folder, or "" if it is usable.
func rootFolderProblem(path string) string {
	info, err := os.Stat(path)
	switch {
	case errors.Is(err, os.ErrNotExist):
		return "does not exist (is the drive mounted?)"
	case err != nil:
		return "cannot be read: " + err.Error()
	case !info.IsDir():
		return "is not a directory"
	}
	f, err := os.CreateTemp(path, ".kestrel-writable-*")
	if err != nil {
		return "is not writable"
	}
	name := f.Name()
	_ = f.Close()
	_ = os.Remove(name)
	return ""
}

// CheckRootFolder checks one Root folder now, raises or clears its row, and
// returns an error wrapping ErrRootFolderUnavailable while it is unusable.
// Imports call it before each Import; the 5-minute check covers the rest.
func (s *Service) CheckRootFolder(ctx context.Context, path string) error {
	problem := rootFolderProblem(path)
	if problem == "" {
		return s.Clear(ctx, rootFolderKey(path))
	}
	msg := fmt.Sprintf("Root folder %s %s", path, problem)
	if err := s.Raise(ctx, Issue{Key: rootFolderKey(path), Kind: KindRootFolder, Severity: Blocking, Message: msg}); err != nil {
		return err
	}
	return fmt.Errorf("%w: %s", ErrRootFolderUnavailable, msg)
}

func (s *Service) checkRootFolders(ctx context.Context) error {
	if s.deps.RootFolders == nil {
		return nil
	}
	if !s.setupDone(ctx) {
		// The wizard prefills folders that may not exist yet.
		return s.ClearExcept(ctx, KindRootFolder)
	}
	paths, err := s.deps.RootFolders(ctx)
	if err != nil {
		return err
	}
	var keep []string
	for _, p := range paths {
		if err := s.CheckRootFolder(ctx, p); err != nil {
			if !errors.Is(err, ErrRootFolderUnavailable) {
				return err
			}
			keep = append(keep, rootFolderKey(p))
		}
	}
	return s.ClearExcept(ctx, KindRootFolder, keep...)
}

// ---- disk space ----

func (s *Service) space(path string) (Space, error) {
	if s.deps.Disk != nil {
		return s.deps.Disk(path)
	}
	return diskSpace(filepath.Clean(path))
}

// Disks reads the free space of the data mount and of every Root folder, for
// the health strip. A path that cannot be read is left out.
func (s *Service) Disks(ctx context.Context) ([]Disk, error) {
	var paths []string
	if s.deps.DataDir != "" {
		paths = append(paths, s.deps.DataDir)
	}
	if s.deps.RootFolders != nil {
		roots, err := s.deps.RootFolders(ctx)
		if err != nil {
			return nil, err
		}
		paths = append(paths, roots...)
	}
	out := make([]Disk, 0, len(paths))
	for _, p := range paths {
		sp, err := s.space(p)
		if err != nil {
			continue
		}
		out = append(out, Disk{Path: p, Free: sp.Free, Total: sp.Total, Low: lowDiskFloor(sp.Total)})
	}
	return out, nil
}

const keyLowDisk = "low_disk"

func (s *Service) checkDisk(ctx context.Context) error {
	if s.deps.DataDir == "" {
		return nil
	}
	sp, err := s.space(s.deps.DataDir)
	if err != nil {
		return nil // an unreadable mount is the Root folder check's to report
	}
	floor := lowDiskFloor(sp.Total)
	if sp.Free >= floor {
		return s.Clear(ctx, keyLowDisk)
	}
	return s.Raise(ctx, Issue{
		Key: keyLowDisk, Kind: KindLowDisk, Severity: Warning,
		Message: fmt.Sprintf("Low disk space on %s: %s free of %s", s.deps.DataDir, humanBytes(sp.Free), humanBytes(sp.Total)),
	})
}

func humanBytes(n uint64) string {
	const unit = 1 << 10
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	div, exp := uint64(unit), 0
	for m := n / unit; m >= unit; m /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %ciB", float64(n)/float64(div), "KMGTPE"[exp])
}

// ---- state ----

type watch struct {
	since   time.Time
	auth    bool
	message string
	raised  string // the message of the row raised for this streak, "" if none
}

type indexerWatch struct {
	since   time.Time
	auth    bool
	message string
	raised  string
}

type mediaServerWatch struct {
	failures int // failed checks in a row
	raised   string
}

type watches struct {
	downloadClient watch
	indexers       map[int64]*indexerWatch
	metadata       map[string]*watch
	mediaServers   map[int64]*mediaServerWatch
	// metadataCall is when each provider last had a call, real or probed.
	metadataCall map[string]time.Time
	// lastRun is when each timed check last ran.
	lastRun map[string]time.Time
}

func newWatches() watches {
	return watches{
		indexers: map[int64]*indexerWatch{}, metadata: map[string]*watch{}, mediaServers: map[int64]*mediaServerWatch{},
		metadataCall: map[string]time.Time{}, lastRun: map[string]time.Time{},
	}
}

func (s *Service) logErr(err error) {
	if err != nil {
		s.log.Error("health", "err", err)
	}
}
