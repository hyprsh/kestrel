package probe_test

import (
	"testing"

	"github.com/hyprsh/kestrel/internal/probe"
)

func TestResolutionClass(t *testing.T) {
	cases := []struct {
		name          string
		width, height int
		want          probe.Class
	}{
		{"UHD by width", 3840, 1608, probe.UHD},  // 2.39:1 scope UHD
		{"UHD by height", 2600, 1800, probe.UHD}, // height threshold
		{"HD by width", 1920, 804, probe.HD},     // 2.39:1 scope HD
		{"HD by height", 1000, 700, probe.HD},    // height threshold
		{"HD 1080p", 1920, 1080, probe.HD},
		{"SD 576p", 720, 576, probe.SD},
		{"SD just below width threshold", 1199, 699, probe.SD},
		{"SD 480p", 720, 480, probe.SD},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := probe.ClassOf(tc.width, tc.height); got != tc.want {
				t.Fatalf("ClassOf(%d, %d) = %v, want %v", tc.width, tc.height, got, tc.want)
			}
		})
	}
}
