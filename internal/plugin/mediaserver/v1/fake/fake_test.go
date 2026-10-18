package fake_test

import (
	"testing"

	"github.com/hyprsh/kestrel/internal/plugin"
	"github.com/hyprsh/kestrel/internal/plugin/mediaserver/v1/conformance"
	"github.com/hyprsh/kestrel/internal/plugin/mediaserver/v1/fake"
)

func TestFakePassesTheConformanceSuite(t *testing.T) {
	s := fake.New("secret")
	conformance.Run(t, conformance.Subject{
		Server:      s,
		Conn:        s.Conn(1),
		BadAuth:     plugin.Connection{ID: 1, Config: map[string]any{"token": "wrong"}},
		Unreachable: plugin.Connection{ID: 1, Config: map[string]any{"token": "secret", "unreachable": true}},
		Backend:     s,
		Folder:      "/data/media/movies/Dune (2021) {tmdb-438631}",
		Unplaceable: fake.Unplaceable + "/Dune (2021)",
	})
}
