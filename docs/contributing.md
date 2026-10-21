# Contributing to soroban-merkle-airdrop

Thank you for your interest in contributing to `soroban-merkle-airdrop`! This repository provides a gas-efficient Merkle tree airdrop solution for the Stellar network using Soroban smart contracts.

As a multi-ecosystem repository (Rust smart contracts + TypeScript/Node tools), please review the guidelines below to ensure a smooth contribution process.

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
   git clone https://github.com/<your-fork>/soroban-merkle-airdrop.git
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

## 📥 Pull Request (PR) Guidelines

* **Target Branch:** Always base your feature or fix branch off the `main` branch.
* **Descriptive Naming:** Name your branch based on the component you are editing, such as `feat/contract-reclaim` or `fix/sdk-leaf-hash`.
* **Atomic Scope:** Keep your pull requests small and focused. Do not combine backend smart contract upgrades and unrelated web frontend UI adjustments into the same PR.
* **Test Inclusion:** If you amend the core cryptographic tree algorithms or verify logic (`merkle.rs` or `merkle.ts`), you must expand the corresponding `test.rs` or `merkle.test.ts` files to prove your changes work.
* **Automated CI Validation:** Every push or PR triggers a GitHub Actions pipeline (`ci.yml`) that compiles the Rust code and validates the node environments. Ensure these badges remain green.

---

## 🔍 Code Style

### Rust
* Follow standard `rustfmt` formatting. Run `cargo fmt` before committing.
* Use `cargo clippy` and resolve any warnings before opening a PR.
* All public functions must have doc comments (`///`).

### TypeScript
* The project uses TypeScript strict mode. No `any` types without justification.
* Run `pnpm lint` in the relevant workspace before opening a PR.
* Prefer explicit return types on exported functions.

---

## 🤖 Automated Dependency Updates

This repository uses [Dependabot](https://docs.github.com/en/code-security/dependabot) to keep dependencies up to date automatically. Dependabot raises weekly pull requests for outdated packages across all workspaces:

| Ecosystem | Directory | Schedule |
|-----------|-----------|----------|
| Cargo (Rust) | `contracts/airdrop/` | Weekly |
| npm (SDK) | `sdk/` | Weekly |
| npm (CLI) | `cli/` | Weekly |
| npm (Web) | `web/` | Weekly |
| GitHub Actions | `/` | Weekly |

Dependabot PRs are labelled with `dependencies` and the relevant ecosystem tag (e.g. `rust` or `javascript`). Maintainers review and merge them as part of the normal PR process. If you introduce a new package dependency, Dependabot will automatically start tracking it on the next weekly run.

---

## 🔒 Security Review Checklist

Before opening a pull request that touches contract logic, the SDK's cryptographic path, or any authentication/authorization code, work through this checklist. Not every item applies to every PR — use your judgement and call out anything you skipped in the PR description.

### Secrets and sensitive data
- [ ] No private keys, mnemonics, test seeds, or real token addresses are committed to the repository — including in test fixtures, `.env` files, or inline comments.
- [ ] New test helpers that need a funded account use `Address::generate(&env)` (Rust) or a locally-generated keypair (TypeScript) — never a real secret key.

### Authorization
- [ ] Every state-changing contract function (`initialize`, `claim`, `set_active`, `reclaim`, `transfer_admin`, `claim_for`) calls `require_auth()` on the appropriate signer before reading or writing any storage.
- [ ] Read-only query functions (`merkle_root`, `is_claimed`, `is_active`, `token`, `admin`, `expiration`, `total_deposited`, `remaining_balance`) do **not** require auth — forcing auth on queries is a usability bug and a gas waste.
- [ ] If you add a new state-changing function, its auth requirement is covered by a `#[should_panic]` test that verifies a non-authorized caller is rejected.

### Check-Effects-Interaction order
- [ ] In `claim` and `claim_for`: the `Claimed(addr)` flag is written to storage **before** the token transfer is initiated. This prevents reentrancy: if the token contract somehow re-enters, the double-claim guard is already in place.
- [ ] In `reclaim`: the balance is read, the transfer is initiated, and no further state writes follow the transfer that could be exploited by re-entry.
- [ ] Any new function that mixes storage writes with cross-contract calls follows the same pattern: write first, call second.

### Input validation
- [ ] `initialize` rejects `total_amount <= 0` (returns `ZeroAmount`).
- [ ] `initialize` rejects `expiration <= env.ledger().timestamp()` (returns `ExpirationInPast`).
- [ ] `claim` and `claim_for` reject `amount <= 0` before touching storage or the Merkle proof.
- [ ] Any new public parameter that could be zero, negative, or otherwise degenerate has an explicit guard at the top of the function.

### Unwrap and panic safety
- [ ] No `unwrap()`, `expect()`, or `panic!()` calls in the live contract code paths (`lib.rs`, `merkle.rs`). Use `?`-propagation or explicit `match` / `if let`.
- [ ] Storage reads that return `Option` use safe fallbacks (`unwrap_or`, `unwrap_or_default`, or an explicit error return) — not `.unwrap()`.
- [ ] The only panics in the codebase are intentional `#[should_panic]` test assertions and the SDK test harness.

### Cryptographic correctness
- [ ] Any change to `merkle::leaf_hash` or `merkle::hash_pair` in Rust must be mirrored in `leafHash` / `hashPair` in `sdk/src/merkle.ts`, and vice versa. A mismatch silently breaks all claims.
- [ ] If you change the leaf pre-image (e.g. add a new field, reorder fields), update the golden-value snapshot tests and the `test-vectors/leaf-hash-vectors.json` cross-language vectors.

### Reporting a vulnerability
If your review uncovers a potential security issue, **do not** open a public GitHub issue. Follow the responsible disclosure process in [SECURITY.md](../SECURITY.md).

---

## 🐛 Reporting Issues

Please use the GitHub issue tracker. When filing a bug report, include:
* The component affected (`contract`, `sdk`, `cli`, or `web`).
* Steps to reproduce the issue.
* Expected behaviour vs actual behaviour.
* Relevant logs or error messages.

For security vulnerabilities, do **not** open a public issue. Contact the maintainers directly via GitHub private security advisory.

---

## 📜 Code of Conduct

Please read and follow our [Code of Conduct](../CODE_OF_CONDUCT.md) before participating in this project. We are committed to providing a welcoming and inclusive environment for all contributors.

---

> The root [`CONTRIBUTING.md`](../CONTRIBUTING.md) at the repository root is the canonical source. This file in `docs/` is kept in sync for discoverability from the README link.
