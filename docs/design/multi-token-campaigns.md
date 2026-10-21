# Design: Multi-Token Campaign Support

**Status:** Proposal  
**Author:** soroban-merkle-airdrop contributors  
**Related issue:** [#59](https://github.com/eogenyi23-creator/soroban-merkle-airdrop/issues/59)

---

## Problem Statement

The current contract stores a single `DataKey::TokenAddress` and a single
Merkle root. Every deployment can distribute exactly one token. Multi-reward
airdrops — e.g. distributing both XLM and a governance token — require either
separate deployments or a contract redesign.

This document evaluates three architectural options and recommends one.

---

## Current State

```
DataKey::TokenAddress  → Address       (one token)
DataKey::MerkleRoot    → BytesN<32>    (one distribution tree)
DataKey::TotalDeposited → i128         (one balance)
```

`initialize` accepts a single `token: Address` and `merkle_root: BytesN<32>`.
`claim` transfers tokens from the single token contract to the claimant.

---

## Approach 1 — Separate Contract per Token

Run one independent airdrop deployment per token. The organiser deploys and
initialises a fresh contract for each reward token. No code changes required.

### How it works

```
Deployment A:  merkle_root_A + token_A  (e.g. USDC)
Deployment B:  merkle_root_B + token_B  (e.g. AQUA)
```

Recipients call `claim` on each contract separately.

### Pros

- Zero code changes; works today.
- Full isolation: one campaign's pause/expiry does not affect others.
- Each contract has its own admin, TTL, and upgrade path.
- Audited surface area is the smallest possible.

### Cons

- Claimants pay two separate transaction fees to receive two tokens.
- The organiser must manage multiple contract IDs and Merkle trees.
- Indexers and the TypeScript SDK must aggregate events from multiple contracts.

### Storage and fee impact

No changes. Each deployment uses the existing instance + persistent storage
layout. Network fees are paid separately per deployment.

---

## Approach 2 — Vector of Tokens in a Single Contract

Replace `DataKey::TokenAddress` and `DataKey::MerkleRoot` with
parallel vectors. Each index `i` represents one token campaign:
`tokens[i]` distributes according to `roots[i]`.

### How it works

```rust
DataKey::Tokens         → Vec<Address>      // replaces TokenAddress
DataKey::MerkleRoots    → Vec<BytesN<32>>   // replaces MerkleRoot
DataKey::TotalDeposited → Vec<i128>         // replaces single amount
```

`initialize` accepts `tokens: Vec<Address>` and `roots: Vec<BytesN<32>>`.

`claim` accepts a `campaign_index: u32` and the amount + proof for that
campaign. A separate `Claimed(addr, campaign_index)` key tracks per-campaign
claim status.

### Pros

- Single contract ID for the organiser to manage.
- Claimants could theoretically claim all tokens in one transaction (one
  `batch_claim` call covering all campaigns).

### Cons

- `DataKey::Claimed(Address)` must become `DataKey::Claimed(Address, u32)`,
  which is a **breaking storage schema change** — all existing persistent
  entries are incompatible with an upgraded contract.
- Vectors in instance storage grow linearly; Soroban charges per-byte for
  instance reads/writes. A campaign with 20 tokens costs 20× more to read
  the token list on every `claim`.
- `initialize` must validate, deposit, and transfer for every token atomically.
  A failure on token N leaves tokens 0..N-1 already deposited — requires
  careful rollback logic (or a two-phase approach) that does not exist today.
- A paused or expired state applies to the whole contract; fine-grained
  per-campaign pause is harder to add without further schema changes.
- Harder to audit: proof must cover (address, amount_per_token, index), and
  the leaf-hash spec must change in both Rust and the TypeScript SDK.

### Storage and fee impact

- Instance storage grows by `O(n_tokens)` for the two extra `Vec` keys.
  Soroban charges more to read/write larger entries.
- Each `extend_ttl` call on instance storage covers all campaigns together,
  which is both a benefit (one call) and a risk (one forgotten TTL archives
  everything).
- Persistent storage per claimant doubles to `(address, campaign_index)` keys.
- `CLAIMED_TTL` bookkeeping cost per claim is unchanged.

---

## Approach 3 — Wrapper Factory Contract

Deploy a thin **factory** contract that instantiates child airdrop contracts
on demand. Each child contract is the existing single-token contract, deployed
via `env.deployer().with_current_contract_address()`.

### How it works

```
Factory::create_campaign(token, root, amount, expiration)
  → deploys a child AirdropContract with that config
  → returns child contract_id
  → registers it in factory storage: campaigns: Map<u32, Address>

Factory::claim(campaign_id, claimant, amount, proof)
  → cross-contract call to child_contract.claim(...)
```

### Pros

- Existing `AirdropContract` code is unchanged and re-used for every campaign.
- Each child contract is independently pauseable, reclaimable, and upgradeable.
- Clean separation of concerns; the factory is a thin coordinator.

### Cons

- Cross-contract calls cost extra instructions (CPU and memory).
- Two WASM uploads required: factory + existing contract.
- Factory adds a new audit surface and upgrade complexity.
- Child contract addresses are ephemeral and harder for users/indexers to
  discover without querying the factory.
- Soroban's `deployer` API charges an additional base fee per deployment.

### Storage and fee impact

- Factory: `Map<u32, Address>` in instance storage — grows by one entry per
  campaign, but individual entries are small.
- Child contracts: each has the full existing instance storage layout.
- Each claim cross-invokes the child; ~2× the instruction budget of a direct
  call.

---

## Recommendation: Approach 1 — Separate Contract per Token

**Rationale:**

1. **No breaking changes.** The existing storage schema, Merkle leaf spec, and
   TypeScript SDK work today. Approaches 2 and 3 both require coordinated
   changes across Rust, TypeScript, and documentation.

2. **Minimal audit surface.** Each deployment is an isolated instance of a
   contract that is already under review. Adding a vector or a factory
   introduces new code paths that need fresh auditing before mainnet use.

3. **Independent lifecycle management.** Organiser can pause, expire, or
   reclaim one token campaign without affecting others. This is the correct
   operational model for multi-reward airdrops where reward schedules differ.

4. **Fee cost is acceptable.** Claimants pay one additional transaction fee per
   extra token. For typical airdrops (2–5 tokens) this is negligible compared
   to the gas saved versus batch-transfer designs. If UX improvement is needed,
   the TypeScript SDK can batch-submit claims to multiple contracts inside a
   single Stellar transaction (multiple operations), which reduces the number of
   round-trips to one without changing the contract.

5. **Future-proof.** When Soroban adds atomic multi-contract invocation or
   transaction-level batching, Approach 1 benefits immediately with no
   contract changes.

**Action items to support Approach 1:**

| Item | Owner | File(s) |
|------|-------|---------|
| Update CLI `generate` to accept a `--token` flag per campaign | SDK/CLI | `cli/src/commands/generate.ts` |
| Update CLI `deploy` guidance to list multi-campaign steps | CLI | `cli/src/commands/deploy.ts` |
| Update TypeScript SDK client to accept an array of contract IDs | SDK | `sdk/src/client.ts` |
| Add multi-contract batch claim helper to SDK | SDK | `sdk/src/client.ts` |
| Document multi-token flow in `docs/deploying.md` | Docs | `docs/deploying.md` |

---

## Appendix: Leaf Hash Compatibility

All three approaches would require the leaf hash to remain
`SHA-256( SHA-256(address_strkey) ++ amount_be[16] )` for Approach 1.
Approaches 2 and 3 would need a `campaign_index` incorporated into the leaf to
prevent cross-campaign proof replay — e.g.:

```
leaf = SHA-256( SHA-256(address) ++ amount_be[16] ++ u32_be[4](campaign_index) )
```

This is a breaking change to the TypeScript SDK and all existing Merkle trees.
Approach 1 avoids this entirely.

Closes #59
