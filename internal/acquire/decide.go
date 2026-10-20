// Package acquire decides what to grab. Decide is the pure core (PRD #22,
// Search, Grab and Upgrade): it takes the Versions a Title wants filled, what
// each holds and the scored candidates, and returns the Grabs to make. It does
// no I/O and reads nothing but its input, so the hosts that search (manual
// search, search on add, RSS, sweeps) build the input from the library and the
// indexers and hand the plans on.
package acquire

import (
	"cmp"
	"slices"
	"time"

	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/slot"
)

// Slot is a Version's Slot.
type Slot = slot.Slot

// MinUpgradeFormatScore is how much higher a Release must score than a fitting
// file to replace it (TRaSH's minUpgradeFormatScore). It never applies to a
// file that no longer fits its Profile.
const MinUpgradeFormatScore = 1

// RejectOtherSlot says a Release fits a different Slot than the Version asked
// about. Unlike the codes Evaluate gives, it is computed here and is not
// overridable in manual search.
const RejectOtherSlot scoring.Rejection = "other_slot"

// EpisodeRef names one episode. The zero value is the one unit of a Movie.
type EpisodeRef struct{ Season, Episode int }

// Held is a file a Version already has for one unit.
type Held struct {
	// Fits is false for a misfit: a file that no longer meets its Profile's
	// hard rules, for instance after a Profile switch. Any fitting Release
	// replaces it whatever the Scores.
	Fits bool
	// Score is the file's Score under the Version's Profile. Unused when !Fits.
	Score int
}

// Unit is something a Version wants a file for: the Movie, or a monitored,
// released episode. A unit without a file is missing (Held nil).
type Unit struct {
	Ref  EpisodeRef
	Held *Held
	// Unlisted marks an episode TheTVDB does not list yet that qualifies for a
	// Placeholder Episode: only a Release naming it, and not Unqualified, plans it.
	Unlisted bool
}

// Version is a Version to consider: its Slot and the units it wants.
type Version struct {
	Slot  Slot
	Units []Unit
}

// Candidate is a Release found by a search or RSS, scored by the host.
type Candidate struct {
	// GUID and the indexer identify the Release; Decide only passes them on.
	GUID      string
	IndexerID string
	// Parsed is the parsed name. A nil Series means a Movie release.
	Parsed release.ParsedRelease
	// ClassKnown is true when the Release's resolution is SD, HD or UHD. A
	// known class a Version's Profile does not accept makes the Release
	// other_slot for that Version, whether or not the Title has a Version for
	// the class it does fit.
	ClassKnown bool
	// Verdicts holds the Evaluate result under the Profile of each Version the
	// Title has, keyed by that Version's Slot. Whether the Release fits a
	// Version is the Verdict's business: a Profile accepts the resolution
	// classes whose range lies inside its heights (Settled 2), so an SD
	// Release fits an Any Version (0-1080, in the Standard Slot) but not an HD one.
	Verdicts map[Slot]scoring.Verdict
	// PublishDate is when the Release was posted, Size its bytes and
	// IndexerPriority its indexer's priority (lower wins).
	PublishDate     time.Time
	Size            int64
	IndexerPriority int
	// IndexerGrabsPaused is set when the indexer's Grabs are paused; the
	// candidate is skipped.
	IndexerGrabsPaused bool
	// Unqualified is set when the Release names an episode TheTVDB does not
	// list that may not get a Placeholder Episode: it then plans none of the
	// unlisted episodes it names, only its listed ones.
	Unqualified bool
}

// Input is everything Decide looks at.
type Input struct {
	Versions   []Version
	Candidates []Candidate
	// SeasonsFinished marks seasons that have finished airing; only for those
	// is a season pack preferred over single episodes.
	SeasonsFinished map[int]bool
}

// GrabPlan is one Grab to make.
type GrabPlan struct {
	// Slot is the Version the Release is for.
	Slot      Slot
	Candidate Candidate
	// Covers lists the units the Grab improves, in order.
	Covers []EpisodeRef
	// Pack is true for a season pack.
	Pack bool
	// Upgrade is true when the Grab replaces a file that fits; false when it
	// only fills missing units or replaces misfits.
	Upgrade bool
}

// Fits reports whether the Release's resolution is one the Profile of the
// Version in slot accepts. A Version the candidate has no Verdict for is not
// fitted.
func Fits(slot Slot, c Candidate) bool {
	v, ok := c.Verdicts[slot]
	return ok && !v.Rejected(scoring.RejectResolution)
}

// Rejections says why the candidate cannot go to the Version in slot: only
// other_slot when its class is known but this Version's Profile does not
// accept it (never overridable), else the Verdict's own rejections.
func Rejections(slot Slot, c Candidate) []scoring.Rejection {
	if !Fits(slot, c) && c.ClassKnown {
		return []scoring.Rejection{RejectOtherSlot}
	}
	return c.Verdicts[slot].Rejections
}

// Decide chooses the Releases to grab, at most per Version and unit: the
// highest Score wins at once, ties go to the newer post, then the larger size,
// then the lower indexer priority. There is no delay.
//
// For Series, once a season has finished airing a season pack is preferred
// unless a single episode scores higher than the pack for some episode the
// pack would improve. A pack (or multi-episode release) never downgrades: with
// nothing missing or misfit to fill, its Score must beat or match every fitting
// file and beat at least one by the Upgrade threshold; one that fills a unit is
// planned for the units it improves, and the Import leaves the rest alone.
// Absolute-numbered, daily, multi-season and partial packs are not planned.
// Plans come out per Version in input order, ordered by first covered unit.
func Decide(in Input) []GrabPlan {
	var plans []GrabPlan
	for _, v := range in.Versions {
		plans = append(plans, decideVersion(in, v)...)
	}
	return plans
}

