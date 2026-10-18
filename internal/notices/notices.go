// Package notices embeds the generated third-party notices (scripts/gen-notices.sh).
package notices

import _ "embed"

// Text is THIRD_PARTY_NOTICES.md: Kestrel's licence, the ported Radarr and
// Sonarr code, the bundled TRaSH data and the dependencies' licences.
//
//go:embed THIRD_PARTY_NOTICES.md
var Text string
