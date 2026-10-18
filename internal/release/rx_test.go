package release

import "testing"

// rx patterns compile on first use, so a bad pattern would only panic in
// production when its parser first runs. This compiles every pattern up front.
func TestEveryPatternCompiles(t *testing.T) {
	allRxMu.Lock()
	patterns := append([]*rx(nil), allRx...)
	allRxMu.Unlock()
	if len(patterns) < 50 {
		t.Fatalf("only %d patterns registered, want the parsers' full set", len(patterns))
	}
	for _, r := range patterns {
		func() {
			defer func() {
				if p := recover(); p != nil {
					t.Errorf("pattern %q does not compile: %v", r.pattern, p)
				}
			}()
			r.regexp()
		}()
	}
}
