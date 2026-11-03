// Package version holds the build's release version, set at link time with
// -ldflags "-X github.com/hyprsh/kestrel/internal/version.Version=1.2.3".
// Edge builds also carry the commit they were made from, set the same way.
package version

// Version is the Kestrel release version, or "dev" for local builds.
var Version = "dev"

// Commit is the short hash of the commit the build was made from, or "" when
// the build does not say. Edge builds set it; Version stays "edge".
var Commit = ""
