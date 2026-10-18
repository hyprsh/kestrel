# The API is spec-first OpenAPI

Note: ADR-0012 makes an exception to this ADR; see its "Exception to ADR 0009" section.

Kestrel's REST API is defined by a hand-written `api/openapi.yaml`, checked into the repo. `oapi-codegen` (strict server) generates the Go handler interfaces from it, and `openapi-typescript` with `openapi-fetch` generates the SPA's typed client. CI fails when the generated code drifts from the spec, and in tests every response is validated against it. We chose this because the contract is shared by the SPA, the Silo router plugin and outside scripts, and a breaking change to it is a Kestrel major release (`/api/v1` → `/api/v2`). A contract with that weight should be a file someone reviews, not a by-product of whatever the handlers happen to do.

## Considered Options

- **Code-first with `huma` v2**: Go handlers declare their types and the spec is generated from them. There's less YAML to write, but a change to a Go struct would silently change the published contract. Rejected.

## Consequences

- Every endpoint, enum and error `code` has to be in the spec before a handler can exist.
- Within `v1`, changes are additive only: new fields, endpoints and enum values. The spec states that clients must ignore unknown fields and tolerate unknown enum values.
- The `api` module stays a thin adapter: its generated handlers call module interfaces and hold no domain rules.
