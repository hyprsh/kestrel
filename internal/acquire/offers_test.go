package acquire_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
	"github.com/hyprsh/kestrel/internal/slot"
)

// betterEnglish scores higher than hd1080 under a German HD Profile.
const betterEnglish = "Paddington.2014.1080p.AMZN.WEB-DL.DDP5.1.H.264-NTb"

// offering makes the household German and hd-primary offer English-only
// Releases of English-original Titles.
func (r *rig) offering(t *testing.T) {
	t.Helper()
	ctx := context.Background()
	ps := r.deps.Profiles.(*profiles.Service)
	de := profiles.German
	if _, err := ps.SetRegion(ctx, profiles.RegionPatch{Primary: &de}); err != nil {
		t.Fatal(err)
	}
	offer := scoring.OriginalOffer
	if _, err := ps.Patch(ctx, "hd-primary", profiles.Patch{OriginalLanguage: &offer}); err != nil {
		t.Fatal(err)
	}
}

// withHistory rebuilds the Service with a Log and returns a count of its events of a kind.
func (r *rig) withHistory(t *testing.T) func(history.Kind) int {
	t.Helper()
	hist := history.New(r.deps.Store, r.clock.Now, nil)
	r.deps.History = hist
	svc, err := acquire.New(r.deps)
	if err != nil {
		t.Fatal(err)
	}
	r.svc = svc
	return func(k history.Kind) int {
		events, _ := hist.After(context.Background(), 0, 1000)
		n := 0
		for _, e := range events {
			if e.Kind == k {
				n++
			}
		}
		return n
	}
}

