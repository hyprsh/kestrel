package probe

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
)

// ErrNotInstalled means no ffprobe binary is on PATH. Imports stall on it
// rather than blocklisting the Release.
var ErrNotInstalled = errors.New("ffprobe not installed")

// Prober reads one video file. A non-nil error means the file is unreadable.
type Prober interface {
	Probe(ctx context.Context, path string) (Info, error)
}

// FFprobe runs the ffprobe binary found on PATH.
type FFprobe struct {
	bin string
}

// NewFFprobe finds ffprobe on PATH, or returns ErrNotInstalled.
func NewFFprobe() (*FFprobe, error) {
	bin, err := exec.LookPath("ffprobe")
	if err != nil {
		return nil, ErrNotInstalled
	}
	return &FFprobe{bin: bin}, nil
}

// Probe runs ffprobe on path and parses its JSON output.
func (f *FFprobe) Probe(ctx context.Context, path string) (Info, error) {
	cmd := exec.CommandContext(ctx, f.bin, "-v", "error", "-show_format", "-show_streams", "-of", "json", path)
	out, err := cmd.Output()
	if err != nil {
		return Info{}, fmt.Errorf("ffprobe %s: %w", path, err)
	}
	return ParseJSON(out)
}
