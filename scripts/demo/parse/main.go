// Command parse is the demo seed's release name parser (scripts/demo/seed.py).
// It reads "movie|series<TAB>release name" lines on stdin and writes, per line,
// the parsed release as JSON, the snapshot Imports stores in files.parsed_release,
// or null when the name does not parse.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/hyprsh/kestrel/internal/release"
)

func main() {
	in := bufio.NewScanner(os.Stdin)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	for in.Scan() {
		kind, name, _ := strings.Cut(in.Text(), "\t")
		parsed, err := release.Parse(name, release.Kind(kind))
		if err != nil {
			fmt.Fprintln(out, "null")
			continue
		}
		b, err := json.Marshal(parsed)
		if err != nil {
			fmt.Fprintln(os.Stderr, "parse:", err)
			os.Exit(1)
		}
		fmt.Fprintln(out, string(b))
	}
	if err := in.Err(); err != nil {
		fmt.Fprintln(os.Stderr, "parse:", err)
		os.Exit(1)
	}
}
