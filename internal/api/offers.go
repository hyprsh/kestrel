package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/jobs"
	"github.com/hyprsh/kestrel/internal/library"
)

// offerToAPI is an Original Offer in API shape.
func offerToAPI(o acquire.Offer) oapi.OriginalOffer {
	out := oapi.OriginalOffer{
		TitleId: o.TitleID, Title: o.Title, VersionId: o.VersionID, Slot: slotToAPI(o.Slot), Profile: o.Profile,
		FoundAt: o.FoundAt, Dismissed: o.Dismissed, Releases: make([]oapi.OfferedRelease, 0, len(o.Releases)),
	}
	for _, r := range o.Releases {
		out.Releases = append(out.Releases, oapi.OfferedRelease{
			Name: r.Name, Indexer: r.Indexer, Score: r.Score, Size: r.Size, PublishedAt: r.PublishedAt, Season: r.Season, Pack: r.Pack,
			Episodes: append([]int{}, r.Episodes...),
		})
	}
	if len(o.Releases) > 0 {
		out.Release, out.Score = o.Releases[0].Name, o.Releases[0].Score
	}
	return out
}

// originals is the Originals available group of Needs attention: the offers
// that are not dismissed. Like Long Missing it sits outside the rail badge.
func (s *server) originals(ctx context.Context) (oapi.OriginalsAvailable, error) {
	out := oapi.OriginalsAvailable{Items: []oapi.OriginalOffer{}}
	all, err := s.acquire.Offers(ctx)
	if err != nil {
		return out, err
	}
	for _, o := range all {
		if !o.Dismissed {
			out.Items = append(out.Items, offerToAPI(o))
		}
	}
	out.Count = len(out.Items)
	return out, nil
}

// withOffers puts each Version's Original Offer on a Title's detail.
func (s *server) withOffers(ctx context.Context, d *oapi.TitleDetail) error {
	offers, err := s.acquire.OffersOfTitle(ctx, d.Id)
	if err != nil {
		return err
	}
	for i := range d.Versions {
		if o, ok := offers[d.Versions[i].Id]; ok {
			ov := offerToAPI(o)
			d.Versions[i].OriginalOffer = &ov
		}
	}
	return nil
}

func offerProblem(err error) error {
	switch {
	case errors.Is(err, library.ErrNotFound), errors.Is(err, library.ErrVersionNotFound):
		return problem(http.StatusNotFound, "not_found", "no such Version")
	case errors.Is(err, acquire.ErrNoOffer):
		return problem(http.StatusNotFound, "not_found", "the Version has no Original Offer")
	}
	return grabProblem(err)
}

func (s *server) AcceptOriginalOffer(ctx context.Context, r oapi.AcceptOriginalOfferRequestObject) (oapi.AcceptOriginalOfferResponseObject, error) {
	got, err := s.acquire.AcceptOffer(ctx, r.Id)
	if err != nil {
		return nil, offerProblem(err)
	}
	s.jobs.Kick(jobs.Poll) // follow the new Grabs right away
	out := oapi.OfferAccepted{Grabs: make([]oapi.Grab, 0, len(got.Grabs)), Failed: got.Failed}
	for _, g := range got.Grabs {
		out.Grabs = append(out.Grabs, grabToAPI(g))
	}
	return oapi.AcceptOriginalOffer201JSONResponse(out), nil
}

func (s *server) DismissOriginalOffer(ctx context.Context, r oapi.DismissOriginalOfferRequestObject) (oapi.DismissOriginalOfferResponseObject, error) {
	if err := s.acquire.DismissOffer(ctx, r.Id); err != nil {
		return nil, offerProblem(err)
	}
	return oapi.DismissOriginalOffer204Response{}, nil
}
