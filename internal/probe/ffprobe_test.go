package probe_test

import (
	"errors"
	"testing"

	"github.com/hyprsh/kestrel/internal/probe"
)

func TestNewFFprobeReportsMissingBinary(t *testing.T) {
	t.Setenv("PATH", t.TempDir()) // no ffprobe anywhere on PATH
	if _, err := probe.NewFFprobe(); !errors.Is(err, probe.ErrNotInstalled) {
		t.Fatalf("NewFFprobe() error = %v, want ErrNotInstalled", err)
	}
}
