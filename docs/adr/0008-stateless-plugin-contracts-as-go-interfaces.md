# Plugin contracts are stateless, data-only Go interfaces, liftable to gRPC later

Download clients, indexers and media-server refresh are plugins behind versioned contracts (`download_client.v1`, `indexer.v1`, `media_server.v1`), compiled into the binary in v1. Each contract is a plain Go interface in its own versioned package. Its types carry only data: strings, numbers, bytes, times and enums, with no pointers into host state, no callbacks and no channels. As with Silo's `RouterConnection`, a plugin keeps no state: every call gets a `Connection{id, config}`, and errors come back as one typed `plugin.Error` with a code. Following these rules, an adapter can later move out of process (`hashicorp/go-plugin` over gRPC, as Silo does) behind a mechanical shim, without changing the contract. We chose plain Go over protobuf because out-of-process plugins are post-v1 and there is no second plugin author yet. Paying for a protobuf toolchain and generated types in every v1 adapter isn't worth it for a migration that may never come.

## Considered Options

- **`.proto` contracts from day one**, with in-process adapters implementing the generated interfaces. This guarantees liftability through the compiler, but it puts `buf`/`protoc-gen-go` in the build and generated structs (getters, `timestamppb`) in every adapter. Rejected for v1.

## Consequences

- Nothing in the compiler keeps the contracts data-only. To guard it, each contract's conformance suite round-trips every request and response type through JSON, so an unserialisable field fails the build.
- Lifting a contract means writing its `.proto` then, plus a gRPC shim that maps between the proto and Go types.
- A contract changes compatibly within its major version (additive fields with defaults). A breaking change is a new package, such as `download_client.v2`.
