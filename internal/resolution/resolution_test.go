package resolution_test

import (
	"testing"

	"github.com/hyprsh/kestrel/internal/resolution"
)

func TestOfSizeClassesAProbedFrame(t *testing.T) {
	cases := []struct {
		name          string
		width, height int
		want          resolution.Class
	}{
		{"UHD by width", 3840, 1608, resolution.UHD},
		{"UHD by height", 2600, 1800, resolution.UHD},
		{"HD by width", 1920, 804, resolution.HD},
		{"HD by height", 1000, 700, resolution.HD},
		{"SD just below the thresholds", 1199, 699, resolution.SD},
		{"SD 576p", 720, 576, resolution.SD},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := resolution.OfSize(tc.width, tc.height); got != tc.want {
				t.Fatalf("OfSize(%d, %d) = %v, want %v", tc.width, tc.height, got, tc.want)
			}
		})
	}
}

func TestOfHeightClassesAParsedResolution(t *testing.T) {
	cases := []struct {
		height int
		want   resolution.Class
		known  bool
	}{
		{360, resolution.SD, true},
		{480, resolution.SD, true},
		{576, resolution.SD, true},
		{720, resolution.HD, true},
		{1080, resolution.HD, true},
		{2160, resolution.UHD, true},
		{0, resolution.SD, false}, // unknown
	}
	for _, tc := range cases {
		got, known := resolution.OfHeight(tc.height)
		if known != tc.known || (known && got != tc.want) {
			t.Errorf("OfHeight(%d) = %v, %v; want %v, %v", tc.height, got, known, tc.want, tc.known)
		}
	}
}

func TestClassWithinProfileBounds(t *testing.T) {
	cases := []struct {
		class    resolution.Class
		min, max int
		want     bool
	}{
		{resolution.SD, 0, 576, true},
		{resolution.HD, 0, 576, false},
		{resolution.HD, 720, 1080, true},
		{resolution.SD, 720, 1080, false},
		{resolution.SD, 0, 1080, true}, // Any
		{resolution.HD, 0, 1080, true},
		{resolution.UHD, 0, 1080, false},
		{resolution.UHD, 2160, 2160, true},
		{resolution.HD, 2160, 2160, false},
	}
	for _, tc := range cases {
		if got := tc.class.Within(tc.min, tc.max); got != tc.want {
			t.Errorf("%v.Within(%d, %d) = %v, want %v", tc.class, tc.min, tc.max, got, tc.want)
		}
	}
}
