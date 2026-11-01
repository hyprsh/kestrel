package profiles_test

import (
	"context"
	"errors"
	"testing"

	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
	"github.com/hyprsh/kestrel/internal/settings"
	"github.com/hyprsh/kestrel/internal/store"
	"github.com/hyprsh/kestrel/internal/store/storetest"
)

func newRig(t *testing.T) (*profiles.Service, *store.Store) {
	t.Helper()
	st, err := store.Open(context.Background(), store.Options{Dir: storetest.Dir(t)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return profiles.New(st, settings.New(st)), st
}

func intp(n int) *int { return &n }

const gb = int64(1) << 30

func TestAnOverlayIsSavedAndReadBack(t *testing.T) {
	ctx := context.Background()
	s, _ := newRig(t)
	ov := scoring.Overlay{
		MinScore: intp(10), UpgradeUntil: intp(2500),
		Series:      scoring.KindOverlay{Cutoff: "WEBDL-1080p", Qualities: []scoring.QualityPref{{Name: "WEBDL-1080p", Accepted: true}, {Name: "Bluray-1080p", Accepted: false}}},
		EpisodeSize: scoring.SizeLimit{Min: gb, Max: 10 * gb}, MovieSize: scoring.SizeLimit{Max: 30 * gb},
	}
	got, err := s.Patch(ctx, "hd-primary", profiles.Patch{Overlay: &ov})
	if err != nil {
		t.Fatal(err)
	}
	if got.Overlay.UpgradeUntil == nil || *got.Overlay.UpgradeUntil != 2500 {
		t.Errorf("patched = %+v", got.Overlay)
	}
	read := byKey(t, s)["hd-primary"].Overlay
	if *read.MinScore != 10 || *read.UpgradeUntil != 2500 || read.Series.Cutoff != "WEBDL-1080p" || read.EpisodeSize.Max != 10*gb || read.MovieSize.Min != 0 || read.MovieSize.Max != 30*gb {
		t.Errorf("read back %+v", read)
	}
	if len(read.Series.Qualities) != 2 || read.Series.Qualities[1].Accepted {
		t.Errorf("qualities = %+v", read.Series.Qualities)
	}
	// Another Profile is untouched.
	if !byKey(t, s)["4k-primary"].Overlay.IsZero() {
		t.Error("the overlay leaked into another Profile")
	}

	sp, err := s.Resolve(ctx, byKey(t, s)["hd-primary"])
	if err != nil {
		t.Fatal(err)
	}
	if sp.MinScore(release.KindMovie) != 10 || sp.Cutoff(release.KindSeries) != "WEBDL-1080p" || sp.SizeLimit(release.KindSeries).Max != 10*gb {
		t.Error("the resolved Profile does not carry the overlay")
	}

	// An empty overlay puts everything back as TRaSH has it.
	if _, err := s.Patch(ctx, "hd-primary", profiles.Patch{Overlay: &scoring.Overlay{}}); err != nil {
		t.Fatal(err)
	}
	if !byKey(t, s)["hd-primary"].Overlay.IsZero() {
		t.Error("an empty overlay did not clear")
	}
}

func TestAnOverlayThatIsTrashsOwnListIsStoredAsNone(t *testing.T) {
	ctx := context.Background()
	s, _ := newRig(t)
	sp, err := s.Resolve(ctx, byKey(t, s)["hd-primary"])
	if err != nil {
		t.Fatal(err)
	}
	ov := scoring.Overlay{Series: scoring.KindOverlay{Qualities: sp.TrashLadder(release.KindSeries)}}
	got, err := s.Patch(ctx, "hd-primary", profiles.Patch{Overlay: &ov})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Overlay.Series.Qualities) != 0 {
		t.Errorf("TRaSH's own ladder was stored: %+v", got.Overlay.Series.Qualities)
	}
}

func TestAnOverlayIsRefusedWhenItContradictsItself(t *testing.T) {
	ctx := context.Background()
	s, _ := newRig(t)
	acc := func(names ...string) []scoring.QualityPref {
		var out []scoring.QualityPref
		for _, n := range names {
			out = append(out, scoring.QualityPref{Name: n, Accepted: true})
		}
		return out
	}
	for field, ov := range map[string]scoring.Overlay{
		"overlay.episode_size":     {EpisodeSize: scoring.SizeLimit{Min: 5 * gb, Max: gb}},
		"overlay.movie_size":       {MovieSize: scoring.SizeLimit{Min: 5 * gb, Max: gb}},
		"overlay.sizes":            {MovieSize: scoring.SizeLimit{Min: -1}},
		"overlay.series.qualities": {Series: scoring.KindOverlay{Qualities: acc("NoSuchQuality")}},
		"overlay.movies.cutoff":    {Movies: scoring.KindOverlay{Cutoff: "NoSuchQuality"}},
	} {
		_, err := s.Patch(ctx, "hd-primary", profiles.Patch{Overlay: &ov})
		wantField(t, err, field)
	}
	_, err := s.Patch(ctx, "hd-primary", profiles.Patch{Overlay: &scoring.Overlay{Series: scoring.KindOverlay{Qualities: acc("WEBDL-1080p", "WEBDL-1080p")}}})
	wantField(t, err, "overlay.series.qualities")
	_, err = s.Patch(ctx, "hd-primary", profiles.Patch{Overlay: &scoring.Overlay{Series: scoring.KindOverlay{Qualities: []scoring.QualityPref{{Name: "WEBDL-1080p"}}}}})
	wantField(t, err, "overlay.series.qualities")
	// A cutoff has to be a quality the Profile accepts.
	_, err = s.Patch(ctx, "hd-primary", profiles.Patch{Overlay: &scoring.Overlay{Series: scoring.KindOverlay{
		Qualities: []scoring.QualityPref{{Name: "WEBDL-1080p", Accepted: true}, {Name: "Bluray-1080p"}}, Cutoff: "Bluray-1080p"}}})
	wantField(t, err, "overlay.series.cutoff")
	if !byKey(t, s)["hd-primary"].Overlay.IsZero() {
		t.Error("a rejected overlay changed something")
	}
}

func TestNewProfileCopiesAnotherAndStartsEnabledButNeverDefault(t *testing.T) {
	ctx := context.Background()
	s, _ := newRig(t)
	if _, err := s.Patch(ctx, "hd-primary", profiles.Patch{Overlay: &scoring.Overlay{UpgradeUntil: intp(900)}}); err != nil {
		t.Fatal(err)
	}
	p, err := s.Create(ctx, "  Movies at 720  ", "hd-primary")
	if err != nil {
		t.Fatal(err)
	}
	if !p.Custom || p.Name != "Movies at 720" || !p.Enabled || p.DefaultMovies || p.DefaultSeries || p.Slot != byKey(t, s)["hd-primary"].Slot {
		t.Errorf("created %+v", p)
	}
	if p.Overlay.UpgradeUntil == nil || *p.Overlay.UpgradeUntil != 900 {
		t.Errorf("the copy lost the overlay: %+v", p.Overlay)
	}
	all, _ := s.List(ctx)
	if len(all) != 7 || all[6].Key != p.Key {
		t.Fatalf("List = %d Profiles, last %v", len(all), all[len(all)-1].Key)
	}
	// It can be renamed and changed on its own.
	renamed := "Other"
	if got, err := s.Patch(ctx, p.Key, profiles.Patch{Name: &renamed, Overlay: &scoring.Overlay{}}); err != nil || got.Name != "Other" || !got.Overlay.IsZero() {
		t.Fatalf("patch = %+v, %v", got, err)
	}
	if byKey(t, s)["hd-primary"].Overlay.UpgradeUntil == nil {
		t.Error("changing the copy changed the original")
	}
	// But it cannot be a default, and a builtin cannot be renamed.
	_, err = s.Patch(ctx, p.Key, profiles.Patch{DefaultMovies: yes()})
	wantField(t, err, "default_movies")
	_, err = s.Patch(ctx, "hd-primary", profiles.Patch{Name: &renamed})
	wantField(t, err, "name")
}

func TestNewProfileNeedsAFreeNameAndARealSource(t *testing.T) {
	ctx := context.Background()
	s, _ := newRig(t)
	for _, name := range []string{"", "   ", "hd", "HD ORIGINAL", string(make([]rune, 41))} {
		_, err := s.Create(ctx, name, "hd-primary")
		wantField(t, err, "name")
	}
	if _, err := s.Create(ctx, "Fine", "nope"); !errors.Is(err, profiles.ErrNotFound) {
		t.Errorf("unknown source: %v", err)
	}
	if _, err := s.Create(ctx, "Fine", "hd-primary"); err != nil {
		t.Fatal(err)
	}
	_, err := s.Create(ctx, "fine", "hd-primary")
	wantField(t, err, "name")
}

func TestOnlyAnUnusedCustomProfileCanBeDeleted(t *testing.T) {
	ctx := context.Background()
	s, st := newRig(t)
	if err := s.Delete(ctx, "hd-primary"); err == nil {
		t.Error("a builtin Profile was deleted")
	} else {
		wantField(t, err, "key")
	}
	if err := s.Delete(ctx, "nope"); !errors.Is(err, profiles.ErrNotFound) {
		t.Errorf("unknown: %v", err)
	}
	p, err := s.Create(ctx, "Mine", "hd-primary")
	if err != nil {
		t.Fatal(err)
	}
	title := addTitle(t, st, "movie")
	addVersion(t, st, title, p.Key)
	if err := s.Delete(ctx, p.Key); !errors.Is(err, profiles.ErrInUse) {
		t.Fatalf("a Profile a Version uses was deleted: %v", err)
	}
	q, _ := s.Create(ctx, "Unused", "hd-primary")
	if err := s.Delete(ctx, q.Key); err != nil {
		t.Fatal(err)
	}
	if _, ok := byKey(t, s)[q.Key]; ok {
		t.Error("still listed")
	}
	vs, err := s.Versions(ctx, p.Key)
	if err != nil || len(vs) != 1 || vs[0].TitleID != title {
		t.Errorf("Versions = %+v, %v", vs, err)
	}
}

func TestSettingAllProfilesFromTheConfigFileLeavesCustomOnesAlone(t *testing.T) {
	ctx := context.Background()
	s, _ := newRig(t)
	p, _ := s.Create(ctx, "Mine", "hd-primary")
	want := map[string]profiles.State{}
	for _, b := range profiles.Builtin() {
		want[b.Key] = profiles.State{Enabled: true, OriginalChoice: scoring.OriginalReject, DefaultMovies: b.DefaultMovies, DefaultSeries: b.DefaultSeries}
	}
	if err := s.SetAll(ctx, want); err != nil {
		t.Fatal(err)
	}
	got := byKey(t, s)[p.Key]
	if !got.Enabled || !got.Custom {
		t.Errorf("custom Profile = %+v", got)
	}
}

func TestFilesBelowTheCutoffAreCountedPerProfile(t *testing.T) {
	ctx := context.Background()
	s, st := newRig(t)
	if _, err := s.Patch(ctx, "hd-primary", profiles.Patch{Overlay: &scoring.Overlay{
		UpgradeUntil: intp(1000), Series: scoring.KindOverlay{Cutoff: "WEBDL-1080p"}, Movies: scoring.KindOverlay{Cutoff: "WEBDL-1080p"},
	}}); err != nil {
		t.Fatal(err)
	}
	q := func(name string) string { return `{"quality":{"quality":{"name":"` + name + `"}}}` }
	movie := addTitle(t, st, "movie")
	show := addTitle(t, st, "series")
	other := addTitle(t, st, "movie")
	mv := addVersion(t, st, movie, "hd-primary")
	sv := addVersion(t, st, show, "hd-primary")
	ov := addVersion(t, st, other, "4k-primary")       // no cutoff: never counted
	addFile(t, st, mv, 1500, q("WEBDL-1080p"), false)  // at the cutoff
	addFile(t, st, sv, 900, q("WEBDL-1080p"), false)   // Score short
	addFile(t, st, sv, 5000, q("WEBRip-1080p"), false) // quality short
	addFile(t, st, sv, 100, q("WEBRip-1080p"), true)   // a misfit is not counted
	addFile(t, st, ov, 1, q("WEBRip-1080p"), false)

	c, err := s.BelowCutoff(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if c.Total != 2 || c.ByProfile["hd-primary"] != 2 || c.ByProfile["4k-primary"] != 0 {
		t.Errorf("BelowCutoff = %+v", c)
	}
	// Per Version: the Series' two short files (no episodes linked: one each), none for the Movie at its cutoff.
	if c.ByVersion[sv] != 2 || c.ByVersion[mv] != 0 || c.ByVersion[ov] != 0 {
		t.Errorf("BelowCutoff by Version = %+v", c.ByVersion)
	}
}

// BelowCutoff answers from memory until something it reads changes: each of those changes makes the next call scan again.
func TestBelowCutoffIsKeptInMemoryAndRecomputedAfterEachChangeItReads(t *testing.T) {
	ctx := context.Background()
	s, st := newRig(t)
	holder := scoring.NewHolder(mustEmbedded(t))
	s.UseScoring(holder)
	if _, err := s.Patch(ctx, "hd-primary", profiles.Patch{Overlay: &scoring.Overlay{Movies: scoring.KindOverlay{Cutoff: "WEBDL-1080p"}}}); err != nil {
		t.Fatal(err)
	}
	q := func(name string) string { return `{"quality":{"quality":{"name":"` + name + `"}}}` }
	movie := addTitle(t, st, "movie")
	mv := addVersion(t, st, movie, "hd-primary")

	below := func(want int) {
		t.Helper()
		c, err := s.BelowCutoff(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if c.Total != want || c.ByVersion[mv] != want {
			t.Fatalf("BelowCutoff = %+v, want %d below", c, want)
		}
	}
	scans := func(want int64, why string) {
		t.Helper()
		if got := s.CutoffScans(); got != want {
			t.Fatalf("%s: %d scans, want %d", why, got, want)
		}
	}

	below(0)
	below(0)
	below(0)
	scans(1, "an unchanged library is answered from memory")

	addFile(t, st, mv, 100, q("WEBRip-1080p"), false) // an Import
	below(1)
	below(1)
	scans(2, "a file imported")

	mustExec(t, st, `UPDATE files SET score = 9000, parsed_release = ?`, q("WEBDL-1080p")) // a file replaced by a better one
	below(0)
	scans(3, "a file replaced")

	addFile(t, st, mv, 100, q("WEBRip-1080p"), false)
	below(1)
	scans(4, "a second file")
	mustExec(t, st, `DELETE FROM files WHERE score = 100`) // a file deleted
	below(0)
	scans(5, "a file deleted")

	addFile(t, st, mv, 100, q("WEBRip-1080p"), true) // a misfit does not count
	below(0)
	scans(6, "a misfit marked")

	if _, err := s.Patch(ctx, "hd-primary", profiles.Patch{Overlay: &scoring.Overlay{Movies: scoring.KindOverlay{Cutoff: "Bluray-1080p"}}}); err != nil { // a cutoff raised
		t.Fatal(err)
	}
	below(1) // the WEB-DL file is now below the cutoff
	scans(7, "a cutoff changed")

	mustExec(t, st, `UPDATE versions SET profile_key = '4k-primary', slot = '4k'`) // the Version moves to another Profile
	below(0)
	scans(8, "a Version's Profile changed")
	below(0)
	scans(8, "and then it is kept again")

	again := *mustEmbedded(t)
	holder.Set(&again) // a new scoring snapshot (new Scores)
	below(0)
	scans(9, "a scoring snapshot swapped")
}
