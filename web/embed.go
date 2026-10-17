// Package web embeds the built SPA (web/dist, produced by `npm run build`).
// The directory always exists in the repo, holding only .keep until the SPA
// is built, so Go builds and tests never need Node.
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

// FS returns the built SPA with index.html at its root.
func FS() fs.FS {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		panic(err) // dist is embedded at compile time
	}
	return sub
}
