package library

import "time"

// Unit is one thing a Version can hold or lack: a Movie, or one episode of a
// Series. Released is when it came out, nil when unknown: the release-date
// country's date for a Movie; for an episode its air date (a date, read as
// midnight UTC) or, without one, when a later episode was out (releasedOf).
type Unit struct {
	Monitored bool
	HasFile   bool
	Released  *time.Time
	AddedAt   time.Time
}

// StateAt (the spec's Wanted(now)) is the state of one Unit at now, and for a Wanted Unit since when it
// has been Wanted: the later of its release and the time its Version was added.
func StateAt(u Unit, now time.Time) (State, *time.Time) {
	switch {
	case u.HasFile:
		return Filled, nil
	case !u.Monitored:
		return Unmonitored, nil
	case u.Released == nil || u.Released.After(now):
		return Unreleased, nil
	}
	since := u.AddedAt
	if u.Released.After(since) {
		since = *u.Released
	}
	return Wanted, &since
}

// IsLongMissing is whether a Wanted Unit has been Wanted for more than
// LongMissingAfter.
func IsLongMissing(st State, since *time.Time, now time.Time) bool {
	return st == Wanted && since != nil && now.Sub(*since) > LongMissingAfter
}

// SeriesState folds the episodes of one Series Version into its state.
// Wanted if any monitored aired episode lacks a file (since: the earliest
// Wanted-since among them); else Filled if it holds any file; else Unreleased
// if something monitored is still to air; else Unmonitored.
func SeriesState(units []Unit, now time.Time) (State, *time.Time) {
	var since *time.Time
	held, unreleased := false, false
	for _, u := range units {
		held = held || u.HasFile
		st, s := StateAt(u, now)
		switch st {
		case Wanted:
			if since == nil || s.Before(*since) {
				since = s
			}
		case Unreleased:
			unreleased = true
		}
	}
	switch {
	case since != nil:
		return Wanted, since
	case held:
		return Filled, nil
	case unreleased:
		return Unreleased, nil
	}
	return Unmonitored, nil
}
