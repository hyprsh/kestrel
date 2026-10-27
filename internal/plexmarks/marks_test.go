package plexmarks_test

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/plexmarks"
	"github.com/hyprsh/kestrel/internal/plexmarks/db"
	"github.com/hyprsh/kestrel/internal/plugin"
	mediaserver "github.com/hyprsh/kestrel/internal/plugin/mediaserver/v1"
	"github.com/hyprsh/kestrel/internal/requests"
	"github.com/hyprsh/kestrel/internal/store"
	"github.com/hyprsh/kestrel/internal/store/storetest"
)

// plexItem is one item of the fake Plex.
type plexItem struct {
	id, section string
	kind        mediaserver.TitleKind
	folder      string
	labels      []string
	posters     []string // keys; the first is the original
	selected    string
	inPlex      bool // false until the scan reaches it
}

// fakePlex is an in-memory Plex that remembers what was done to it.
type fakePlex struct {
	items       []*plexItem
	collections map[string]bool // by section key
	foreign     map[string]bool // collections by section that are not Kestrel's
	down        error
	writes      int
	uploads     [][]byte
	nextPoster  int
}

var _ mediaserver.Marker = (*fakePlex)(nil)

func (*fakePlex) Describe() plugin.Manifest { return plugin.Manifest{} }
func (*fakePlex) Test(context.Context, plugin.Connection) (plugin.TestResult, error) {
	return plugin.TestResult{}, nil
}
func (*fakePlex) ListOptions(context.Context, plugin.Connection, string) ([]plugin.Option, error) {
	return nil, nil
}
func (*fakePlex) Refresh(context.Context, plugin.Connection, []mediaserver.Change) error { return nil }

func (p *fakePlex) get(item mediaserver.Item) (*plexItem, error) {
	if p.down != nil {
		return nil, p.down
	}
	for _, it := range p.items {
		if it.id == item.ID && it.inPlex {
			return it, nil
		}
	}
	return nil, plugin.Errorf(plugin.CodeNotFound, "no item %s", item.ID)
}

func (p *fakePlex) FindItems(_ context.Context, _ plugin.Connection, refs []mediaserver.ItemRef) ([]mediaserver.FoundItem, error) {
	if p.down != nil {
		return nil, p.down
	}
	var out []mediaserver.FoundItem
	for i, r := range refs {
		for _, it := range p.items {
			if it.inPlex && it.folder == r.Path {
				out = append(out, mediaserver.FoundItem{Ref: i, Item: mediaserver.Item{ID: it.id, SectionKey: it.section, Kind: it.kind}})
			}
		}
	}
	return out, nil
}

func (p *fakePlex) AddLabels(_ context.Context, _ plugin.Connection, item mediaserver.Item, labels []string) ([]string, error) {
	it, err := p.get(item)
	if err != nil {
		return nil, err
	}
	var added []string
	for _, l := range labels {
		if !slices.Contains(it.labels, l) {
			it.labels = append(it.labels, l)
			added = append(added, l)
			p.writes++
		}
	}
	return added, nil
}

func (p *fakePlex) RemoveLabels(_ context.Context, _ plugin.Connection, item mediaserver.Item, labels []string) error {
	it, err := p.get(item)
	if err != nil {
		return err
	}
	for _, l := range labels {
		if i := slices.Index(it.labels, l); i >= 0 {
			it.labels = slices.Delete(it.labels, i, i+1)
			p.writes++
		}
	}
	return nil
}

func (p *fakePlex) EnsureCollection(_ context.Context, _ plugin.Connection, section, _, _ string) error {
	if p.down != nil {
		return p.down
	}
	if !p.collections[section] {
		p.collections[section] = true
		p.writes++
	}
	return nil
}

func (p *fakePlex) RemoveCollection(_ context.Context, _ plugin.Connection, section, _, _ string) error {
	if p.down != nil {
		return p.down
	}
	if p.collections[section] && !p.foreign[section] {
		delete(p.collections, section)
		p.writes++
	}
	return nil
}

