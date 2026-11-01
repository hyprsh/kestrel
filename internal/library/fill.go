package library

import (
	"context"
	"time"

	"github.com/hyprsh/kestrel/internal/library/db"
)

// Fill is one Movie or episode that a Grab filled: when it was Imported and how long it had been Wanted.
type Fill struct {
	At   time.Time
	Took time.Duration
}

// FillTimes are the Movies and episodes that Grabs filled with an Import in [from, to), each with the
// time from when it became Wanted (the later of its release and the day its Version was added, as
// StateAt reads it) to the Import. Upgrades, and files that came in without a Grab (the Adoption of
// an existing Library), are not fills. A unit that was out only after it was Imported is left out.
func (s *Service) FillTimes(ctx context.Context, view View, from, to time.Time) ([]Fill, error) {
	q := db.New(s.st.Read())
	rows, err := q.ListGrabFilled(ctx, db.ListGrabFilledParams{FromAt: ts(from), ToAt: ts(to)})
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	versions, err := q.ListVersions(ctx)
	if err != nil {
		return nil, err
	}
	titles, err := q.ListTitles(ctx)
	if err != nil {
		return nil, err
	}
	dates, err := q.ListAllReleaseDates(ctx)
	if err != nil {
		return nil, err
	}
	allEps, err := q.ListEpisodes(ctx)
	if err != nil {
		return nil, err
	}
	firstFiled, err := q.ListFirstFiled(ctx)
	if err != nil {
		return nil, err
	}
	filed := filedOf(firstFiled)
	titleOf := map[int64]db.Title{}
	for _, t := range titles {
		titleOf[t.ID] = t
	}
	versionOf := map[int64]db.Version{}
	for _, v := range versions {
		versionOf[v.ID] = v
	}
	datesOf := map[int64][]db.TitleReleaseDate{}
	for _, d := range dates {
		datesOf[d.TitleID] = append(datesOf[d.TitleID], d)
	}
	epsOf := map[int64][]db.Episode{}
	for _, e := range allEps {
		epsOf[e.TitleID] = append(epsOf[e.TitleID], e)
	}
	released := map[int64]map[int64]*time.Time{} // Series Title -> episode -> released
	var out []Fill
	for _, r := range rows {
		v, ok := versionOf[r.VersionID]
		if !ok {
			continue
		}
		t := titleOf[v.TitleID]
		var at *time.Time
		if Kind(t.Kind) == Series {
			if released[t.ID] == nil {
				released[t.ID] = releasedOf(epsOf[t.ID], filed, airClockOf(t))
			}
			at = released[t.ID][r.EpisodeID]
		} else {
			at = movieReleased(releaseDatesOf(datesOf[t.ID]), view.Country, t.ReleaseSeenAt)
		}
		if at == nil {
			continue
		}
		wanted := parseTime(v.AddedAt)
		if at.After(wanted) {
			wanted = *at
		}
		done := parseTime(r.ImportedAt)
		if done.Before(wanted) {
			continue
		}
		out = append(out, Fill{At: done, Took: done.Sub(wanted)})
	}
	return out, nil
}
