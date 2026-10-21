# Contributing to soroban-merkle-airdrop

Thank you for your interest in contributing to `soroban-merkle-airdrop`! This repository provides a gas-efficient Merkle tree airdrop solution for the Stellar network using Soroban smart contracts. 

As a multi-ecosystem repository (Rust smart contracts + TypeScript/Node tools), please review the guidelines below to ensure a smooth contribution process.

---

## 🏁 First-time Setup

This project uses a **pnpm workspace** to manage the three TypeScript packages (`sdk`, `cli`, `web`) as a single monorepo. Please follow the steps below to get a correctly linked local environment.

### 1. Install pnpm

If you don't have `pnpm` installed yet, the recommended way is via [Corepack](https://nodejs.org/api/corepack.html) (bundled with Node.js 16+):

```bash
corepack enable
corepack prepare pnpm@latest --activate
```

Or install globally with npm:

```bash
npm install -g pnpm
```

Verify the installation:

```bash
pnpm --version   # should print 9.x or higher
```

### 2. Install all workspace dependencies from the repo root

> ⚠️ **Important:** Run `pnpm install` from the **repository root**, not from inside individual package directories. Running `npm install` or `pnpm install` from within `sdk/`, `cli/`, or `web/` will bypass workspace linking and may pull in duplicate or mismatched packages.

```bash
# From the repository root:
git clone https://github.com/<your-fork>/soroban-merkle-airdrop.git
cd soroban-merkle-airdrop
pnpm install
```

`pnpm install` reads `pnpm-workspace.yaml` and installs all packages listed there (`sdk`, `cli`, `web`) in one pass. It also creates **workspace symlinks** automatically:

- `cli/node_modules/@soroban-merkle-airdrop/sdk` → `../../sdk`
- `web/node_modules/@soroban-merkle-airdrop/sdk` → `../../sdk`

This means `cli` and `web` import the **local source** of `sdk` instead of a published npm version.

### 3. Build all packages

After installing, compile all TypeScript packages in dependency order with a single command:

```bash
# From the repository root:
pnpm -r build
```

`-r` (recursive) tells pnpm to run the `build` script in every workspace package. Because `cli` and `web` depend on `sdk`, build `sdk` first manually if you only want to build a subset:

```bash
pnpm --filter @soroban-merkle-airdrop/sdk build
pnpm --filter @soroban-merkle-airdrop/cli build
```

### 4. Workspace dependency overview

| Package | Depends on (workspace) | Local link path |
|---------|------------------------|-----------------|
| `sdk`   | —                      | `sdk/` |
| `cli`   | `@soroban-merkle-airdrop/sdk` | `cli/node_modules/@soroban-merkle-airdrop/sdk` → `sdk/` |
| `web`   | `@soroban-merkle-airdrop/sdk` | `web/node_modules/@soroban-merkle-airdrop/sdk` → `sdk/` |

The dependency is declared as `"workspace:*"` in both `cli/package.json` and `web/package.json`. This is a pnpm-specific protocol that always resolves to the local workspace package, regardless of its published version.

### 5. Troubleshooting: SDK changes not picked up by CLI or web

If you edit `sdk/src/` but the CLI or web still reflects old behaviour, the compiled output in `sdk/dist/` is stale. Rebuild the SDK:

```bash
pnpm --filter @soroban-merkle-airdrop/sdk build
# or shorthand from repo root:
cd sdk && pnpm build
```

If that doesn't help, the workspace link itself may be broken (e.g. after a manual `npm install` inside a sub-package). Fix it by re-running from the root:

```bash
# Delete all node_modules and reinstall cleanly:
find . -name 'node_modules' -maxdepth 3 -type d -exec rm -rf {} + 2>/dev/null; true
pnpm install
pnpm -r build
```

---

## 🛠️ Repository & Monorepo Structure

This project is organized into distinct functional workspaces:
* `contracts/airdrop/` - The core Soroban smart contract written in Rust.
* `sdk/` - The TypeScript SDK for off-chain Merkle tree generation and verification.
* `cli/` - The Node-based command-line tool built with pnpm.
* `web/` - The Next.js claim interface frontend.

---

## 🚀 Local Development Setup

### Prerequisites
* **Rust** with the `wasm32v1-none` target installed.
* **Stellar CLI** for local contract interactions.
* **Node.js 20+** and **pnpm** for the JavaScript workspaces.

### Initial Setup
1. Fork the repository on GitHub, then clone your fork locally:
   ```bash
   git clone https://github.com
   cd soroban-merkle-airdrop
   ```
2. Install the JavaScript monorepo dependencies from the root directory:
   ```bash
   pnpm install
   ```

---

## 🧪 Building and Testing Each Module

Before opening a pull request, verify that your specific workspace builds and passes all tests successfully.

### 1. Smart Contract Workflow (`contracts/airdrop/`)
Navigate to the contract directory or run commands targeting the manifest path:
* **Compile the WebAssembly target:**
  ```bash
  cargo build --manifest-path contracts/airdrop/Cargo.toml --target wasm32v1-none --release
  ```
