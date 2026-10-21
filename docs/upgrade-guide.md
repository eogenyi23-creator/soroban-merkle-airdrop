# Soroban SDK Upgrade Guide

This guide explains how to upgrade the Soroban SDK version used by the
`soroban-merkle-airdrop` contract, what to watch out for, and what operational
steps are required after an upgrade.

The current SDK version is pinned in the workspace:

```toml
# Cargo.toml (workspace root)
[workspace.dependencies]
soroban-sdk = { version = "27.0.6" }
```

---

## Why upgrading matters

The Soroban SDK is a thin shim over the host ABI. When Stellar upgrades the
network protocol, the host ABI may change in ways that require a new SDK. A
contract compiled against an old SDK may refuse to deploy, or may fail at
runtime, on a network that has moved to a newer protocol version.

**Every SDK upgrade requires a new WASM deployment.** The compiled WASM is
what lives on-chain; updating `Cargo.toml` and rebuilding is not enough on its
own — the new binary must be uploaded and a new contract instance deployed (or
the existing one upgraded with `update_current_contract_wasm`, which this
contract does not support).

---

## Step-by-step upgrade procedure

### 1. Update the SDK version in `Cargo.toml`

Open the workspace `Cargo.toml` at the repository root and bump the version:

```toml
[workspace.dependencies]
soroban-sdk = { version = "28.0.0" }   # ← new version
```

The contract's own `Cargo.toml` (`contracts/airdrop/Cargo.toml`) inherits this
via `{ workspace = true }`, so you only need to change one file.

### 2. Update the lock file

```bash
cargo update -p soroban-sdk
```

This resolves the new version and writes an updated `Cargo.lock`. Commit both
`Cargo.toml` and `Cargo.lock` together.

### 3. Rebuild the contract

```bash
cargo build \
  --manifest-path contracts/airdrop/Cargo.toml \
  --target wasm32v1-none \
  --release
```

The output WASM is at:

```
target/wasm32v1-none/release/soroban_merkle_airdrop.wasm
```

### 4. Re-run the test suite

```bash
cargo test --manifest-path contracts/airdrop/Cargo.toml
```

All 25+ tests must pass. Pay special attention to:

- `test_leaf_hash_known_vector` — verifies that the Rust leaf hash still
  produces the same bytes as the TypeScript SDK. If the SDK changes how
  `BytesN`, `Bytes`, or `Address::to_string()` work, this cross-language
  vector test will catch the divergence.
- `test_restore_extends_ttl` — verifies TTL extension behaviour, which depends
  on host semantics.

### 5. Check the TypeScript SDK

If the upgrade involves a change to how contract ABI types are serialised (e.g.
changes to `contracttype`, `BytesN`, or `Address`), also rebuild and re-test
the TypeScript SDK:

```bash
cd sdk && pnpm install && pnpm build && pnpm test
```

The `merkle.test.ts` file contains the same leaf-hash vector. Both Rust and
TypeScript must produce identical bytes.

### 6. Deploy the new WASM

After passing all tests, upload and deploy:

```bash
# Upload the new WASM binary
stellar contract upload \
  --network testnet \
  --source deployer \
  --wasm target/wasm32v1-none/release/soroban_merkle_airdrop.wasm

# Note the new WASM hash printed by the upload command, then deploy
stellar contract deploy \
  --network testnet \
  --source deployer \
  --wasm-hash <NEW_WASM_HASH>
```

The new deployment gets a fresh contract address. Initialise it with a **new
Merkle root** (see the replay-protection note in
[`docs/threat-model.md`](./threat-model.md#9-same-network-re-deployment-replay-attack)).

### 7. Update documentation and deployment records

Record the new contract address, WASM hash, SDK version, and Merkle root in
your deployment log. Update `README.md` and `docs/deploying.md` if the CLI
commands or default addresses have changed.

---

## Known breaking changes by version

### Upgrading from 20.x to 21.x

- `soroban_sdk::token::Client` was introduced; earlier versions used a different
  token interface. The contract already uses `token::Client`, so no change
  needed here if you are on 20.x or later.
- `contractmeta!` macro syntax was stabilised. No change required.

### Upgrading from 21.x / 22.x to 27.x

- The `wasm32v1-none` target replaced `wasm32-unknown-unknown` for contract
  builds. Update any CI build scripts or local build aliases.
- `Events::publish` was deprecated in 27.x in favour of the `#[contractevent]`
  macro. The contract uses the old form intentionally (see the `#[allow(deprecated)]`
  comment in `lib.rs`). Switching to `#[contractevent]` would rename event
  topics and is a deliberate ABI decision, not a routine upgrade step.
- `Address::from_str` is available from 20.x onwards; no change.
- `env.ledger().set_timestamp()` in tests was stabilised in the `testutils`
  feature by 21.x; no change.

### Upgrading from 27.x to 28.x (anticipated)

No breaking changes to the contract surface have been announced at the time of
writing. Check the [Soroban SDK CHANGELOG](https://github.com/stellar/rs-soroban-sdk/blob/main/CHANGELOG.md)
and the [Stellar Protocol upgrade notes](https://developers.stellar.org/docs/learn/encyclopedia/network-configuration/protocol-upgrades)
before upgrading.

Watch for:

- Changes to `BytesN` or `Bytes` serialisation — would affect `leaf_hash` and
  the cross-language test vector.
- Changes to `contracttype` struct field serialisation order — would affect
  `ContractInfo` and `AirdropEntry`.
- Changes to the `testutils` API — would require updating `test.rs`.

---

## Operational reminder: new WASM = new deployment

There is no `update_current_contract_wasm` entry point in this contract, so
an SDK upgrade cannot be applied to a running contract in-place. Every upgrade
means:

1. A new WASM hash on-chain.
2. A new contract address (or a separate upgrade proxy, not implemented here).
3. A new Merkle root (required by the replay-protection policy).
4. New token deposits into the new contract.
5. Communication to all recipients about the new contract address.

Plan upgrades well before mainnet deployment to avoid forcing recipient
re-notification. On testnet, upgrades are cheap — test freely.
