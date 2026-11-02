package acquire

// One Release can be the pick for several Versions of a Movie: their Profiles may overlap, because the Slots are the
// admin's own (ADR 0024). Each Version is still decided on its own Profile; only the download is shared. The Grab
// belongs to the first Version and lists the others in grab_versions, and Import links the one file under each
// Version's own name.

// sharedPlans groups the plans of a Movie by Release, in the order each Release first appears: the first plan of a
// group is the Version the Grab is made for, the rest are the Versions it also fills.
func sharedPlans(plans []GrabPlan) [][]GrabPlan {
	var out [][]GrabPlan
	at := map[string]int{}
	for _, p := range plans {
		k := entryKey(p.Candidate)
		i, ok := at[k]
		if !ok {
			at[k] = len(out)
			out = append(out, []GrabPlan{p})
			continue
		}
		out[i] = append(out[i], p)
	}
	return out
}
