package release

// ISO returns the ISO 639-1 code of an *arr language, or "" when it has none
// in the table (Unknown, Original, ...).
func (l Language) ISO() string {
	best := ""
	for code, v := range isoLanguages {
		if v.ID != l.ID || code == "nb" {
			continue
		}
		if best == "" || len(code) < len(best) || (len(code) == len(best) && code < best) {
			best = code
		}
	}
	return best
}