func (r *rig) offers(t *testing.T) []acquire.Offer {
	t.Helper()
	out, err := r.svc.Offers(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestAnOriginalOnlyReleaseIsOfferedInsteadOfGrabbed(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	count := r.withHistory(t)
	r.offering(t)
	r.publish(t, hd1080, time.Hour)

	out, err := r.svc.SearchNew(ctx, r.titleID, r.wanted(t, slot.Standard))
	if err != nil || len(out.Grabbed) != 0 {
		t.Fatalf("outcome = %+v, %v: want nothing grabbed", out, err)
	}
	offers := r.offers(t)
	if len(offers) != 1 {
		t.Fatalf("offers = %+v", offers)
	}
	o := offers[0]
	if o.VersionID != r.versions[slot.Standard] || o.TitleID != r.titleID || o.Title != "Paddington" || o.Slot != slot.Standard ||
		o.Profile != "hd-primary" || o.Dismissed || len(o.Releases) != 1 || o.Releases[0].Name != hd1080 || o.Releases[0].Indexer != "Alpha" {
		t.Errorf("offer = %+v", o)
	}
	if byVersion, _ := r.svc.OffersOfTitle(ctx, r.titleID); byVersion[r.versions[slot.Standard]].Releases == nil {
		t.Errorf("the Title's offers = %+v", byVersion)
	}
	if count(history.OriginalOffered) != 1 {
		t.Error("no original_offered event")
	}

	// The same Release found again is no news.
	if _, err := r.svc.SearchNew(ctx, r.titleID, r.wanted(t, slot.Standard)); err != nil {
		t.Fatal(err)
	}
	if count(history.OriginalOffered) != 1 {
		t.Error("the same offer was logged twice")
	}
}

func TestOnlyAnOfferingProfileOffers(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.offering(t)
	reject := scoring.OriginalReject
	if _, err := r.deps.Profiles.(*profiles.Service).Patch(ctx, "hd-primary", profiles.Patch{OriginalLanguage: &reject}); err != nil {
		t.Fatal(err)
	}
	r.publish(t, hd1080, time.Hour)
	if _, err := r.svc.SearchNew(ctx, r.titleID, r.wanted(t, slot.Standard)); err != nil {
		t.Fatal(err)
	}
	if offers := r.offers(t); len(offers) != 0 {
		t.Errorf("offers = %+v", offers)
	}
}

func TestAPrimaryLanguageReleaseIsGrabbedAndTheOfferGoes(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.offering(t)
	r.publish(t, hd1080, time.Hour)
	if _, err := r.svc.SearchNew(ctx, r.titleID, r.wanted(t, slot.Standard)); err != nil {
		t.Fatal(err)
	}
	r.publish(t, german, time.Hour)

	out, err := r.svc.SyncRSS(ctx)
	if err != nil || len(out.Grabbed) != 1 || out.Grabbed[0].ReleaseName != german {
		t.Fatalf("RSS = %+v, %v", out, err)
	}
	if offers := r.offers(t); len(offers) != 0 {
		t.Errorf("offers = %+v, want none once a Primary-Language Release is grabbed", offers)
	}
}

func TestAcceptGrabsTheOfferedReleaseHoweverOldTheOffer(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.offering(t)
	r.publish(t, hd1080, time.Hour)
	if _, err := r.svc.SearchNew(ctx, r.titleID, r.wanted(t, slot.Standard)); err != nil {
		t.Fatal(err)
	}
	r.clock.now = r.clock.now.Add(3 * 24 * time.Hour) // long past the candidate cache

	got, err := r.svc.AcceptOffer(ctx, r.versions[slot.Standard])
	if err != nil || got.Failed != 0 || len(got.Grabs) != 1 {
		t.Fatalf("accept = %+v, %v", got, err)
	}
	g := got.Grabs[0]
	if g.ReleaseName != hd1080 || !g.Overridden || g.VersionID != r.versions[slot.Standard] {
		t.Errorf("grab = %+v, want the offered Release, overridden", g)
	}
	if offers := r.offers(t); len(offers) != 0 {
		t.Errorf("offers = %+v after accepting", offers)
	}
	if _, err := r.svc.AcceptOffer(ctx, r.versions[slot.Standard]); !errors.Is(err, acquire.ErrNoOffer) {
		t.Errorf("a second accept: %v, want ErrNoOffer", err)
	}
}

func TestAcceptingAReleaseTheIndexerLostDropsTheOffer(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.offering(t)
	r.publish(t, hd1080, time.Hour)
	if _, err := r.svc.SearchNew(ctx, r.titleID, r.wanted(t, slot.Standard)); err != nil {
		t.Fatal(err)
	}
	r.idx.Remove(hd1080)

	_, err := r.svc.AcceptOffer(ctx, r.versions[slot.Standard])
	if !errors.Is(err, acquire.ErrReleaseGone) {
		t.Fatalf("accept: %v, want ErrReleaseGone", err)
	}
	if offers := r.offers(t); len(offers) != 0 {
		t.Errorf("offers = %+v, want the dead one dropped", offers)
	}
}

func TestADismissedOfferStaysDismissedUntilABetterOriginalComes(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.offering(t)
	ver := r.versions[slot.Standard]
	if err := r.svc.DismissOffer(ctx, ver); !errors.Is(err, acquire.ErrNoOffer) {
		t.Fatalf("dismissing nothing: %v", err)
	}
	r.publish(t, hd1080, time.Hour)
	if _, err := r.svc.SearchNew(ctx, r.titleID, []int64{ver}); err != nil {
		t.Fatal(err)
	}
	if err := r.svc.DismissOffer(ctx, ver); err != nil {
		t.Fatal(err)
	}
	if o := r.offers(t); len(o) != 1 || !o[0].Dismissed {
		t.Fatalf("offers = %+v, want one dismissed", o)
	}
	// Found again: still dismissed.
	if _, err := r.svc.SearchNew(ctx, r.titleID, []int64{ver}); err != nil {
		t.Fatal(err)
	}
	if o := r.offers(t); len(o) != 1 || !o[0].Dismissed {
		t.Fatalf("offers = %+v, want it still dismissed", o)
	}

	r.publish(t, betterEnglish, time.Hour)
	if _, err := r.svc.SearchNew(ctx, r.titleID, []int64{ver}); err != nil {
		t.Fatal(err)
	}
	o := r.offers(t)
	if len(o) != 1 || o[0].Dismissed || o[0].Releases[0].Name != betterEnglish {
		t.Errorf("offers = %+v, want the better Release offered again", o)
	}
}

func TestASeriesOfferListsItsEpisodesAndAcceptGrabsThemAll(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.offering(t)
	id, ver := r.nightShow(t, library.MonitorAll)
	r.publishShow(t, nightEp1, "1", "1")
	r.publishShow(t, nightEp2, "1", "2")

	out, err := r.svc.SearchNew(ctx, id, []int64{ver})
	if err != nil || len(out.Grabbed) != 0 {
		t.Fatalf("outcome = %+v, %v", out, err)
	}
	var o acquire.Offer
	for _, x := range r.offers(t) {
		if x.VersionID == ver {
			o = x
		}
	}
	if len(o.Releases) != 2 {
		t.Fatalf("offer = %+v, want two episode Releases", o)
	}
	for _, rel := range o.Releases {
		if rel.Season == nil || *rel.Season != 1 || len(rel.Episodes) != 1 || rel.Pack {
			t.Errorf("release = %+v", rel)
		}
	}

	got, err := r.svc.AcceptOffer(ctx, ver)
	if err != nil || len(got.Grabs) != 2 {
		t.Fatalf("accept = %+v, %v", got, err)
	}
	for _, g := range got.Grabs {
		if eps, _ := r.svc.GrabEpisodes(ctx, g.ID); len(eps) != 1 || !g.Overridden {
			t.Errorf("grab %s covers %v, overridden %v", g.ReleaseName, eps, g.Overridden)
		}
	}
}

func TestAnAcceptedOriginalIsReplacedByAnyPrimaryLanguageRelease(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.offering(t)
	if _, err := r.lib.ReplaceFile(ctx, r.titleID, "Paddington (2014)", library.NewFile{
		VersionID: r.versions[slot.Standard], Path: "/m/p.mkv", Size: 1, ReleaseName: hd1080, Score: 100000, Original: true,
	}); err != nil {
		t.Fatal(err)
	}
	r.publishPlain(t, german)

	out, err := r.svc.SyncRSS(ctx)
	if err != nil || len(out.Grabbed) != 1 || out.Grabbed[0].ReleaseName != german || !out.Grabbed[0].IsUpgrade {
		t.Fatalf("RSS = %+v, %v: want the German Release despite its lower Score", out, err)
	}
}
