// Command kestrel-silo is Kestrel's Silo plugin, with a request_router.v1 and a
// scan_source.v1 capability: a second binary from this repo, released with the
// same version as Kestrel (ADR 0004).
// Silo starts it over gRPC; running it by hand only prints its manifest.
package main

import (
	"strings"

	"github.com/Silo-Server/silo-plugin-sdk/pkg/pluginsdk/runtime"

	"github.com/hyprsh/kestrel/internal/silo"
	"github.com/hyprsh/kestrel/internal/version"
)

func main() {
	v := strings.TrimPrefix(version.Version, "v")
	if v == "dev" {
		v = "0.0.0"
	}
	runtime.ServeManifest(silo.ManifestJSON(), v, runtime.CapabilityServers{
		RequestRouter: silo.NewRouter(silo.Options{}),
		ScanSource:    silo.NewScanSource(silo.Options{}),
	})
}
