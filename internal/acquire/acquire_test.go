package acquire_test

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/downloads"
	"github.com/hyprsh/kestrel/internal/indexers"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/plugin"
	downloadclient "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1"
	dcfake "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1/fake"
	indexer "github.com/hyprsh/kestrel/internal/plugin/indexer/v1"
	ixfake "github.com/hyprsh/kestrel/internal/plugin/indexer/v1/fake"
	"github.com/hyprsh/kestrel/internal/plugin/instances"
	"github.com/hyprsh/kestrel/internal/resolution"
	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
	"github.com/hyprsh/kestrel/internal/settings"
	"github.com/hyprsh/kestrel/internal/store"
)

type clock struct{ now time.Time }

func (c *clock) Now() time.Time { return c.now }

type rig struct {
	svc      *acquire.Service
	lib      *library.Service
	idx      *ixfake.Indexer
	idxID    int64
	sab      *dcfake.Client
	clock    *clock
	titleID  int64
	versions map[resolution.Class]int64
	// deps rebuild a Service over the same rows, as after a restart.
	deps acquire.Deps
}

type secondIndexer struct{ *ixfake.Indexer }

func (secondIndexer) Describe() plugin.Manifest {
	m := ixfake.New("").Describe()
	m.ID = "fake_indexer_2"
	return m
}

var defaultProfiles = map[resolution.Class]string{resolution.SD: "sd-primary", resolution.HD: "hd-primary", resolution.UHD: "uhd-primary"}

func newRig(t *testing.T, slots ...resolution.Class) *rig {
	t.Helper()
	if len(slots) == 0 {
		slots = []resolution.Class{resolution.HD}
	}
	var specs []library.VersionSpec
	for _, s := range slots {
		specs = append(specs, library.VersionSpec{Slot: s, Profile: defaultProfiles[s]})
	}
	return newRigWith(t, specs...)
}

