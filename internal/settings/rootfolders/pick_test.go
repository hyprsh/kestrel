package rootfolders_test

import (
	"errors"
	"testing"

	"github.com/hyprsh/kestrel/internal/settings/rootfolders"
)

func TestPickTakesTheNamedRootFolderOrTheKidsOneOrTheKindsFirst(t *testing.T) {
	f := rootfolders.Folders{Movies: []string{"/m1", "/kids"}, Series: []string{"/tv"}, KidsMovies: "/kids"}

	cases := []struct {
		kind      rootfolders.Kind
		requested string
		kids      bool
		want      string
		err       error
	}{
		{rootfolders.Movie, "", false, "/m1", nil},
		{rootfolders.Movie, "", true, "/kids", nil},
		{rootfolders.Movie, "/m1", true, "/m1", nil}, // a named folder wins
		{rootfolders.Movie, "/kids", false, "/kids", nil},
		{rootfolders.Movie, "/tv", false, "", rootfolders.ErrNotConfigured},
		{rootfolders.Series, "", false, "/tv", nil},
		{rootfolders.Series, "", true, "/tv", nil}, // no Kids Series folder set
	}
	for _, c := range cases {
		got, err := f.Pick(c.kind, c.requested, c.kids)
		if got != c.want || !errors.Is(err, c.err) {
			t.Errorf("Pick(%v, %q, %v) = %q, %v; want %q, %v", c.kind, c.requested, c.kids, got, err, c.want, c.err)
		}
	}
	if _, err := (rootfolders.Folders{}).Pick(rootfolders.Series, "", false); !errors.Is(err, rootfolders.ErrNoneSet) {
		t.Errorf("no folders: %v", err)
	}
}
