package fake_test

import (
	"testing"

	"github.com/hyprsh/kestrel/internal/plugin"
	"github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1/conformance"
	"github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1/fake"
)

func TestFakePassesTheConformanceSuite(t *testing.T) {
	c := fake.New("secret")
	conformance.Run(t, conformance.Subject{
		Client:        c,
		Conn:          c.Conn(1),
		BadAuth:       plugin.Connection{ID: 1, Config: map[string]any{"api_key": "wrong"}},
		Unreachable:   plugin.Connection{ID: 1, Config: map[string]any{"api_key": "secret", "unreachable": true}},
		Backend:       c,
		Category:      "movies",
		OtherCategory: "tv",
	})
}
