package requests

import (
	"unicode"
	"unicode/utf8"
)

// SourceName is a Request's source as people read it: "Silo" for the source
// "silo", "Jellyseerr" for "jellyseerr", "Watchlist" for "plex_watchlist". The source is the requesting app's
// lower-case key; the SPA names it by the same rule (web/src/requests/source.ts),
// so the Log's "Request from Ben via Jellyseerr" reads as the screens do.
func SourceName(source string) string {
	if source == "plex_watchlist" {
		return "Watchlist" // Requests Watchlist sync makes (ADR 0019)
	}
	r, n := utf8.DecodeRuneInString(source)
	if n == 0 {
		return source
	}
	return string(unicode.ToUpper(r)) + source[n:]
}
