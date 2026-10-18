package notices_test

import (
	"os"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/notices"
	"github.com/hyprsh/kestrel/internal/release"
)

// The notices credit the upstream commits the code was ported from and the
// TRaSH snapshot embedded in the binary. If a re-sync moves either, regenerate
// with scripts/gen-notices.sh.
func TestNoticesCreditThePortedCodeAndTheBundledData(t *testing.T) {
	commit, err := os.ReadFile("../scoring/trash/COMMIT")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{release.UpstreamRadarr, release.UpstreamSonarr, strings.TrimSpace(string(commit)), "GPL-3.0", "MIT License"} {
		if !strings.Contains(notices.Text, want) {
			t.Errorf("THIRD_PARTY_NOTICES.md lacks %q; run scripts/gen-notices.sh", want)
		}
	}
}
