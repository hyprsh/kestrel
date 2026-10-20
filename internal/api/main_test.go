package api_test

import (
	"os"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring"
)

// testMatchTimeout replaces the production 100 ms regex timeout (ADR 0006) for
// the whole test binary. The tests run in parallel under the race detector, and
// a parse or Custom Format match that timed out would count as no match.
const testMatchTimeout = 5 * time.Second

func TestMain(m *testing.M) {
	scoring.MatchTimeout = testMatchTimeout
	release.MatchTimeout = testMatchTimeout
	os.Exit(m.Run())
}
