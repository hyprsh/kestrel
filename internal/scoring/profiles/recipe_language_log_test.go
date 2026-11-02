package profiles_test

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/scoring/profiles"
)

// A Primary Language switch that leaves an unused Profile without a backing profile disables it: one log line each says so.
func TestDisablingAnUnusedProfileForAPrimaryLanguageSwitchIsLogged(t *testing.T) {
	s, st := newRig(t)
	var log bytes.Buffer
	s.UseLogger(slog.New(slog.NewTextHandler(&log, nil)))
	ctx := context.Background()
	remuxAndWeb(t, s)
	setSlotDefaults(t, st, "standard", "hd-original", "hd-original")
	setSlotDefaults(t, st, "4k", "4k-original", "4k-original")
	fr := profiles.French
	if _, err := s.SetRegion(ctx, profiles.RegionPatch{Primary: &fr}); err != nil {
		t.Fatal(err)
	}
	out := log.String()
	if n := strings.Count(out, "profile=4k-primary"); n != 1 {
		t.Errorf("the log names 4k-primary %d times, want once: %s", n, out)
	}
	if strings.Contains(out, "profile=hd-primary") {
		t.Errorf("the log names a Profile that kept its backing profile: %s", out)
	}
}
