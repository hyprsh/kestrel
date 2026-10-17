// Package version holds the build's release version, set at link time with
// -ldflags "-X github.com/hyprsh/kestrel/internal/version.Version=1.2.3".
package version

// Version is the Kestrel release version, or "dev" for local builds.
var Version = "dev"
