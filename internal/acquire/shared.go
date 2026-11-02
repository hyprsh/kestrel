package acquire

import "slices"

// One Release can be the pick for several Versions of a Title: their Profiles may overlap, because the Slots are the
// admin's own (ADR 0024). Each Version is still decided on its own Profile; only the download is shared. The Grab
// belongs to the first Version and lists the others in grab_versions, and Import links the one file under each
// Version's own name.

// sharedPlans groups the plans of a Title by Release, in the order each Release first appears: the first plan of a
// group is the Version the Grab is made for, the rest are the Versions it also fills. A group holds a Slot once, so
// two plans of one Version for one Release stay two Grabs. For a Series each Version's plan covers its own episodes;
// the shared Grab covers the union and each Version's Import takes what it wants of them.
func sharedPlans(plans []GrabPlan) [][]GrabPlan {
	var out [][]GrabPlan
	at := map[string]int{}
	for _, p := range plans {
		k := entryKey(p.Candidate)
		if i, ok := at[k]; ok && !slices.ContainsFunc(out[i], func(q GrabPlan) bool { return q.Slot == p.Slot }) {
			out[i] = append(out[i], p)
			continue
		}
		at[k] = len(out)
		out = append(out, []GrabPlan{p})
	}
	return out
}
