package jobs_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/hyprsh/kestrel/internal/health"
	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/imports"
	"github.com/hyprsh/kestrel/internal/jobs"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/scoring/trashsync"
	"github.com/hyprsh/kestrel/internal/settings"
	"github.com/hyprsh/kestrel/internal/store"
	"github.com/hyprsh/kestrel/internal/store/storetest"
)

var trashNow = time.Date(2026, 10, 18, 9, 0, 0, 0, time.UTC)

// trashBundle is a TRaSH-shaped tree, empty of Custom Formats, for a commit.
func trashBundle(commit string, at time.Time) fstest.MapFS {
	m := fstest.MapFS{
		"COMMIT":       {Data: []byte(commit + "\n")},
		"COMMITTED_AT": {Data: []byte(at.Format(time.RFC3339) + "\n")},
	}
	for _, app := range []string{"radarr", "sonarr"} {
		for _, dir := range []string{"cf", "cf-groups", "quality-profiles"} {
			m[app+"/"+dir+"/.keep"] = &fstest.MapFile{}
		}
	}
	return m
}

type trashSource struct {
	ref        trashsync.Ref
	files      fs.FS
	calls      int
	err        error
	commits    []trashsync.Commit
	commitsErr error
}

func (f *trashSource) Commits(context.Context, trashsync.Ref, string) ([]trashsync.Commit, error) {
	return f.commits, f.commitsErr
}

func (f *trashSource) Latest(context.Context) (trashsync.Ref, error) { return f.ref, f.err }
func (f *trashSource) Download(context.Context, trashsync.Ref) (fs.FS, error) {
	f.calls++
	return f.files, nil
}

type rescoreCall struct{ under, active *scoring.Snapshot }

type trashEnv struct {
	updates  *jobs.TrashUpdates
	snaps    *trashsync.Service
	holder   *scoring.Holder
	src      *trashSource
	health   *health.Service
	st       *store.Store
	rescored []rescoreCall
	failWith error
	hist     *history.Service
	summary  imports.RescoreSummary
	// bundled is the set the binary carries, for the startup's re-score.
	bundled fs.FS
	// during runs inside a re-score, to look at what the runner shows then.
	during func(ids []int64, progress func(int))
}

type oneTitle struct{}

func (oneTitle) Names(context.Context) ([]library.Named, error) {
	return []library.Named{{ID: 1}, {ID: 2}}, nil
}

type rescorer struct{ e *trashEnv }

func (r rescorer) RescoreTitles(_ context.Context, snap *scoring.Snapshot, ids []int64, _ string, progress func(int)) (imports.RescoreSummary, error) {
	r.e.rescored = append(r.e.rescored, rescoreCall{under: snap, active: r.e.holder.Current()})
	if r.e.during != nil {
		r.e.during(ids, progress)
	}
	return r.e.summary, r.e.failWith
}

