// Package api holds the hand-written OpenAPI contract, embedded so the server
// can publish it and tests can validate responses against it.
package api

import _ "embed"

// Spec is the YAML source of openapi.yaml.
//
//go:embed openapi.yaml
var Spec []byte
