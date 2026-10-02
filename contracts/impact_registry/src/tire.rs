// Generate the client and wire types from the actual TireRegistry ABI.
// Build tire-registry before compiling this package; no business logic is copied.
soroban_sdk::contractimport!(file = "../../target/wasm32v1-none/release/tire_registry.wasm");
