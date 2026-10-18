// Command gen-silo-repository writes silo-repository.json for a release (run by GoReleaser).
//
//	go run ./scripts/gen-silo-repository -version 0.2.0 -out dist/silo-repository.json
package main

import (
	"flag"
	"log"
	"os"

	"github.com/hyprsh/kestrel/internal/silo"
)

func main() {
	version := flag.String("version", "", "release version, with or without the leading v")
	out := flag.String("out", "silo-repository.json", "file to write")
	flag.Parse()
	b, err := silo.Repository(*version)
	if err != nil {
		log.Fatal(err)
	}
	if err := os.WriteFile(*out, append(b, '\n'), 0o644); err != nil {
		log.Fatal(err)
	}
}
