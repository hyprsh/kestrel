package requests_test

import (
	"testing"

	"github.com/hyprsh/kestrel/internal/requests"
)

func TestSourceNameCapitalisesTheSourceAndNamesWatchlistRequests(t *testing.T) {
	for source, want := range map[string]string{"silo": "Silo", "plex": "Plex", "plex_watchlist": "Watchlist", "": ""} {
		if got := requests.SourceName(source); got != want {
			t.Errorf("SourceName(%q) = %q, want %q", source, got, want)
		}
	}
}
