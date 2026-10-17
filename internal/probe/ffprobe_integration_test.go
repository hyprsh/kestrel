//go:build ffprobe

// Run with `make test-ffprobe`. It needs ffmpeg and ffprobe on PATH, and skips
// itself when either is missing. CI installs neither separately: ubuntu-latest
// ships ffmpeg, and the Docker image has it too.
package probe_test

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/hyprsh/kestrel/internal/probe"
)

func requireTools(t *testing.T) {
	t.Helper()
	for _, bin := range []string{"ffmpeg", "ffprobe"} {
		if _, err := exec.LookPath(bin); err != nil {
			t.Skipf("%s not on PATH", bin)
		}
	}
}

// makeMKV muxes a short black video with the given size and one sine audio
// track per language tag. An empty tag leaves the track's language unset.
func makeMKV(t *testing.T, width, height int, langs ...string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "fixture.mkv")
	args := []string{"-v", "error", "-y",
		"-f", "lavfi", "-i", fmt.Sprintf("color=c=black:s=%dx%d:d=2:r=10", width, height),
	}
	for range langs {
		args = append(args, "-f", "lavfi", "-i", "sine=frequency=440:duration=2")
	}
	args = append(args, "-map", "0:v")
	for i := range langs {
		args = append(args, "-map", fmt.Sprintf("%d:a", i+1))
	}
	args = append(args, "-c:v", "mpeg4", "-c:a", "pcm_s16le")
	for i, lang := range langs {
		tag := lang
		if tag == "" {
			tag = "und"
		}
		args = append(args, fmt.Sprintf("-metadata:s:a:%d", i), "language="+tag)
	}
	args = append(args, path)
	if out, err := exec.Command("ffmpeg", args...).CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg: %v\n%s", err, out)
	}
	return path
}

func probeFile(t *testing.T, path string) probe.Info {
	t.Helper()
	p, err := probe.NewFFprobe()
	if err != nil {
		t.Fatal(err)
	}
	info, err := p.Probe(context.Background(), path)
	if err != nil {
		t.Fatalf("Probe(%s): %v", path, err)
	}
	return info
}

func TestRealProbeTaggedGermanAndEnglish(t *testing.T) {
	requireTools(t)
	info := probeFile(t, makeMKV(t, 1920, 1080, "ger", "eng"))

	if !info.HasVideo || info.Width != 1920 || info.Height != 1080 || info.Class() != probe.HD {
		t.Fatalf("video %dx%d class %v, has %v", info.Width, info.Height, info.Class(), info.HasVideo)
	}
	if info.Duration <= 0 || info.Size <= 0 {
		t.Fatalf("duration %v size %d", info.Duration, info.Size)
	}
	var langs []string
	for _, tr := range info.Audio {
		langs = append(langs, tr.Language)
	}
	if !reflect.DeepEqual(langs, []string{"deu", "eng"}) {
		t.Fatalf("audio languages = %v, want [deu eng]", langs)
	}
	got, inconclusive := probe.ResolveLanguages([]string{"deu"}, info.Audio)
	if inconclusive || !reflect.DeepEqual(got, []string{"deu", "eng"}) {
		t.Fatalf("ResolveLanguages = %v, inconclusive %v", got, inconclusive)
	}
}

func TestRealProbeUntaggedAudioIsInconclusive(t *testing.T) {
	requireTools(t)
	info := probeFile(t, makeMKV(t, 1920, 1080, ""))

	for _, tr := range info.Audio {
		if tr.Language != "" {
			t.Fatalf("untagged track reported language %q", tr.Language)
		}
	}
	got, inconclusive := probe.ResolveLanguages([]string{"deu"}, info.Audio)
	if !inconclusive || !reflect.DeepEqual(got, []string{"deu"}) {
		t.Fatalf("ResolveLanguages = %v, inconclusive %v; want parsed [deu], inconclusive", got, inconclusive)
	}
}

func TestRealProbeEnglishOnlyAgainstParsedGermanIsInconclusive(t *testing.T) {
	requireTools(t)
	info := probeFile(t, makeMKV(t, 1920, 1080, "eng"))

	got, inconclusive := probe.ResolveLanguages([]string{"deu"}, info.Audio)
	if !inconclusive || !reflect.DeepEqual(got, []string{"deu"}) {
		t.Fatalf("ResolveLanguages = %v, inconclusive %v; want parsed [deu], inconclusive", got, inconclusive)
	}
}

func TestRealProbeMultiAudioKeepsEveryTrack(t *testing.T) {
	requireTools(t)
	info := probeFile(t, makeMKV(t, 1920, 1080, "deu", "fra", "eng"))

	if len(info.Audio) != 3 {
		t.Fatalf("got %d audio tracks, want 3", len(info.Audio))
	}
	var langs []string
	for _, tr := range info.Audio {
		langs = append(langs, tr.Language)
	}
	if !reflect.DeepEqual(langs, []string{"deu", "fra", "eng"}) {
		t.Fatalf("audio languages = %v", langs)
	}
}

func TestRealProbeScopeSizesClassByWidthOrHeight(t *testing.T) {
	requireTools(t)
	cases := []struct {
		name          string
		width, height int
		want          probe.Class
	}{
		{"UHD scope by width", 3840, 1608, probe.UHD},
		{"HD scope by width", 1920, 804, probe.HD},
		{"SD", 720, 304, probe.SD},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			info := probeFile(t, makeMKV(t, tc.width, tc.height, "eng"))
			if info.Width != tc.width || info.Height != tc.height {
				t.Fatalf("probed %dx%d, want %dx%d", info.Width, info.Height, tc.width, tc.height)
			}
			if info.Class() != tc.want {
				t.Fatalf("Class() = %v, want %v", info.Class(), tc.want)
			}
		})
	}
}

func TestRealProbeUnreadableFileFails(t *testing.T) {
	requireTools(t)
	path := filepath.Join(t.TempDir(), "garbage.mkv")
	if err := os.WriteFile(path, []byte("this is not a video"), 0o644); err != nil {
		t.Fatal(err)
	}
	p, err := probe.NewFFprobe()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.Probe(context.Background(), path); err == nil {
		t.Fatal("garbage file probed without error")
	}
}