func (p *fakePlex) Posters(_ context.Context, _ plugin.Connection, item mediaserver.Item) ([]mediaserver.Poster, error) {
	it, err := p.get(item)
	if err != nil {
		return nil, err
	}
	var out []mediaserver.Poster
	for _, k := range it.posters {
		out = append(out, mediaserver.Poster{Key: k, Selected: k == it.selected})
	}
	return out, nil
}

func (p *fakePlex) PosterImage(_ context.Context, _ plugin.Connection, item mediaserver.Item) (mediaserver.Image, error) {
	if _, err := p.get(item); err != nil {
		return mediaserver.Image{}, err
	}
	var buf bytes.Buffer
	img := image.NewRGBA(image.Rect(0, 0, 200, 300))
	for y := range 300 {
		for x := range 200 {
			img.Set(x, y, color.RGBA{R: 30, G: uint8(y), B: 120, A: 255})
		}
	}
	_ = png.Encode(&buf, img)
	return mediaserver.Image{ContentType: "image/png", Data: buf.Bytes()}, nil
}

func (p *fakePlex) UploadPoster(_ context.Context, _ plugin.Connection, item mediaserver.Item, img mediaserver.Image) (mediaserver.Poster, error) {
	it, err := p.get(item)
	if err != nil {
		return mediaserver.Poster{}, err
	}
	p.nextPoster++
	key := "upload://posters/" + string(rune('a'+p.nextPoster))
	it.posters = append(it.posters, key)
	it.selected = key
	p.uploads = append(p.uploads, img.Data)
	p.writes++
	return mediaserver.Poster{Key: key, Selected: true}, nil
}

func (p *fakePlex) SelectPoster(_ context.Context, _ plugin.Connection, item mediaserver.Item, key string) error {
	it, err := p.get(item)
	if err != nil {
		return err
	}
	it.selected = key
	p.writes++
	return nil
}

// ---- the rest of the harness ----

type source struct{ titles []requests.CompletedTitle }

func (s *source) CompletedTitles(context.Context) ([]requests.CompletedTitle, error) {
	return s.titles, nil
}

type harness struct {
	t    *testing.T
	st   *store.Store
	plex *fakePlex
	src  *source
	sw   plexmarks.Switches
	now  time.Time
	svc  *plexmarks.Service
}

var start = time.Date(2026, 10, 27, 12, 0, 0, 0, time.UTC)

