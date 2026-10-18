package rootfolders_test

import (
	"errors"
	"testing"

	"github.com/hyprsh/kestrel/internal/settings/rootfolders"
)

func TestPickTakesTheNamedRootFolderOrTheKindsFirst(t *testing.T) {
	f := rootfolders.Folders{Movies: []string{"/m1", "/m2"}, Series: []string{"/tv"}}

	cases := []struct {
		series    bool
		requested string
		want      string
		err       error
	}{
		{false, "", "/m1", nil},
		{false, "/m2", "/m2", nil},
		{false, "/tv", "", rootfolders.ErrNotConfigured},
		{true, "", "/tv", nil},
	}
	for _, c := range cases {
		got, err := f.Pick(c.series, c.requested)
		if got != c.want || !errors.Is(err, c.err) {
			t.Errorf("Pick(%v, %q) = %q, %v; want %q, %v", c.series, c.requested, got, err, c.want, c.err)
		}
	}
	if _, err := (rootfolders.Folders{}).Pick(true, ""); !errors.Is(err, rootfolders.ErrNoneSet) {
		t.Errorf("no folders: %v", err)
	}
}
