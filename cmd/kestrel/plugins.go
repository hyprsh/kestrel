package main

import (
	"github.com/hyprsh/kestrel/internal/plugin"
	"github.com/hyprsh/kestrel/internal/plugin/adapters/newznab"
	"github.com/hyprsh/kestrel/internal/plugin/adapters/sabnzbd"
	downloadclient "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1"
	indexer "github.com/hyprsh/kestrel/internal/plugin/indexer/v1"
)

// builtinPlugins is the explicit list of compiled-in plugins (ADR 0008). Adding an
// adapter is one line here under its contract; adding a contract means declaring
// its plugin.Contract in the contract package and registering adapters under it.
func builtinPlugins() (*plugin.Registry, error) {
	r := plugin.NewRegistry()
	for _, reg := range []struct {
		contract plugin.Contract
		plugin   plugin.Plugin
	}{
		{downloadclient.Contract, sabnzbd.New(nil)},
		{indexer.Contract, newznab.New(nil)},
	} {
		if err := r.Register(reg.contract, reg.plugin); err != nil {
			return nil, err
		}
	}
	return r, nil
}
