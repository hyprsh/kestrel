package release

import (
	"os"
	"testing"
	"time"
)

// testMatchTimeout replaces the production 100 ms regex timeout (ADR 0006) for
// the whole test binary, so parity and golden tests do not fail under machine
// load. Tests that check timeout behaviour set a short MatchTimeout themselves.
const testMatchTimeout = 5 * time.Second

func TestMain(m *testing.M) {
	MatchTimeout = testMatchTimeout
	os.Exit(m.Run())
}