func newRigWith(t *testing.T, specs ...library.VersionSpec) *rig {
	t.Helper()
	ctx := context.Background()
	st, err := store.Open(ctx, store.Options{Dir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	clk := &clock{now: time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)}

	idx, sab := ixfake.New("k"), dcfake.New("k")
	reg := plugin.NewRegistry()
	for _, err := range []error{
		reg.Register(indexer.Contract, idx),
		reg.Register(indexer.Contract, secondIndexer{ixfake.New("k")}),
		reg.Register(downloadclient.Contract, sab),
	} {
		if err != nil {
			t.Fatal(err)
		}
	}
	inst := instances.NewService(st, reg)
	cfg := map[string]any{"api_key": "k"}
	ix, err := inst.Create(ctx, instances.New{PluginID: ixfake.ID, Name: "Alpha", Priority: 1, Config: cfg})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := inst.Create(ctx, instances.New{PluginID: dcfake.ID, Name: "SAB", Config: map[string]any{"api_key": "k", "movie_category": "films"}}); err != nil {
		t.Fatal(err)
	}

	lib := library.New(st, clk.Now)
	id, err := lib.AddMovie(ctx, library.AddMovie{Details: paddington(), PrimaryLanguage: "en", Versions: specs, RootFolder: "/data/media/movies"})
	if err != nil {
		t.Fatal(err)
	}
	d, err := lib.Get(ctx, id, library.View{Country: "US", Now: clk.Now()})
	if err != nil {
		t.Fatal(err)
	}
	versions := map[resolution.Class]int64{}
	for _, v := range d.Versions {
		versions[v.Slot] = v.ID
	}

	deps := acquire.Deps{
		Store: st, Clock: clk.Now, Library: lib, Profiles: profiles.New(st, settings.New(st)),
		Indexers: indexers.New(inst, clk.Now), Downloads: downloads.New(inst),
	}
	svc, err := acquire.New(deps)
	if err != nil {
		t.Fatal(err)
	}
	return &rig{svc: svc, lib: lib, idx: idx, idxID: ix.ID, sab: sab, clock: clk, titleID: id, versions: versions, deps: deps}
}

func paddington() metadata.MovieDetails {
	return metadata.MovieDetails{
		TMDBID: 116149, IMDbID: "tt1109624", Title: "Paddington", OriginalTitle: "Paddington", OriginalLanguage: "en", Year: 2014, Runtime: 95,
		ReleaseDates: metadata.ReleaseDates{{Country: "US", Type: metadata.Theatrical, Date: time.Date(2015, 1, 16, 0, 0, 0, 0, time.UTC), Certification: "PG"}},
		Translations: []metadata.Translation{{Language: "de", Country: "DE", Title: "Ein Bär namens Paddington"}},
	}
}

func (r *rig) publish(t *testing.T, name string, ago time.Duration) {
	t.Helper()
	err := r.idx.Publish(indexer.Release{
		Title: name, IMDBID: "tt1109624", TMDBID: 116149, Size: 8 << 30, PublishDate: r.clock.now.Add(-ago), Categories: []int{2040},
	}, []byte("<nzb>"+name+"</nzb>"))
	if err != nil {
		t.Fatal(err)
	}
}

const (
	hd1080 = "Paddington.2014.1080p.BluRay.x264-GRP"
	uhd    = "Paddington.2014.2160p.WEB-DL.x265-GRP"
	german = "Paddington.2014.GERMAN.1080p.BluRay.x264-GRP"
)

func (r *rig) found(t *testing.T, res acquire.SearchResult, name string) acquire.Found {
	t.Helper()
	for _, f := range res.Items {
		if f.Name == name {
			return f
		}
	}
	t.Fatalf("no release %q in %d results", name, len(res.Items))
	return acquire.Found{}
}

func codes(f acquire.Found) []scoring.Rejection {
	var out []scoring.Rejection
	for _, rj := range f.Rejections {
		out = append(out, rj.Code)
	}
	return out
}

func TestASearchScoresEveryReleaseAgainstTheVersionsProfile(t *testing.T) {
	r := newRig(t)
	r.publish(t, hd1080, time.Hour)
	r.publish(t, uhd, 2*time.Hour)
	r.publish(t, german, 3*time.Hour)

	res, err := r.svc.Search(context.Background(), r.versions[resolution.HD])
	if err != nil {
		t.Fatal(err)
	}

	if len(res.Items) != 3 || len(res.Failures) != 0 {
		t.Fatalf("result = %+v", res)
	}
	ok := r.found(t, res, hd1080)
	if ok.ID == "" || ok.Indexer != "Alpha" || ok.Fits != acquire.FitsThisSlot || len(ok.Rejections) != 0 || ok.Quality != "Bluray-1080p" || ok.Size != 8<<30 {
		t.Errorf("1080p release = %+v", ok)
	}
	if res.Items[0].Name != hd1080 {
		t.Errorf("first result is %q, want the acceptable one first", res.Items[0].Name)
	}
	other := r.found(t, res, uhd)
	if other.Fits != acquire.FitsOtherSlot || !slices.Equal(codes(other), []scoring.Rejection{acquire.RejectOtherSlot}) || other.Rejections[0].Overridable {
		t.Errorf("2160p release for a Title with only an HD Version = %+v, want other_slot, not overridable", other)
	}
	de := r.found(t, res, german)
	if de.Fits != acquire.FitsThisSlot || !slices.Contains(codes(de), scoring.RejectLanguage) || !de.Rejections[0].Overridable {
		t.Errorf("German release for an English household = %+v, want an overridable language rejection", de)
	}
}

func TestATextHitIsKeptOnlyWhenItIsTheSameTitle(t *testing.T) {
	r := newRig(t)
	for _, name := range []string{hd1080, "Paddington.Brown.2014.1080p.BluRay.x264-GRP"} {
		err := r.idx.Publish(indexer.Release{Title: name, Size: 8 << 30, PublishDate: r.clock.now.Add(-time.Hour), Categories: []int{2040}}, []byte("n"))
		if err != nil {
			t.Fatal(err)
		}
	}

	res, err := r.svc.Search(context.Background(), r.versions[resolution.HD])
	if err != nil {
		t.Fatal(err)
	}

	if len(res.Items) != 1 || res.Items[0].Name != hd1080 {
		t.Errorf("items = %+v, want only the release of this Title", res.Items)
	}
}

func TestEachVersionSeesTheSameReleasesFromItsOwnSlot(t *testing.T) {
	r := newRig(t, resolution.HD, resolution.UHD)
	r.publish(t, hd1080, time.Hour)
	r.publish(t, uhd, time.Hour)

	hd, err := r.svc.Search(context.Background(), r.versions[resolution.HD])
	if err != nil {
		t.Fatal(err)
	}
	u, err := r.svc.Search(context.Background(), r.versions[resolution.UHD])
	if err != nil {
		t.Fatal(err)
	}

	if r.found(t, hd, hd1080).Fits != acquire.FitsThisSlot || r.found(t, hd, uhd).Fits != acquire.FitsOtherSlot {
		t.Errorf("HD Version results = %+v", hd.Items)
	}
	if r.found(t, u, uhd).Fits != acquire.FitsThisSlot || r.found(t, u, hd1080).Fits != acquire.FitsOtherSlot {
		t.Errorf("UHD Version results = %+v", u.Items)
	}
}

func TestAnSDReleaseFitsBothTheSDAndTheKidsVersion(t *testing.T) {
	ctx := context.Background()
	r := newRigWith(t,
		library.VersionSpec{Slot: resolution.SD, Profile: "sd-primary"},
		library.VersionSpec{Slot: resolution.HD, Profile: "kids-primary"},
	)
	const sdRelease = "Paddington.2014.576p.BluRay.x264-GRP"
	r.publish(t, sdRelease, time.Hour)
	r.publish(t, uhd, time.Hour)

	for _, slot := range []resolution.Class{resolution.SD, resolution.HD} {
		res, err := r.svc.Search(ctx, r.versions[slot])
		if err != nil {
			t.Fatal(err)
		}
		f := r.found(t, res, sdRelease)
		if f.Fits != acquire.FitsThisSlot || len(f.Rejections) != 0 {
			t.Errorf("SD release for the %v Version = %+v, want it to fit", slot, f)
		}
		if _, err := r.svc.Grab(ctx, r.versions[slot], f.ID, false); err != nil {
			t.Errorf("grab for the %v Version: %v", slot, err)
		}
		if u := r.found(t, res, uhd); u.Fits != acquire.FitsOtherSlot {
			t.Errorf("2160p release for the %v Version = %+v, want other_slot", slot, u)
		}
	}
}

func TestSearchingAnUnknownVersionIsNotFound(t *testing.T) {
	r := newRig(t)
	if _, err := r.svc.Search(context.Background(), 999); !errors.Is(err, library.ErrNotFound) {
		t.Errorf("err = %v, want library.ErrNotFound", err)
	}
}

func TestGrabbingAReleaseSendsItsNZBToTheClientAndRecordsTheGrab(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.publish(t, hd1080, time.Hour)
	res, _ := r.svc.Search(ctx, r.versions[resolution.HD])
	f := r.found(t, res, hd1080)

	g, err := r.svc.Grab(ctx, r.versions[resolution.HD], f.ID, false)
	if err != nil {
		t.Fatal(err)
	}

	if g.State != "sent" || g.ReleaseName != hd1080 || g.ClientID == "" || g.VersionID != r.versions[resolution.HD] || g.TitleID != r.titleID || g.Score != f.Score || g.Overridden || g.IsUpgrade {
		t.Errorf("grab = %+v", g)
	}
	items, _ := r.sab.List(ctx, r.sab.Conn(0), "films")
	if len(items) != 1 || items[0].ClientID != g.ClientID || items[0].Name != hd1080 {
		t.Errorf("the client holds %+v, want the grabbed release in the Movie category", items)
	}
	again, err := r.svc.GetGrab(ctx, g.ID)
	if err != nil || again.ClientID != g.ClientID || again.State != "sent" {
		t.Errorf("GetGrab = %+v, %v", again, err)
	}
}

func TestGrabbingARejectedReleaseNeedsTheOverride(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.publish(t, german, time.Hour)
	res, _ := r.svc.Search(ctx, r.versions[resolution.HD])
	f := r.found(t, res, german)

	_, err := r.svc.Grab(ctx, r.versions[resolution.HD], f.ID, false)
	var rej *acquire.RejectedError
	if !errors.As(err, &rej) || rej.NotOverridable() || !slices.Contains(rej.Rejections, scoring.RejectLanguage) {
		t.Fatalf("err = %v, want an overridable rejection", err)
	}

	g, err := r.svc.Grab(ctx, r.versions[resolution.HD], f.ID, true)
	if err != nil || !g.Overridden {
		t.Fatalf("Grab anyway = %+v, %v", g, err)
	}
}

func TestAReleaseForAnotherSlotCanNeverBeGrabbed(t *testing.T) {
	ctx := context.Background()
	r := newRig(t) // an HD-only Title: a 2160p Release fits the UHD Slot, which it has no Version for
	r.publish(t, uhd, time.Hour)
	res, _ := r.svc.Search(ctx, r.versions[resolution.HD])
	f := r.found(t, res, uhd)

	for _, override := range []bool{false, true} {
		_, err := r.svc.Grab(ctx, r.versions[resolution.HD], f.ID, override)
		var rej *acquire.RejectedError
		if !errors.As(err, &rej) || !rej.NotOverridable() {
			t.Errorf("override=%v: err = %v, want a not-overridable rejection", override, err)
		}
	}
	if items, _ := r.sab.List(ctx, r.sab.Conn(0), ""); len(items) != 0 {
		t.Errorf("the client was sent %d jobs", len(items))
	}
}

func TestABlocklistedReleaseIsRejectedAndNeverGrabbable(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.publish(t, hd1080, time.Hour)
	res, _ := r.svc.Search(ctx, r.versions[resolution.HD])
	f := r.found(t, res, hd1080)
	if slices.Contains(codes(f), scoring.RejectBlocklisted) {
		t.Fatal("blocklisted before it was added")
	}
	if err := r.svc.Block(ctx, acquire.BlockEntry{ReleaseName: hd1080, IndexerID: r.idxID, GUID: f.GUID, PublishedAt: f.PublishedAt, Size: f.Size, Reason: "failed"}); err != nil {
		t.Fatal(err)
	}

	res, _ = r.svc.Search(ctx, r.versions[resolution.HD])
	f = r.found(t, res, hd1080)
	if !slices.Contains(codes(f), scoring.RejectBlocklisted) || f.Rejections[slices.Index(codes(f), scoring.RejectBlocklisted)].Overridable {
		t.Errorf("rejections = %+v, want blocklisted, not overridable", f.Rejections)
	}
	_, err := r.svc.Grab(ctx, r.versions[resolution.HD], f.ID, true)
	var rej *acquire.RejectedError
	if !errors.As(err, &rej) || !rej.NotOverridable() {
		t.Errorf("Grab anyway of a blocklisted release: err = %v", err)
	}
}

func TestABlocklistEntryAlsoCatchesTheSameReleaseFromAnotherIndexerWithinTwoMinutesAndTwoMegabytes(t *testing.T) {
	r := newRig(t)
	entry := func(idx int64, at time.Time, size int64) acquire.BlockEntry {
		return acquire.BlockEntry{ReleaseName: hd1080, IndexerID: idx, GUID: "elsewhere", PublishedAt: at, Size: size, Reason: "failed"}
	}
	r.publish(t, hd1080, time.Hour)
	res, _ := r.svc.Search(context.Background(), r.versions[resolution.HD])
	f := r.found(t, res, hd1080)

	for _, tc := range []struct {
		name    string
		entry   acquire.BlockEntry
		blocked bool
	}{
		{"within the window", entry(r.idxID+1, f.PublishedAt.Add(90*time.Second), f.Size+1<<20), true},
		{"posted too far apart", entry(r.idxID+1, f.PublishedAt.Add(3*time.Minute), f.Size), false},
		{"sizes too far apart", entry(r.idxID+1, f.PublishedAt, f.Size+3<<20), false},
		{"another title", acquire.BlockEntry{ReleaseName: "Other.2014.1080p.BluRay.x264-GRP", IndexerID: r.idxID + 1, GUID: "x", PublishedAt: f.PublishedAt, Size: f.Size, Reason: "failed"}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rr := newRig(t)
			rr.publish(t, hd1080, time.Hour)
			if err := rr.svc.Block(context.Background(), tc.entry); err != nil {
				t.Fatal(err)
			}
			res, _ := rr.svc.Search(context.Background(), rr.versions[resolution.HD])
			got := slices.Contains(codes(rr.found(t, res, hd1080)), scoring.RejectBlocklisted)
			if got != tc.blocked {
				t.Errorf("blocklisted = %v, want %v", got, tc.blocked)
			}
		})
	}
}

