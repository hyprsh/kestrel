package api_test

import (
	"fmt"
	"testing"
)

type offerJSON struct {
	TitleID   int64  `json:"title_id"`
	Title     string `json:"title"`
	VersionID int64  `json:"version_id"`
	Slot      string `json:"slot"`
	Profile   string `json:"profile"`
	Release   string `json:"release"`
	Score     int    `json:"score"`
	Dismissed bool   `json:"dismissed"`
	Releases  []struct {
		Name     string `json:"name"`
		Indexer  string `json:"indexer"`
		Season   *int   `json:"season"`
		Pack     bool   `json:"pack"`
		Episodes []int  `json:"episodes"`
	} `json:"releases"`
}

type attentionOffersJSON struct {
	Count     int `json:"count"`
	Originals struct {
		Count int         `json:"count"`
		Items []offerJSON `json:"items"`
	} `json:"originals"`
}

type titleOffersJSON struct {
	Versions []struct {
		ID            int64      `json:"id"`
		OriginalOffer *offerJSON `json:"original_offer"`
	} `json:"versions"`
}

const englishOnly = "Paddington.2014.1080p.BluRay.x264-GRP"

// newOffering is Paddington in a German household whose HD Profile offers
// English-only Releases, with one such Release offered for the Standard Version.
func newOffering(t *testing.T) search {
	t.Helper()
	s := newSearchBare(t)
	if r := s.valid("PATCH", "/settings", `{"language_region":{"primary_language":"de"}}`); r.Status != 200 {
		t.Fatalf("settings = %d %s", r.Status, r.Body)
	}
	s.trashPass(t)
	if r := s.valid("PATCH", "/profiles/hd-primary", `{"original_language":"offer"}`); r.Status != 200 {
		t.Fatalf("profile = %d %s", r.Status, r.Body)
	}
	s.publish(t, englishOnly)
	s.addPaddington(t)
	if r := s.valid("POST", fmt.Sprintf("/versions/%d/search", s.hd), ""); r.Status != 202 {
		t.Fatalf("search = %d %s", r.Status, r.Body)
	}
	eventually(t, "the offer", func() bool {
		return decode[attentionOffersJSON](t, s.valid("GET", "/attention", "")).Originals.Count == 1
	})
	return s
}

func TestAnOriginalOfferIsAGroupOfNeedsAttentionAndShowsOnTheVersion(t *testing.T) {
	t.Parallel()
	s := newOffering(t)

	a := decode[attentionOffersJSON](t, s.valid("GET", "/attention", ""))
	if a.Count != 0 || len(a.Originals.Items) != 1 {
		t.Fatalf("attention = %+v: the group sits outside the rail count", a)
	}
	o := a.Originals.Items[0]
	if o.TitleID != s.title || o.Title != "Paddington" || o.VersionID != s.hd || o.Slot != "standard" || o.Profile != "hd-primary" ||
		o.Release != englishOnly || o.Dismissed || len(o.Releases) != 1 || o.Releases[0].Indexer != "Alpha" || o.Releases[0].Season != nil {
		t.Errorf("offer = %+v", o)
	}

	d := decode[titleOffersJSON](t, s.valid("GET", fmt.Sprintf("/titles/%d", s.title), ""))
	for _, v := range d.Versions {
		if got := v.OriginalOffer != nil; got != (v.ID == s.hd) {
			t.Errorf("version %d original_offer = %+v", v.ID, v.OriginalOffer)
		}
	}
}

func TestADismissedOfferLeavesTheGroupButStaysOnTheVersion(t *testing.T) {
	t.Parallel()
	s := newOffering(t)
	if r := s.valid("POST", fmt.Sprintf("/versions/%d/original-offer/dismiss", s.uhd), ""); r.Status != 404 {
		t.Errorf("dismissing a Version without an offer = %d %s", r.Status, r.Body)
	}

	if r := s.valid("POST", fmt.Sprintf("/versions/%d/original-offer/dismiss", s.hd), ""); r.Status != 204 {
		t.Fatalf("dismiss = %d %s", r.Status, r.Body)
	}
	a := decode[attentionOffersJSON](t, s.valid("GET", "/attention", ""))
	if a.Originals.Count != 0 || len(a.Originals.Items) != 0 {
		t.Errorf("attention = %+v, want the dismissed offer out of the group", a)
	}
	d := decode[titleOffersJSON](t, s.valid("GET", fmt.Sprintf("/titles/%d", s.title), ""))
	for _, v := range d.Versions {
		if v.ID == s.hd && (v.OriginalOffer == nil || !v.OriginalOffer.Dismissed) {
			t.Errorf("version original_offer = %+v, want it dismissed", v.OriginalOffer)
		}
	}
}

func TestAcceptingAnOfferGrabsItsRelease(t *testing.T) {
	t.Parallel()
	s := newOffering(t)

	r := s.valid("POST", fmt.Sprintf("/versions/%d/original-offer/accept", s.hd), "")
	if r.Status != 201 {
		t.Fatalf("accept = %d %s", r.Status, r.Body)
	}
	got := decode[struct {
		Grabs  []grabJSON `json:"grabs"`
		Failed int        `json:"failed"`
	}](t, r)
	if got.Failed != 0 || len(got.Grabs) != 1 || got.Grabs[0].ReleaseName != englishOnly || !got.Grabs[0].Overridden {
		t.Errorf("accepted = %+v", got)
	}
	if a := decode[attentionOffersJSON](t, s.valid("GET", "/attention", "")); len(a.Originals.Items) != 0 {
		t.Errorf("attention = %+v after accepting", a)
	}
	if r := s.valid("POST", fmt.Sprintf("/versions/%d/original-offer/accept", s.hd), ""); r.Status != 404 {
		t.Errorf("a second accept = %d %s", r.Status, r.Body)
	}
}