func newTrashEnv(t *testing.T) *trashEnv {
	t.Helper()
	st, err := store.Open(context.Background(), store.Options{Dir: storetest.Dir(t)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	e := &trashEnv{src: &trashSource{}, st: st, hist: history.New(st, func() time.Time { return trashNow }, nil)}
	e.holder = scoring.NewHolder(loadSnapshot(t, trashBundle("old", trashNow.AddDate(0, 0, -10))))
	e.health = health.New(health.Deps{Store: st, Clock: func() time.Time { return trashNow }})
	e.rebuild()
	return e
}

// rebuild is a restart: new services over the same store and the current holder.
func (e *trashEnv) rebuild() {
	e.snaps = trashsync.New(trashsync.Deps{
		Holder: e.holder, Settings: settings.New(e.st), Source: e.src, Health: e.health, Bundled: e.bundled, Clock: func() time.Time { return trashNow },
	})
	e.updates = jobs.NewTrashUpdates(jobs.TrashUpdatesDeps{
		Snapshots: e.snaps, Holder: e.holder, Library: oneTitle{}, Rescorer: rescorer{e}, History: e.hist,
		Profiles: func(context.Context) ([]scoring.UsedProfile, error) {
			return []scoring.UsedProfile{{Name: "HD", Spec: scoring.ProfileSpec{Primary: release.LangEnglish}}}, nil
		},
	})
}

func (e *trashEnv) offer(commit string, at time.Time) {
	e.src.ref = trashsync.Ref{Commit: commit, CommittedAt: at}
	e.src.files = trashBundle(commit, at)
}

func (e *trashEnv) warnings(t *testing.T) []health.Row {
	t.Helper()
	rows, err := e.health.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return rows
}

func loadSnapshot(t *testing.T, f fs.FS) *scoring.Snapshot {
	t.Helper()
	s, err := scoring.LoadSnapshot(f)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestValidTrashUpdateRescoresBeforeItBecomesActive(t *testing.T) {
	e := newTrashEnv(t)
	e.offer("new", trashNow.Add(-time.Hour))
	res, err := e.updates.Update(context.Background())
	if err != nil || !res.Changed || res.Commit != "new" {
		t.Fatalf("Update = %+v, %v", res, err)
	}
	if len(e.rescored) != 1 {
		t.Fatalf("re-scored %d times, want once", len(e.rescored))
	}
	c := e.rescored[0]
	if c.under.Commit() != "new" || c.active.Commit() != "old" {
		t.Errorf("re-score ran under %q while %q was active; want new under old", c.under.Commit(), c.active.Commit())
	}
	if e.holder.Current().Commit() != "new" {
		t.Errorf("active = %q after the update", e.holder.Current().Commit())
	}
	if len(e.warnings(t)) != 0 {
		t.Errorf("warnings after a good update: %+v", e.warnings(t))
	}
}

func TestABrokenTrashSnapshotIsNeverRescoredUnder(t *testing.T) {
	e := newTrashEnv(t)
	before := e.holder.Current()
	e.src.ref = trashsync.Ref{Commit: "broken", CommittedAt: trashNow}
	e.src.files = fstest.MapFS{"COMMIT": {Data: []byte("broken")}} // no app directories
	if _, err := e.updates.Update(context.Background()); !errors.Is(err, trashsync.ErrRejected) {
		t.Fatalf("a broken snapshot was accepted: %v", err)
	}
	if e.holder.Current() != before || len(e.rescored) != 0 {
		t.Error("a rejected update changed the active snapshot or re-scored files")
	}
	if len(e.warnings(t)) != 1 {
		t.Errorf("warnings = %+v, want one", e.warnings(t))
	}
}

func TestAFailedRescoreRejectsTheWholeTrashUpdate(t *testing.T) {
	e := newTrashEnv(t)
	before := e.holder.Current()
	e.offer("new", trashNow)
	e.failWith = errors.New("profile german-hd no longer resolves")
	if _, err := e.updates.Update(context.Background()); !errors.Is(err, trashsync.ErrRejected) {
		t.Fatalf("update succeeded though re-scoring failed: %v", err)
	}
	if e.holder.Current() != before {
		t.Error("the new snapshot became active")
	}
	if len(e.warnings(t)) != 1 {
		t.Error("no Warning raised")
	}
	// The next good update clears the Warning.
	e.failWith = nil
	e.offer("newer", trashNow.Add(time.Minute))
	if _, err := e.updates.Update(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(e.warnings(t)) != 0 {
		t.Error("the Warning stayed after a good update")
	}
}

func TestTheSameTrashCommitIsNotDownloadedOrRescoredAgain(t *testing.T) {
	e := newTrashEnv(t)
	e.offer("old", trashNow.AddDate(0, 0, -10))
	res, err := e.updates.Update(context.Background())
	if err != nil || res.Changed || e.src.calls != 0 || len(e.rescored) != 0 {
		t.Fatalf("res = %+v, err = %v, downloads = %d, re-scores = %d", res, err, e.src.calls, len(e.rescored))
	}
}

func TestTheDailyTrashCheckFollowsTheSwitch(t *testing.T) {
	e := newTrashEnv(t)
	ctx := context.Background()
	e.offer("new", trashNow)
	if err := e.snaps.SetAutoUpdate(ctx, false); err != nil {
		t.Fatal(err)
	}
	if err := e.updates.Check(ctx); err != nil || e.holder.Current().Commit() != "old" {
		t.Fatalf("Check with the switch off changed the snapshot (%v)", err)
	}
	if err := e.snaps.SetAutoUpdate(ctx, true); err != nil {
		t.Fatal(err)
	}
	if err := e.updates.Check(ctx); err != nil || e.holder.Current().Commit() != "new" {
		t.Fatalf("Check with the switch on: %v, active %q", err, e.holder.Current().Commit())
	}
}

func TestTheDailyTrashCheckHonoursTheGitHubSwitch(t *testing.T) {
	e := newTrashEnv(t)
	e.offer("new", trashNow)
	updates := jobs.NewTrashUpdates(jobs.TrashUpdatesDeps{
		Snapshots: e.snaps, Holder: e.holder, Library: oneTitle{}, Rescorer: rescorer{e},
		Enabled: func(context.Context) bool { return false },
	})
	if err := updates.Check(context.Background()); err != nil || e.src.calls != 0 || e.holder.Current().Commit() != "old" {
		t.Fatalf("Check with GitHub checks off: %v, %d downloads", err, e.src.calls)
	}
}

func TestStartupRescoresWhenTheActiveSnapshotIsNotTheOneTheFilesWereScoredUnder(t *testing.T) {
	e := newTrashEnv(t)
	ctx := context.Background()
	if err := e.updates.Start(ctx); err != nil {
		t.Fatal(err)
	}
	e.rescored = nil

	// Same snapshot as last time: nothing to redo.
	e.rebuild()
	if err := e.updates.Start(ctx); err != nil || len(e.rescored) != 0 {
		t.Fatalf("restart on the same snapshot: %v, %d re-scores", err, len(e.rescored))
	}

	// A new binary ships a newer embedded snapshot: the stored Scores are stale.
	e.holder = scoring.NewHolder(loadSnapshot(t, trashBundle("embedded-new", trashNow)))
	e.rebuild()
	if err := e.updates.Start(ctx); err != nil {
		t.Fatal(err)
	}
	if len(e.rescored) != 1 || e.rescored[0].under.Commit() != "embedded-new" {
		t.Fatalf("re-scores = %+v, want one under embedded-new", e.rescored)
	}
	e.rescored = nil
	e.rebuild()
	if err := e.updates.Start(ctx); err != nil || len(e.rescored) != 0 {
		t.Errorf("the next restart re-scored again: %v, %d", err, len(e.rescored))
	}
}

func TestADownloadedTrashSnapshotIsNotRescoredAgainAtStartup(t *testing.T) {
	e := newTrashEnv(t)
	ctx := context.Background()
	e.offer("downloaded", trashNow.Add(-24*time.Hour))
	if _, err := e.updates.Update(ctx); err != nil {
		t.Fatal(err)
	}
	e.rescored = nil
	e.holder = scoring.NewHolder(loadSnapshot(t, trashBundle("embedded-old", trashNow.AddDate(0, 0, -30))))
	e.rebuild()

	if err := e.updates.Start(ctx); err != nil || len(e.rescored) != 0 {
		t.Fatalf("Start: %v, %d re-scores; the files were scored under the download already", err, len(e.rescored))
	}
	if e.holder.Current().Commit() != "downloaded" {
		t.Errorf("active = %q, want the download", e.holder.Current().Commit())
	}
}

// trashRunner is the trash loop on a runner, so a pass is driven with Pass.
func (e *trashEnv) trashRunner() *jobs.Runner {
	r := jobs.New(nil)
	r.Add(jobs.Loop{
		Name: jobs.Trash,
		Run: func(ctx context.Context) error {
			if ran, err := e.updates.RunRequested(ctx); ran {
				return err
			}
			return e.updates.Check(ctx)
		},
		Schedule: jobs.Schedule{Every: time.Hour},
	})
	return r
}

func trashJob(r *jobs.Runner) jobs.Job { return r.Jobs()[0] }

func TestARequestedUpdateReturnsAtOnceAndOnePassRunsForTwoRequests(t *testing.T) {
	e := newTrashEnv(t)
	e.offer("new", trashNow)
	kicks := 0
	e.updates.OnRequest(func() { kicks++ })

	if !e.updates.RequestUpdate(context.Background()) || e.updates.RequestUpdate(context.Background()) {
		t.Fatal("two requests in a row must start exactly one pass")
	}
	if kicks != 1 || len(e.rescored) != 0 || e.holder.Current().Commit() != "old" {
		t.Fatalf("kicks = %d, re-scores = %d: the request must not re-score itself", kicks, len(e.rescored))
	}
	r := e.trashRunner()
	if err := r.Pass(context.Background(), jobs.Trash); err != nil {
		t.Fatal(err)
	}
	if e.holder.Current().Commit() != "new" || len(e.rescored) != 1 {
		t.Errorf("active = %q, re-scores = %d after the pass", e.holder.Current().Commit(), len(e.rescored))
	}
	if !e.updates.RequestUpdate(context.Background()) {
		t.Error("a request after the pass was ignored")
	}
}

func TestARequestWhileItsPassRunsStartsNoSecondPass(t *testing.T) {
	e := newTrashEnv(t)
	e.offer("new", trashNow)
	r := e.trashRunner()
	e.updates.RequestUpdate(context.Background())
	var again bool
	e.during = func([]int64, func(int)) { again = e.updates.RequestUpdate(context.Background()) }
	if err := r.Pass(context.Background(), jobs.Trash); err != nil {
		t.Fatal(err)
	}
	if again {
		t.Error("a request during the running pass queued another")
	}
}

func TestTheTrashJobReportsProgressWhileReScoring(t *testing.T) {
	e := newTrashEnv(t)
	e.offer("new", trashNow)
	r := e.trashRunner()
	var seen []jobs.Progress
	e.during = func(ids []int64, progress func(int)) {
		for i := range ids {
			progress(i + 1)
			j := trashJob(r)
			if !j.Running || j.Progress == nil {
				t.Errorf("job = %+v, want running with progress", j)
				return
			}
			seen = append(seen, *j.Progress)
		}
	}
	e.updates.RequestUpdate(context.Background())
	if err := r.Pass(context.Background(), jobs.Trash); err != nil {
		t.Fatal(err)
	}
	if len(seen) != 2 || seen[0] != (jobs.Progress{Done: 1, Total: 2}) || seen[1] != (jobs.Progress{Done: 2, Total: 2}) {
		t.Errorf("progress = %+v, want 1/2 then 2/2", seen)
	}
	if trashJob(r).Progress != nil {
		t.Error("progress stayed after the pass")
	}
}

func TestEveryTrashOutcomeIsReportedOnTheJob(t *testing.T) {
	cases := []struct {
		name  string
		setup func(e *trashEnv)
		want  jobs.OutcomeKind
		text  string
	}{
		{"changed", func(e *trashEnv) { e.offer("abc1234def", trashNow) }, jobs.OutcomeUpdated, "abc1234"},
		{"unchanged", func(e *trashEnv) { e.offer("old", trashNow.AddDate(0, 0, -10)) }, jobs.OutcomeUpToDate, "up to date"},
		{"rejected", func(e *trashEnv) { e.offer("new", trashNow); e.failWith = errors.New("boom") }, jobs.OutcomeRejected, "previous"},
		{"unreachable", func(e *trashEnv) { e.src.err = errors.New("down") }, jobs.OutcomeUnreachable, "reach"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			e := newTrashEnv(t)
			c.setup(e)
			r := e.trashRunner()
			e.updates.RequestUpdate(context.Background())
			_ = r.Pass(context.Background(), jobs.Trash)
			o := trashJob(r).Outcome
			if o == nil || o.Kind != c.want || !strings.Contains(o.Text, c.text) {
				t.Errorf("outcome = %+v, want %s containing %q", o, c.want, c.text)
			}
		})
	}
}

func TestTheDailyCheckThatIsNotDueKeepsTheLastOutcome(t *testing.T) {
	e := newTrashEnv(t)
	e.offer("new", trashNow)
	r := e.trashRunner()
	e.updates.RequestUpdate(context.Background())
	_ = r.Pass(context.Background(), jobs.Trash)
	first := *trashJob(r).Outcome
	_ = e.snaps.SetAutoUpdate(context.Background(), false)
	_ = r.Pass(context.Background(), jobs.Trash) // nothing requested, the daily check off: it says nothing
	if o := trashJob(r).Outcome; o == nil || o.Kind != jobs.OutcomeUpdated || o.At != first.At {
		t.Errorf("outcome = %+v, want the first one kept", o)
	}
}

// languageChange is a Primary Language change that records what ran.
type languageChange struct {
	saved   []string
	current string
}

func (l *languageChange) change(lang string) jobs.LanguageChange {
	return jobs.LanguageChange{
		Language: lang,
		Apply: func(context.Context) error {
			l.saved = append(l.saved, l.current)
			l.current = lang
			return nil
		},
		Undo: func(context.Context) error { l.current = l.saved[len(l.saved)-1]; return nil },
	}
}

func TestAPrimaryLanguageChangeIsSavedAndReScoredTogetherInTheJob(t *testing.T) {
	e := newTrashEnv(t)
	lc := &languageChange{current: "en"}
	e.updates.OnRequest(func() {})
	e.updates.ChangeLanguage(context.Background(), lc.change("de"))
	if lc.current != "en" || len(e.rescored) != 0 {
		t.Fatalf("language = %s, re-scores = %d: nothing happens before the pass", lc.current, len(e.rescored))
	}
	if got, ok := e.updates.PendingLanguage(); !ok || got != "de" {
		t.Errorf("pending = %q, %v, want de", got, ok)
	}
	e.during = func([]int64, func(int)) {
		if lc.current != "de" {
			t.Errorf("language = %s during the re-score, want the new one saved in the same step", lc.current)
		}
	}
	r := e.trashRunner()
	if err := r.Pass(context.Background(), jobs.Trash); err != nil {
		t.Fatal(err)
	}
	if lc.current != "de" || len(e.rescored) != 1 || e.rescored[0].under != e.holder.Current() {
		t.Errorf("language = %s, re-scores = %d", lc.current, len(e.rescored))
	}
	if _, ok := e.updates.PendingLanguage(); ok {
		t.Error("still pending after the pass")
	}
	if o := trashJob(r).Outcome; o == nil || o.Kind != jobs.OutcomeRescored {
		t.Errorf("outcome = %+v, want rescored", o)
	}
}

func TestAFailedLanguageReScoreLeavesTheLanguageAsItWas(t *testing.T) {
	e := newTrashEnv(t)
	lc := &languageChange{current: "en"}
	e.updates.OnRequest(func() {})
	e.updates.ChangeLanguage(context.Background(), lc.change("de"))
	e.failWith = errors.New("disk full")
	r := e.trashRunner()
	if err := r.Pass(context.Background(), jobs.Trash); err == nil {
		t.Fatal("the pass succeeded")
	}
	if lc.current != "en" {
		t.Errorf("language = %s, want en: a failed re-score changes no setting", lc.current)
	}
	if _, ok := e.updates.PendingLanguage(); ok {
		t.Error("still pending after the failed pass")
	}
	if o := trashJob(r).Outcome; o == nil || o.Kind != jobs.OutcomeFailed {
		t.Errorf("outcome = %+v, want failed", o)
	}
}

func TestASecondLanguageChangeReplacesThePendingOne(t *testing.T) {
	e := newTrashEnv(t)
	lc := &languageChange{current: "en"}
	e.updates.OnRequest(func() {})
	e.updates.ChangeLanguage(context.Background(), lc.change("de"))
	e.updates.ChangeLanguage(context.Background(), lc.change("fr"))
	if got, _ := e.updates.PendingLanguage(); got != "fr" {
		t.Errorf("pending = %q, want fr", got)
	}
	if err := e.trashRunner().Pass(context.Background(), jobs.Trash); err != nil {
		t.Fatal(err)
	}
	if lc.current != "fr" || len(lc.saved) != 1 || len(e.rescored) != 1 {
		t.Errorf("language = %s, saves = %d, re-scores = %d, want one pass under fr", lc.current, len(lc.saved), len(e.rescored))
	}
}

func TestALanguageChangeDuringAReScoreRunsAgain(t *testing.T) {
	e := newTrashEnv(t)
	lc := &languageChange{current: "en"}
	e.updates.OnRequest(func() {})
	e.updates.ChangeLanguage(context.Background(), lc.change("de"))
	first := true
	e.during = func([]int64, func(int)) {
		if first {
			first = false
			e.updates.ChangeLanguage(context.Background(), lc.change("fr"))
			if got, _ := e.updates.PendingLanguage(); got != "fr" {
				t.Errorf("pending = %q during the pass, want the newer fr", got)
			}
		}
	}
	r := e.trashRunner()
	_ = r.Pass(context.Background(), jobs.Trash)
	if lc.current != "de" {
		t.Fatalf("language = %s after the first pass, want de", lc.current)
	}
	_ = r.Pass(context.Background(), jobs.Trash)
	if lc.current != "fr" || len(e.rescored) != 2 {
		t.Errorf("language = %s, re-scores = %d, want fr after a second pass", lc.current, len(e.rescored))
	}
}

func TestApplyLanguageSavesAndReScoresBeforeReturning(t *testing.T) {
	e := newTrashEnv(t)
	lc := &languageChange{current: "en"}
	if err := e.updates.ApplyLanguage(context.Background(), lc.change("de")); err != nil {
		t.Fatal(err)
	}
	if lc.current != "de" || len(e.rescored) != 1 {
		t.Errorf("language = %s, re-scores = %d", lc.current, len(e.rescored))
	}
	e.failWith = errors.New("disk full")
	if err := e.updates.ApplyLanguage(context.Background(), lc.change("fr")); err == nil || lc.current != "de" {
		t.Errorf("err = %v, language = %s, want a failure that keeps de", err, lc.current)
	}
}

// tierBundle is a set with one Custom Format, WEB Tier 01 at score, in the profile that backs an English HD Profile
// for Movies.
func tierBundle(commit string, at time.Time, score int) fstest.MapFS {
	m := trashBundle(commit, at)
	m["radarr/cf/tier1.json"] = &fstest.MapFile{Data: []byte(fmt.Sprintf(
		`{"trash_id":"tier1","name":"WEB Tier 01","trash_scores":{"default":%d},"specifications":[{"name":"FLUX","implementation":"ReleaseGroupSpecification","fields":{"value":"^(FLUX)$"}}]}`, score))}
	m["radarr/quality-profiles/hd-bluray-web.json"] = &fstest.MapFile{Data: []byte(
		`{"trash_id":"hd","items":[{"name":"WEBDL-1080p","allowed":true}],"formatItems":{"WEB Tier 01":"tier1"}}`)}
	return m
}

func (e *trashEnv) entries(t *testing.T, kinds ...history.Kind) []history.Event {
	t.Helper()
	evs, err := e.hist.List(context.Background(), history.Filter{Kinds: kinds})
	if err != nil {
		t.Fatal(err)
	}
	return evs
}

type trashData struct {
	From, To, Commit, Cause string
	CompareURL              string `json:"compare_url"`
	Changes                 []scoring.TrashChange
	Unused                  int
	Commits                 []trashsync.Commit
	ReasonsUnavailable      bool `json:"reasons_unavailable"`
	Library                 struct {
		Up, Down, Cutoff int
		Wanted           []string
	}
}

func dataOf(t *testing.T, ev history.Event) trashData {
	t.Helper()
	var d trashData
	if err := json.Unmarshal(ev.Data, &d); err != nil {
		t.Fatal(err)
	}
	return d
}

func newTierEnv(t *testing.T) *trashEnv {
	t.Helper()
	e := newTrashEnv(t)
	e.holder = scoring.NewHolder(loadSnapshot(t, tierBundle("old", trashNow.AddDate(0, 0, -10), 1700)))
	e.rebuild()
	e.src.ref = trashsync.Ref{Commit: "new", CommittedAt: trashNow}
	e.src.files = tierBundle("new", trashNow, 1750)
	return e
}

func TestATrashUpdateWritesOneEntryWithWhatChangedWhyAndWhatItDid(t *testing.T) {
	e := newTierEnv(t)
	e.src.commits = []trashsync.Commit{{SHA: "c1", Message: "Raise WEB Tier 01"}}
	e.summary = imports.RescoreSummary{Up: 10, Down: 2, Wanted: []string{"Dune (2021)"}, Cutoff: 3}
	ctx := history.WithTrigger(context.Background(), history.Job(history.TriggerJob, "trash"))
	if _, err := e.updates.Update(ctx); err != nil {
		t.Fatal(err)
	}
	evs := e.entries(t, history.TrashUpdated)
	if len(evs) != 1 {
		t.Fatalf("%d entries, want one", len(evs))
	}
	ev := evs[0]
	if want := "TRaSH update old → new: 1 changed, 12 files re-scored, 1 Title Wanted"; ev.Message != want {
		t.Errorf("message = %q, want %q", ev.Message, want)
	}
	if ev.Routine || ev.Trigger.Kind != history.TriggerJob || ev.Reason == "" {
		t.Errorf("entry = %+v", ev)
	}
	d := dataOf(t, ev)
	if len(d.Changes) != 1 || d.Changes[0].Text != "WEB Tier 01: 1700 → 1750 in HD" || len(d.Changes[0].Commits) != 1 || d.Changes[0].Commits[0] != "c1" {
		t.Errorf("changes = %+v", d.Changes)
	}
	if d.From != "old" || d.To != "new" || len(d.Commits) != 1 || d.ReasonsUnavailable || !strings.HasSuffix(d.CompareURL, "/compare/old...new") {
		t.Errorf("data = %+v", d)
	}
	if d.Library.Up != 10 || d.Library.Down != 2 || d.Library.Cutoff != 3 || len(d.Library.Wanted) != 1 {
		t.Errorf("library = %+v", d.Library)
	}
}

func TestATrashUpdateIsRecordedWithoutReasonsWhenGitHubCannotSayThem(t *testing.T) {
	e := newTierEnv(t)
	e.src.commitsErr = errors.New("offline")
	if _, err := e.updates.Update(context.Background()); err != nil {
		t.Fatal(err)
	}
	evs := e.entries(t, history.TrashUpdated)
	if len(evs) != 1 {
		t.Fatalf("%d entries, want one", len(evs))
	}
	if d := dataOf(t, evs[0]); !d.ReasonsUnavailable || len(d.Changes) != 1 || d.CompareURL == "" {
		t.Errorf("data = %+v", d)
	}
}

func TestUpdateFromTrashIsRecordedAsThePersonWhoAskedForIt(t *testing.T) {
	e := newTierEnv(t)
	r := e.trashRunner()
	e.updates.RequestUpdate(history.WithTrigger(context.Background(), history.Person("navi", "UpdateTrash")))
	if err := r.Pass(context.Background(), jobs.Trash); err != nil {
		t.Fatal(err)
	}
	evs := e.entries(t, history.TrashUpdated)
	if len(evs) != 1 || evs[0].Trigger.Kind != history.TriggerPerson || evs[0].Trigger.Actor != "navi" {
		t.Errorf("entries = %+v", evs)
	}
}

func TestAlreadyUpToDateWritesNothing(t *testing.T) {
	e := newTierEnv(t)
	e.src.ref = trashsync.Ref{Commit: "old", CommittedAt: trashNow.AddDate(0, 0, -10)}
	if _, err := e.updates.Update(context.Background()); err != nil {
		t.Fatal(err)
	}
	if evs := e.entries(t, history.TrashUpdated, history.TrashRejected); len(evs) != 0 {
		t.Errorf("entries = %+v", evs)
	}
}

func TestARejectedTrashUpdateIsAWarningWithItsCommitCauseAndDiff(t *testing.T) {
	e := newTierEnv(t)
	e.failWith = errors.New("profile german-hd no longer resolves")
	if _, err := e.updates.Update(context.Background()); !errors.Is(err, trashsync.ErrRejected) {
		t.Fatalf("err = %v", err)
	}
	evs := e.entries(t, history.TrashRejected)
	if len(evs) != 1 || history.SeverityOf(evs[0].Kind) != history.Warning || evs[0].Routine {
		t.Fatalf("entries = %+v", evs)
	}
	d := dataOf(t, evs[0])
	if d.Commit != "new" || !strings.Contains(d.Cause, "german-hd") || len(d.Changes) != 1 {
		t.Errorf("data = %+v", d)
	}
	if len(e.entries(t, history.TrashUpdated)) != 0 {
		t.Error("a rejected update was recorded as an update")
	}

	// A set that does not load is rejected with its cause and no diff.
	e.failWith = nil
	e.src.ref = trashsync.Ref{Commit: "broken", CommittedAt: trashNow.Add(time.Hour)}
	e.src.files = fstest.MapFS{"COMMIT": {Data: []byte("broken")}}
	_, _ = e.updates.Update(context.Background())
	evs = e.entries(t, history.TrashRejected)
	if len(evs) != 2 {
		t.Fatalf("%d rejections, want 2", len(evs))
	}
	if d := dataOf(t, evs[0]); d.Commit != "broken" || d.Cause == "" || len(d.Changes) != 0 {
		t.Errorf("data = %+v", d)
	}
}

func TestTheStartupReScoreUnderANewerBundledSetIsATrashUpdate(t *testing.T) {
	e := newTierEnv(t)
	ctx := context.Background()
	if _, err := e.updates.Update(ctx); err != nil { // the files are scored under "new", which is kept
		t.Fatal(err)
	}
	e.bundled = tierBundle("bundled", trashNow.Add(time.Hour), 1800)
	e.holder = scoring.NewHolder(loadSnapshot(t, e.bundled))
	e.rebuild()
	if err := e.updates.Start(history.WithTrigger(ctx, history.Job(history.TriggerStartup, ""))); err != nil {
		t.Fatal(err)
	}
	evs := e.entries(t, history.TrashUpdated)
	if len(evs) != 2 || evs[0].Trigger.Kind != history.TriggerStartup {
		t.Fatalf("entries = %+v", evs)
	}
	if d := dataOf(t, evs[0]); d.From != "new" || d.To != "bundled" || len(d.Changes) != 1 || d.Changes[0].Text != "WEB Tier 01: 1750 → 1800 in HD" {
		t.Errorf("data = %+v", d)
	}

	// The bundled set is kept, so the next version's can be compared with it.
	e.bundled = tierBundle("next", trashNow.Add(2*time.Hour), 1900)
	e.holder = scoring.NewHolder(loadSnapshot(t, e.bundled))
	e.rebuild()
	if err := e.updates.Start(history.WithTrigger(ctx, history.Job(history.TriggerStartup, ""))); err != nil {
		t.Fatal(err)
	}
	if d := dataOf(t, e.entries(t, history.TrashUpdated)[0]); d.From != "bundled" || len(d.Changes) != 1 {
		t.Errorf("data = %+v", d)
	}
}

func TestTheFirstStartWritesNoTrashUpdate(t *testing.T) {
	e := newTierEnv(t)
	if err := e.updates.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if evs := e.entries(t, history.TrashUpdated); len(evs) != 0 {
		t.Errorf("entries = %+v", evs)
	}
}

func TestAStartupUpdateFromASetThatWasNotKeptSaysWhatChangedIsNotKnown(t *testing.T) {
	e := newTierEnv(t)
	ctx := context.Background()
	e.snaps.NoteScored(ctx, "gone") // scored under a set nobody kept
	if err := e.updates.Start(ctx); err != nil {
		t.Fatal(err)
	}
	evs := e.entries(t, history.TrashUpdated)
	if len(evs) != 1 || evs[0].Message != "TRaSH update gone → old: what changed isn't known" {
		t.Fatalf("entries = %+v", evs)
	}
}