// option is a candidate eligible for a Version, with what it covers.
type option struct {
	c     Candidate
	score int
	pack  bool
	refs  []EpisodeRef
}

func decideVersion(in Input, v Version) []GrabPlan {
	units := map[EpisodeRef]*Unit{}
	var seasons []int
	for i := range v.Units {
		u := &v.Units[i]
		units[u.Ref] = u
		if !slices.Contains(seasons, u.Ref.Season) {
			seasons = append(seasons, u.Ref.Season)
		}
	}
	slices.Sort(seasons)

	var opts []option
	for _, c := range in.Candidates {
		if o, ok := eligible(c, v, units); ok {
			opts = append(opts, o)
		}
	}
	slices.SortStableFunc(opts, func(a, b option) int { return rank(a, b) })

	var plans []GrabPlan
	for _, season := range seasons {
		plans = append(plans, decideSeason(v, units, opts, season, in.SeasonsFinished[season])...)
	}
	slices.SortStableFunc(plans, func(a, b GrabPlan) int {
		return compareRef(a.Covers[0], b.Covers[0])
	})
	return plans
}

// eligible reports whether c can fill anything for v and what it covers.
func eligible(c Candidate, v Version, units map[EpisodeRef]*Unit) (option, bool) {
	if c.IndexerGrabsPaused {
		return option{}, false
	}
	verdict, ok := c.Verdicts[v.Slot]
	if !ok || !verdict.Accepted {
		return option{}, false
	}
	o := option{c: c, score: verdict.Score}
	s := c.Parsed.Series
	switch {
	case s == nil:
		o.refs = []EpisodeRef{{}}
	case c.Parsed.IsAbsoluteNumbering(), c.Parsed.IsDaily(), s.MultiSeason, s.PartialSeason, s.SeasonExtra:
		return option{}, false
	case s.FullSeason:
		o.pack = true
		for r := range units {
			if r.Season == s.Season {
				o.refs = append(o.refs, r)
			}
		}
	default:
		for _, e := range s.Episodes {
			o.refs = append(o.refs, EpisodeRef{s.Season, e})
		}
	}
	// Only units the Version wants count; an unlisted one only for a Release
	// that names it and whose unlisted episodes all qualify.
	o.refs = slices.DeleteFunc(o.refs, func(r EpisodeRef) bool {
		return units[r] == nil || (units[r].Unlisted && (o.pack || c.Unqualified))
	})
	slices.SortFunc(o.refs, compareRef)
	return o, len(o.refs) > 0
}

// rank orders options best first.
func rank(a, b option) int {
	return cmp.Or(
		cmp.Compare(b.score, a.score),
		b.c.PublishDate.Compare(a.c.PublishDate),
		cmp.Compare(b.c.Size, a.c.Size),
		cmp.Compare(a.c.IndexerPriority, b.c.IndexerPriority),
		cmp.Compare(a.c.GUID, b.c.GUID),
	)
}

func compareRef(a, b EpisodeRef) int {
	return cmp.Or(cmp.Compare(a.Season, b.Season), cmp.Compare(a.Episode, b.Episode))
}

// gains applies the Upgrade threshold and the no-downgrade rule to the refs the
// option would give a Version. It returns the units that improve, whether any
// replaces a fitting file, and false when the option must not be used.
//
// A release that fills a missing or misfit unit is worth having even when it
// scores below some other held file: the Import keeps those files and takes
// only the units the release improves. Only a release that fills nothing is
// refused for scoring below a held file, since it would be a downgrade.
func gains(score int, refs []EpisodeRef, units map[EpisodeRef]*Unit) (improved []EpisodeRef, upgrade, ok bool) {
	fills, loses := false, false
	for _, r := range refs {
		h := units[r].Held
		switch {
		case h == nil || !h.Fits:
			improved = append(improved, r)
			fills = true
		case score >= h.Score+MinUpgradeFormatScore:
			improved = append(improved, r)
			upgrade = true
		case score < h.Score:
			loses = true
		}
	}
	if loses && !fills {
		return nil, false, false
	}
	return improved, upgrade, len(improved) > 0
}

func decideSeason(v Version, units map[EpisodeRef]*Unit, opts []option, season int, finished bool) []GrabPlan {
	// Single and multi-episode releases, best first, each unit planned once.
	var singles []GrabPlan
	planned := map[EpisodeRef]int{}
	for _, o := range opts {
		if o.pack || o.refs[0].Season != season {
			continue
		}
		var refs []EpisodeRef
		for _, r := range o.refs {
			if _, done := planned[r]; !done {
				refs = append(refs, r)
			}
		}
		if len(refs) == 0 {
			continue
		}
		improved, upgrade, ok := gains(o.score, refs, units)
		if !ok {
			continue
		}
		for _, r := range improved {
			planned[r] = o.score
		}
		singles = append(singles, GrabPlan{Slot: v.Slot, Candidate: o.c, Covers: improved, Upgrade: upgrade})
	}

	// The best pack that is valid for this season.
	for _, o := range opts {
		if !o.pack || o.refs[0].Season != season {
			continue
		}
		improved, upgrade, ok := gains(o.score, o.refs, units)
		if !ok {
			continue
		}
		pack := []GrabPlan{{Slot: v.Slot, Candidate: o.c, Covers: improved, Pack: true, Upgrade: upgrade}}
		if !finished {
			// A pack before the season has aired is no preference, only a
			// fallback when no single episode can be had.
			if len(singles) == 0 {
				return pack
			}
			break
		}
		for _, r := range improved {
			if s, has := planned[r]; has && s > o.score {
				return singles // a single episode scores higher
			}
		}
		return pack
	}
	return singles
}
