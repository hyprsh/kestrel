package scoring_test

import (
	"os"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring"
)

// testMatchTimeout replaces the production 100 ms regex timeout (ADR 0006) for
// the whole test binary, both for Custom Format regexes and for the release
// parsers it calls, so parity and fixture tests do not fail under machine
// load. The pathological-regex test sets a short timeout itself.
const testMatchTimeout = 5 * time.Second

func TestMain(m *testing.M) {
	scoring.MatchTimeout = testMatchTimeout
	release.MatchTimeout = testMatchTimeout
	os.Exit(m.Run())
}
