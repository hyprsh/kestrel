package fake_test

import (
	"testing"

	"github.com/hyprsh/kestrel/internal/plugin"
	"github.com/hyprsh/kestrel/internal/plugin/indexer/v1/conformance"
	"github.com/hyprsh/kestrel/internal/plugin/indexer/v1/fake"
)

func TestFakePassesTheConformanceSuite(t *testing.T) {
	i := fake.New("secret")
	conformance.Run(t, conformance.Subject{
		Indexer:     i,
		Conn:        i.Conn(1),
		BadAuth:     plugin.Connection{ID: 1, Config: map[string]any{"api_key": "wrong"}},
		Unreachable: plugin.Connection{ID: 1, Config: map[string]any{"api_key": "secret", "unreachable": true}},
		Backend:     i,
	})
}