func newHarness(t *testing.T) *harness {
	t.Helper()
	ctx := context.Background()
	st, err := store.Open(ctx, store.Options{Dir: storetest.Dir(t)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	if _, err := st.Write().ExecContext(ctx, `INSERT INTO plugin_instances (id, contract, plugin_id, name, config) VALUES (1, 'media_server.v1', 'plex', 'Plex', '{}')`); err != nil {
		t.Fatal(err)
	}
	h := &harness{t: t, st: st, src: &source{}, now: start, sw: plexmarks.Switches{Labels: true, PosterBadge: true, BadgeDays: 30},
		plex: &fakePlex{collections: map[string]bool{}, foreign: map[string]bool{}}}
	h.svc = plexmarks.New(plexmarks.Deps{
		Store: st, Source: h.src,
		Switches: func(context.Context) (plexmarks.Switches, error) { return h.sw, nil },
		Target: func(context.Context) (plexmarks.Target, bool, error) {
			return plexmarks.Target{InstanceID: 1, Server: h.plex}, true, nil
		},
		Clock: func() time.Time { return h.now },
	})
	return h
}

// request makes a Title requested, with its item in Plex or not yet.
func (h *harness) request(id int64, kind library.Kind, folder string, inPlex bool, who ...string) *plexItem {
	h.t.Helper()
	if _, err := h.st.Write().ExecContext(context.Background(), `INSERT INTO titles (id, kind, tmdb_id, title, original_title, primary_title, root_folder, folder, added_at, refreshed_at)
		VALUES (?, ?, ?, 'T', 'T', 'T', '/m', 'f', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`, id, string(kind), id); err != nil {
		h.t.Fatal(err)
	}
	h.src.titles = append(h.src.titles, requests.CompletedTitle{TitleID: id, Kind: kind, Folder: folder, Requesters: who})
	section, k := "1", mediaserver.KindMovie
	if kind == library.Series {
		section, k = "2", mediaserver.KindSeries
	}
	it := &plexItem{id: "r" + string(rune('0'+id)), section: section, kind: k, folder: folder, inPlex: inPlex,
		posters: []string{"metadata://orig"}, selected: "metadata://orig"}
	h.plex.items = append(h.plex.items, it)
	return it
}

func (h *harness) run() error {
	h.t.Helper()
	return h.svc.Run(context.Background())
}

func (h *harness) mustRun() {
	h.t.Helper()
	if err := h.run(); err != nil {
		h.t.Fatal(err)
	}
}

func (h *harness) marks() []db.PlexMark {
	h.t.Helper()
	rows, err := db.New(h.st.Read()).ListMarks(context.Background())
	if err != nil {
		h.t.Fatal(err)
	}
	return rows
}

func labelsOf(it *plexItem) string {
	s := slices.Clone(it.labels)
	slices.Sort(s)
	return strings.Join(s, "|")
}

func TestARequestedTitleInPlexGetsItsLabelsAndTheCollection(t *testing.T) {
	h := newHarness(t)
	h.sw.PosterBadge = false
	dune := h.request(1, library.Movie, "/m/Dune", true, "ellie", "joel")
	dune.labels = []string{"Family"}

	h.mustRun()

	if got := labelsOf(dune); got != "Family|Requested|Requested by ellie|Requested by joel" {
		t.Fatalf("labels %q", got)
	}
	if !h.plex.collections["1"] {
		t.Fatal("no collection in the movie section")
	}
	rows := h.marks()
	if len(rows) != 1 || rows[0].ItemID != dune.id || !rows[0].LabelledAt.Valid || rows[0].Labels != `["Requested","Requested by ellie","Requested by joel"]` {
		t.Fatalf("rows %+v", rows)
	}
}

func TestAPassThatFindsEverythingMarkedChangesNothing(t *testing.T) {
	h := newHarness(t)
	h.request(1, library.Movie, "/m/Dune", true, "ellie")
	h.mustRun()
	writes := h.plex.writes
	before := h.marks()

	h.now = h.now.Add(10 * time.Minute)
	h.mustRun()

	if h.plex.writes != writes {
		t.Fatalf("the second pass wrote to Plex %d more times", h.plex.writes-writes)
	}
	if after := h.marks(); len(after) != 1 || after[0] != before[0] {
		t.Fatalf("the row changed: %+v -> %+v", before, after)
	}
}

func TestATitleNotInPlexYetIsMarkedOnALaterPass(t *testing.T) {
	h := newHarness(t)
	dune := h.request(1, library.Movie, "/m/Dune", false, "ellie")

	h.mustRun()
	if len(h.marks()) != 0 || len(dune.labels) != 0 || len(h.plex.collections) != 0 {
		t.Fatalf("something was marked: %+v %v", h.marks(), dune.labels)
	}

	dune.inPlex = true // Plex's scan reached it
	h.mustRun()
	if labelsOf(dune) != "Requested|Requested by ellie" || len(h.marks()) != 1 {
		t.Fatalf("labels %q rows %d", labelsOf(dune), len(h.marks()))
	}
}

func TestAPlexOutageIsRetriedOnALaterPass(t *testing.T) {
	h := newHarness(t)
	dune := h.request(1, library.Movie, "/m/Dune", true, "ellie")
	h.plex.down = plugin.Errorf(plugin.CodeUnavailable, "Plex is down")

	if err := h.run(); err == nil {
		t.Fatal("the outage was not reported")
	}
	if len(h.marks()) != 0 {
		t.Fatalf("rows %+v", h.marks())
	}

	h.plex.down = nil
	h.mustRun()
	if labelsOf(dune) != "Requested|Requested by ellie" {
		t.Fatalf("labels %q", labelsOf(dune))
	}
}

func TestAnOutageInTheMiddleLeavesWhatWasDoneAndFinishesLater(t *testing.T) {
	h := newHarness(t)
	h.sw.PosterBadge = false
	a := h.request(1, library.Movie, "/m/A", true, "ellie")
	h.mustRun()
	b := h.request(2, library.Movie, "/m/B", true, "joel")
	h.plex.down = plugin.Errorf(plugin.CodeUnavailable, "down")
	if err := h.run(); err == nil {
		t.Fatal("no error")
	}
	h.plex.down = nil
	h.mustRun()
	if labelsOf(a) != "Requested|Requested by ellie" || labelsOf(b) != "Requested|Requested by joel" || len(h.marks()) != 2 {
		t.Fatalf("a %q b %q", labelsOf(a), labelsOf(b))
	}
}

func TestTheBadgeIsStampedForItsDaysAndTheOriginalPosterComesBack(t *testing.T) {
	h := newHarness(t)
	h.sw.Labels = false
	dune := h.request(1, library.Movie, "/m/Dune", true, "ellie")

	h.mustRun()
	if dune.selected == "metadata://orig" || len(h.plex.uploads) != 1 {
		t.Fatalf("selected %q, uploads %d", dune.selected, len(h.plex.uploads))
	}
	if !bytes.HasPrefix(h.plex.uploads[0], []byte("\xff\xd8")) {
		t.Fatal("the uploaded badge poster is not a JPEG")
	}
	row := h.marks()[0]
	if row.OriginalPoster.String != "metadata://orig" || row.BadgePoster.String != dune.selected || row.BadgeUntil.String != "2026-11-26T12:00:00Z" || row.BadgeAt.String != "2026-10-27T12:00:00Z" {
		t.Fatalf("row %+v", row)
	}
	if len(dune.labels) != 0 {
		t.Fatalf("labels %v with labels off", dune.labels)
	}

	h.now = start.AddDate(0, 0, 29)
	h.mustRun()
	if dune.selected == "metadata://orig" {
		t.Fatal("the badge came off early")
	}

	h.now = start.AddDate(0, 0, 30)
	h.mustRun()
	if dune.selected != "metadata://orig" {
		t.Fatalf("selected %q", dune.selected)
	}
	row = h.marks()[0]
	if row.OriginalPoster.Valid || row.BadgePoster.Valid || !row.BadgeAt.Valid {
		t.Fatalf("row after restore %+v", row)
	}

	h.now = start.AddDate(0, 0, 40)
	h.mustRun()
	if dune.selected != "metadata://orig" || len(h.plex.uploads) != 1 {
		t.Fatal("the Title was badged a second time")
	}
}

func TestAPosterChosenByHandIsKeptWhenTheBadgeComesOff(t *testing.T) {
	h := newHarness(t)
	h.sw.Labels = false
	dune := h.request(1, library.Movie, "/m/Dune", true, "ellie")
	h.mustRun()
	dune.posters = append(dune.posters, "upload://posters/mine")
	dune.selected = "upload://posters/mine"

	h.now = start.AddDate(0, 0, 31)
	h.mustRun()
	if dune.selected != "upload://posters/mine" {
		t.Fatalf("selected %q", dune.selected)
	}
	if row := h.marks()[0]; row.OriginalPoster.Valid || row.BadgePoster.Valid {
		t.Fatalf("row %+v", row)
	}
}

func TestSwitchingTheBadgeOffRestoresThePosterOnTheNextPass(t *testing.T) {
	h := newHarness(t)
	h.sw.Labels = false
	dune := h.request(1, library.Movie, "/m/Dune", true, "ellie")
	h.mustRun()

	h.sw.PosterBadge = false
	h.mustRun()
	if dune.selected != "metadata://orig" || len(h.marks()) != 0 {
		t.Fatalf("selected %q rows %d", dune.selected, len(h.marks()))
	}
}

func TestSwitchingLabelsOffTakesBackOnlyWhatKestrelAdded(t *testing.T) {
	h := newHarness(t)
	h.sw.PosterBadge = false
	dune := h.request(1, library.Movie, "/m/Dune", true, "ellie")
	dune.labels = []string{"Family", "Requested"} // somebody labelled it Requested before
	h.mustRun()
	if labelsOf(dune) != "Family|Requested|Requested by ellie" {
		t.Fatalf("labels %q", labelsOf(dune))
	}

	h.sw.Labels = false
	h.mustRun()
	if got := labelsOf(dune); got != "Family|Requested" {
		t.Fatalf("labels %q", got)
	}
	if len(h.marks()) != 0 || len(h.plex.collections) != 0 {
		t.Fatalf("rows %d collections %v", len(h.marks()), h.plex.collections)
	}
}

func TestACollectionKestrelDidNotMakeIsNotDeleted(t *testing.T) {
	h := newHarness(t)
	h.sw.PosterBadge = false
	h.request(1, library.Movie, "/m/Dune", true, "ellie")
	h.mustRun()
	h.plex.foreign["1"] = true

	h.sw.Labels = false
	h.mustRun()
	if !h.plex.collections["1"] {
		t.Fatal("the collection went")
	}
}

func TestEachSectionKeepsItsOwnCollection(t *testing.T) {
	h := newHarness(t)
	h.sw.PosterBadge = false
	h.request(1, library.Movie, "/m/Dune", true, "ellie")
	frieren := h.request(2, library.Series, "/tv/Frieren", true, "joel")
	h.mustRun()
	if !h.plex.collections["1"] || !h.plex.collections["2"] {
		t.Fatalf("collections %v", h.plex.collections)
	}

	frieren.inPlex = true
	h.src.titles = h.src.titles[:1] // the series' Request is gone
	h.mustRun()
	if !h.plex.collections["1"] || h.plex.collections["2"] {
		t.Fatalf("collections %v", h.plex.collections)
	}
	if labelsOf(frieren) != "" {
		t.Fatalf("labels %q", labelsOf(frieren))
	}
}

func TestANewRequesterIsAddedToAnAlreadyLabelledTitle(t *testing.T) {
	h := newHarness(t)
	h.sw.PosterBadge = false
	dune := h.request(1, library.Movie, "/m/Dune", true, "ellie")
	h.mustRun()
	h.src.titles[0].Requesters = []string{"ellie", "joel"}
	h.mustRun()
	if got := labelsOf(dune); got != "Requested|Requested by ellie|Requested by joel" {
		t.Fatalf("labels %q", got)
	}
}

func TestAnItemPlexNoLongerHasIsMarkedAgainWhenItComesBack(t *testing.T) {
	h := newHarness(t)
	h.sw.PosterBadge = false
	dune := h.request(1, library.Movie, "/m/Dune", true, "ellie")
	h.mustRun()
	dune.inPlex = false
	h.mustRun() // takes nothing to Plex: nothing to do, nothing fails
	if err := h.run(); err != nil {
		t.Fatal(err)
	}
	dune.inPlex, dune.labels = true, nil
	h.mustRun()
	if labelsOf(dune) != "Requested|Requested by ellie" {
		t.Fatalf("labels %q", labelsOf(dune))
	}
}

func TestWithBothSwitchesOffNothingIsAskedOfAnyone(t *testing.T) {
	h := newHarness(t)
	h.sw = plexmarks.Switches{}
	h.request(1, library.Movie, "/m/Dune", true, "ellie")
	h.mustRun()
	if h.plex.writes != 0 || len(h.marks()) != 0 {
		t.Fatal("something was marked")
	}
}

func TestAPassCutShortAfterTheUploadFindsItsBadgeAgain(t *testing.T) {
	h := newHarness(t)
	h.sw.Labels = false
	dune := h.request(1, library.Movie, "/m/Dune", true, "ellie")
	h.mustRun()
	badge := dune.selected
	if _, err := h.st.Write().ExecContext(context.Background(), `UPDATE plex_marks SET badge_poster = NULL`); err != nil {
		t.Fatal(err)
	}

	h.mustRun()
	if row := h.marks()[0]; row.BadgePoster.String != badge || row.OriginalPoster.String != "metadata://orig" || len(h.plex.uploads) != 1 {
		t.Fatalf("row %+v uploads %d", row, len(h.plex.uploads))
	}

	// and when the upload never happened, the poster is stamped again
	if _, err := h.st.Write().ExecContext(context.Background(), `UPDATE plex_marks SET badge_poster = NULL`); err != nil {
		t.Fatal(err)
	}
	dune.selected = "metadata://orig"
	h.mustRun()
	if len(h.plex.uploads) != 2 || h.marks()[0].BadgePoster.String != dune.selected {
		t.Fatalf("uploads %d, row %+v", len(h.plex.uploads), h.marks()[0])
	}
}
