package version

import "testing"

func TestDefaults(t *testing.T) {
	if Version != "dev" || Commit != "" {
		t.Fatalf("a plain build reports %q %q, want dev and no commit", Version, Commit)
	}
}
