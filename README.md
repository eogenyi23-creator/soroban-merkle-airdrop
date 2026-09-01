# soroban-merkle-airdrop

> Gas-efficient Merkle tree airdrop for Stellar — distribute tokens to thousands of addresses using on-chain proof verification. Built with Soroban smart contracts.

[![CI](https://github.com/eogenyi23-creator/soroban-merkle-airdrop/actions/workflows/ci.yml/badge.svg)](https://github.com/eogenyi23-creator/soroban-merkle-airdrop/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## The Problem

Distributing tokens to thousands of addresses via batch transfers is expensive and slow. Every recipient costs a separate transaction.

## The Solution

Store only a **single 32-byte Merkle root** on-chain. Recipients prove their allocation by submitting a compact Merkle proof and claiming tokens themselves — one transaction per recipient, paid by the recipient.

```
Off-chain                          On-chain
─────────────────────────────      ──────────────────────────────
[ Alice: 1000 ]                    
[ Bob:    500 ]  → build tree →   MerkleRoot: 0xabc123...
[ Carol:  250 ]                    
[ ...10,000 more... ]              

Alice claims:
  proof = [sibling_hash_1, sibling_hash_2]  →  verify → transfer 1000 tokens ✓
```

This pattern is used by Uniswap, ENS, and many EVM protocols — now native to Stellar.

## Repository Structure

```
soroban-merkle-airdrop/
├── contracts/airdrop/          # Soroban contract (Rust)
│   └── src/
│       ├── lib.rs              # Contract: initialize, claim, reclaim, queries
│       ├── merkle.rs           # SHA-256 Merkle proof verification
│       ├── types.rs            # Storage keys, error types
│       └── test.rs             # Full contract test suite
├── sdk/                        # TypeScript SDK
│   └── src/
│       ├── merkle.ts           # Merkle tree builder + verifyProof
│       ├── client.ts           # Airdrop contract RPC client
│       ├── types.ts            # Shared types
│       └── merkle.test.ts      # SDK unit tests
├── cli/                        # merkle-airdrop CLI
│   └── src/
│       ├── commands/
│       │   ├── generate.ts     # Build tree from CSV → JSON
│       │   ├── claim.ts        # Submit claim transaction
│       │   ├── status.ts       # Query contract status
│       │   └── deploy.ts       # Deploy guidance
│       └── index.ts
├── web/                        # Next.js claim frontend
│   └── src/app/
│       ├── page.tsx            # Landing page
│       └── claim/page.tsx      # Check eligibility + claim UI
├── docs/
│   ├── architecture.md
│   ├── deploying.md
│   └── contributing.md
└── .github/workflows/
    ├── ci.yml                  # Build + test on every push
    └── deploy.yml              # Manual deploy to testnet/mainnet
```

## Quick Start

### Prerequisites

- [Rust](https://rustup.rs/) + `wasm32v1-none` target
- [Stellar CLI](https://developers.stellar.org/docs/tools/cli)
- Node.js 20+ and [pnpm](https://pnpm.io/)

### 1. Build the contract

```bash
cargo build --manifest-path contracts/airdrop/Cargo.toml --target wasm32v1-none --release
cargo test --manifest-path contracts/airdrop/Cargo.toml
```

### 2. Generate a Merkle tree from your airdrop list

```bash
# Create a CSV: address,amount
echo "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN,1000
GAYOLLLUIZE4DZMBB2ZBKGBUBZLIOYU6XFLW37GBP2VZD3ABNXCW4BVA,500" > airdrop.csv

cd cli && pnpm install && pnpm build
pnpm start generate --input ../airdrop.csv --output ../merkle-tree.json
# → Merkle root: 0xabc123...
```

### 3. Deploy the contract

```bash
# Upload and deploy
stellar contract upload --network testnet --source deployer \
  --wasm target/wasm32v1-none/release/soroban_merkle_airdrop.wasm

stellar contract deploy --network testnet --source deployer --wasm-hash <HASH>

# Initialise with the Merkle root and deposit tokens
stellar contract invoke --network testnet --source deployer --id <CONTRACT_ID> \
  -- initialize \
  --admin $(stellar keys address deployer) \
  --token <TOKEN_CONTRACT> \
  --merkle_root <ROOT_FROM_GENERATE> \
  --total_amount <TOTAL>
```

### 4. Let recipients claim

```bash
# CLI
merkle-airdrop claim \
  --tree merkle-tree.json \
  --address GAAZI4... \
  --secret-key S... \
  --contract-id <CONTRACT_ID>

# Or use the web UI
cd web && pnpm install && pnpm dev
```

## CLI Reference

```
merkle-airdrop <command> [options]

Commands:
  generate   Build Merkle tree from CSV → JSON (run off-chain by organiser)
  claim      Submit claim transaction for an address
  status     Query on-chain contract status
  deploy     Deployment guide (uses Stellar CLI)

Global options:
  -n, --network <network>      testnet | mainnet  [default: testnet]
  --contract-id <id>           Airdrop contract address
```

## How the Merkle Proof Works

**Leaf hash:** `SHA-256( SHA-256(address_as_utf8_strkey_bytes) ++ amount_big_endian[16] )`

The address is first hashed as the UTF-8 bytes of its Stellar strkey string
(e.g. `GABC...` for accounts, `CABC...` for contracts) to produce a stable
32-byte value. That hash is then concatenated with the 16-byte big-endian
encoding of the amount and SHA-256'd again to produce the leaf. The double-hash
is necessary because Soroban's `Address` type does not expose the raw public-key
bytes directly in contract code — hashing the strkey string is the stable,
canonical substitute used by both the Rust contract and the TypeScript SDK.

**Node hash:** `SHA-256(min(left, right) ++ max(left, right))` — sorted so the tree is position-independent.

This means:
- The same distribution produces the same root regardless of list order
- Proofs are compact: O(log n) hashes for n recipients
- The TypeScript builder and Rust verifier use identical algorithms

## Contributing

See [docs/contributing.md](docs/contributing.md). Issues tagged `good first issue` are beginner-friendly.

## License

MIT