func TestAGrabNeedsAReleaseFromARecentSearch(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.publish(t, hd1080, time.Hour)
	res, _ := r.svc.Search(ctx, r.versions[resolution.HD])
	f := r.found(t, res, hd1080)

	if _, err := r.svc.Grab(ctx, r.versions[resolution.HD], "nope", false); !errors.Is(err, acquire.ErrReleaseExpired) {
		t.Errorf("unknown release: err = %v, want ErrReleaseExpired", err)
	}
	r.clock.now = r.clock.now.Add(6*time.Hour + time.Minute)
	if _, err := r.svc.Grab(ctx, r.versions[resolution.HD], f.ID, false); !errors.Is(err, acquire.ErrReleaseExpired) {
		t.Errorf("after six hours: err = %v, want ErrReleaseExpired", err)
	}
}

func TestAReleaseTheIndexerNoLongerHasIsGone(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.publish(t, hd1080, time.Hour)
	res, _ := r.svc.Search(ctx, r.versions[resolution.HD])
	f := r.found(t, res, hd1080)
	r.idx.Remove(hd1080)

	_, err := r.svc.Grab(ctx, r.versions[resolution.HD], f.ID, false)
	if !errors.Is(err, acquire.ErrReleaseGone) {
		t.Errorf("err = %v, want ErrReleaseGone", err)
	}
}

func TestASpentGrabBudgetSurfacesAsAPluginError(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.publish(t, hd1080, time.Hour)
	res, _ := r.svc.Search(ctx, r.versions[resolution.HD])
	f := r.found(t, res, hd1080)
	r.idx.Exhaust(plugin.LimitGrab, time.Minute)

	_, err := r.svc.Grab(ctx, r.versions[resolution.HD], f.ID, false)
	if pe := plugin.AsError(err); pe.Code != plugin.CodeRateLimited || pe.Limit != plugin.LimitGrab {
		t.Errorf("err = %v", err)
	}
}

func TestAReleaseFromAnotherTitlesSearchCannotBeGrabbedForThisVersion(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.publish(t, hd1080, time.Hour)
	res, _ := r.svc.Search(ctx, r.versions[resolution.HD])
	f := r.found(t, res, hd1080)

	if _, err := r.svc.Grab(ctx, 999, f.ID, false); !errors.Is(err, library.ErrNotFound) {
		t.Errorf("err = %v, want library.ErrNotFound", err)
	}
}