* **Run Rust unit tests:**
  ```bash
  cargo test --manifest-path contracts/airdrop/Cargo.toml
  ```

> **Cargo.lock:** `Cargo.lock` is committed to the repository so that CI and
> local builds always use the same resolved dependency versions. When you add,
> remove, or upgrade a Rust dependency, run `cargo update` (or the relevant
> `cargo add`/`cargo rm` command) and **commit the updated `Cargo.lock`** in
> the same PR as the `Cargo.toml` change.

### 2. TypeScript SDK Workflow (`sdk/`)
* **Run SDK test suites (Merkle algorithms & tree building):**
  ```bash
  cd sdk
  pnpm test
  ```

### 3. CLI Workflow (`cli/`)
* **Compile the command-line utility:**
  ```bash
  cd cli
  pnpm build
  ```

### 4. Next.js Frontend Workflow (`web/`)
* **Launch the local development UI server:**
  ```bash
  cd web
  pnpm dev
  ```

---

## 🌐 Integration Testing

The `scripts/integration-test.ts` script runs a full end-to-end test against the **Stellar testnet**. It deploys a fresh contract instance, builds a 5-entry Merkle tree, initialises the airdrop, claims tokens for one address, verifies the balance changed, and reclaims the remaining tokens at the end.

### Prerequisites

1. **A funded testnet account.** Get one from [Friendbot](https://friendbot.stellar.org/?addr=YOUR_PUBKEY). The admin account needs enough XLM to cover transaction fees and the total token deposit.

2. **Compiled WASM.** Build the contract before running the test:
   ```bash
   cargo build --manifest-path contracts/airdrop/Cargo.toml \
     --target wasm32v1-none --release
   ```

3. **`ts-node` and TypeScript** installed globally or via `npx`:
   ```bash
   npm install -g ts-node typescript
   # or use: npx ts-node scripts/integration-test.ts
   ```

4. **Node.js dependencies** installed at the repo root:
   ```bash
   pnpm install
   ```

### Running the test

```bash
STELLAR_SECRET_KEY=S... ts-node --project scripts/tsconfig.json scripts/integration-test.ts
```

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `STELLAR_SECRET_KEY` | **Yes** | Admin/deployer secret key (`S...`). Must be funded on testnet. |
| `TOKEN_CONTRACT_ID` | No | Pre-deployed SEP-41 token contract ID. Defaults to testnet native XLM SAC. |
| `AIRDROP_WASM_PATH` | No | Path to the compiled `.wasm` file. Defaults to `target/wasm32v1-none/release/soroban_merkle_airdrop.wasm`. |
| `RPC_URL` | No | Soroban RPC endpoint. Defaults to `https://soroban-testnet.stellar.org`. |
| `NETWORK_PASSPHRASE` | No | Network passphrase. Defaults to the testnet passphrase. |

### What the script verifies

1. WASM uploads successfully and returns a `wasmHash`.
2. Contract deploys and a `contractId` is obtained.
3. `initialize()` succeeds: `is_active == true`, `total_deposited == 1500`.
4. After `claim()` for `claimants[0]` (100 stroops):
   - Token balance increased by exactly 100 stroops.
   - `claimed_count() == 1`.
   - `is_claimed(claimants[0]) == true`.
5. After `reclaim()` (once expiry passes — 2 minutes):
   - Admin receives the remaining 1400 stroops back.

### Notes

- The integration test **does not run in CI** because it requires a live testnet account. Run it manually before opening a PR that modifies the contract's claim or reclaim logic.
- The 2-minute expiration is intentional so the reclaim step finishes quickly. Do not use such short expirations in production.
- If you want to test with a custom SEP-41 token (not XLM), deploy a token contract first and pass `TOKEN_CONTRACT_ID=C...` when invoking the script.

---

## 🔑 Secret Key Security

The CLI `claim` command requires a Stellar secret key to sign transactions. **Never pass your secret key as a command-line argument** — it will be visible in your shell history and system process listings.

Instead, use the environment variable approach:
```bash
export STELLAR_SECRET_KEY=S...
merkle-airdrop claim --tree merkle-tree.json --address G...
```

The `--secret-key` flag is provided for convenience only. If you use it, the CLI will print a warning reminding you to prefer the environment variable.

---

## 📥 Pull Request (PR) Guidelines

* **Target Branch:** Always base your feature or fix branch off the `main` branch.
* **Descriptive Naming:** Name your branch based on the component you are editing, such as `feat/contract-reclaim` or `fix/sdk-leaf-hash`.
* **Atomic Scope:** Keep your pull requests small and focused. Do not combine backend smart contract upgrades and unrelated web frontend UI adjustments into the same PR.
* **Test Inclusion:** If you amend the core cryptographic tree algorithms or verify logic (`merkle.rs` or `merkle.ts`), you must expand the corresponding `test.rs` or `merkle.test.ts` files to prove your changes work.
* **Automated CI Validation:** Every push or PR triggers a GitHub Actions pipeline (`ci.yml`) that compiles the Rust code and validates the node environments. Ensure these badges remain green.

---
