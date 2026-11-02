package slot

import "strings"

// MatchLabel picks the Slot whose label, or else whose alias, equals text
// ignoring case (ADR 0024). A label wins over another Slot's alias. The
// second result is false when no Slot matches, which Adoption treats as no label.
func MatchLabel(set []Record, aliases map[Slot][]string, text string) (Slot, bool) {
	if text == "" {
		return "", false
	}
	for _, r := range set {
		if strings.EqualFold(r.Label, text) {
			return r.ID, true
		}
	}
	for _, r := range set {
		for _, a := range aliases[r.ID] {
			if strings.EqualFold(a, text) {
				return r.ID, true
			}
		}
	}
	return "", false
}
