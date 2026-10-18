package rootfolders_test

import (
	"errors"
	"testing"

	"github.com/hyprsh/kestrel/internal/settings/rootfolders"
)

func TestPickTakesTheNamedRootFolderOrTheKindsFirst(t *testing.T) {
	f := rootfolders.Folders{Movies: []string{"/m1", "/m2"}, Series: []string{"/tv"}}

	cases := []struct {
		kind      rootfolders.Kind
		requested string
		want      string
		err       error
	}{
		{rootfolders.Movie, "", "/m1", nil},
		{rootfolders.Movie, "/m2", "/m2", nil}, // a named folder wins
		{rootfolders.Movie, "/tv", "", rootfolders.ErrNotConfigured},
		{rootfolders.Series, "", "/tv", nil},
	}
	for _, c := range cases {
		got, err := f.Pick(c.kind, c.requested)
		if got != c.want || !errors.Is(err, c.err) {
			t.Errorf("Pick(%v, %q) = %q, %v; want %q, %v", c.kind, c.requested, got, err, c.want, c.err)
		}
	}
	if _, err := (rootfolders.Folders{}).Pick(rootfolders.Series, ""); !errors.Is(err, rootfolders.ErrNoneSet) {
		t.Errorf("no folders: %v", err)
	}
}
