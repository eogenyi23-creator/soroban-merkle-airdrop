# Audit Checklist

**Contract:** soroban-merkle-airdrop  
**Status:** Pre-audit — see [SECURITY.md](../SECURITY.md)  
**Related issue:** [#47](https://github.com/eogenyi23-creator/soroban-merkle-airdrop/issues/47)

Each item is marked with one of:

- ✅ **done** — implemented and tested
- 🔲 **todo** — not yet addressed
- **n/a** — not applicable to this contract

---

## 1. Integer Overflow / Underflow in Amount Handling

| # | Check | Status | File / Lines |
|---|-------|--------|--------------|
| 1.1 | `total_amount` is validated as `> 0` before any arithmetic | ✅ done | `lib.rs:100–102` — `if total_amount <= 0 { return Err(ZeroAmount) }` |
| 1.2 | `amount` in `claim` / `claim_entry` is validated as `> 0` | ✅ done | `lib.rs:357–359` — `if amount <= 0 { return Err(ZeroAmount) }` |
| 1.3 | Cargo release profile enables `overflow-checks = true` | ✅ done | `contracts/airdrop/Cargo.toml` — `[profile.release] overflow-checks = true` |
| 1.4 | No unchecked arithmetic on amounts (no manual `+`, `-`, `*` on `i128` token values) | ✅ done | `lib.rs` — only the host `transfer` call uses the amount; no arithmetic performed in contract code |
| 1.5 | `i128` range is sufficient for all token amounts (max ≈ 1.7 × 10³⁸) | ✅ done | Soroban SEP-41 uses `i128`; largest real-world supply fits comfortably |

---

## 2. Storage Key Collision Risks

| # | Check | Status | File / Lines |
|---|-------|--------|--------------|
| 2.1 | All storage keys are variants of the `DataKey` enum — no raw string keys | ✅ done | `types.rs:8–29` |
| 2.2 | `DataKey::Claimed(Address)` uniquely scopes per-claimant entries; two different addresses cannot produce the same serialised key | ✅ done | Soroban serialises `contracttype` enums with a tag + variant; `Address` encoding is deterministic |
| 2.3 | No two `DataKey` variants share the same discriminant value | ✅ done | `types.rs:8–29` — variants are unnamed (auto-numbered); compiler rejects duplicates |
| 2.4 | Instance vs. persistent storage separation is explicit and consistent | ✅ done | All global config uses `instance()`; per-claimant `Claimed` uses `persistent()` |

---

## 3. Auth Bypass Vectors

| # | Check | Status | File / Lines |
|---|-------|--------|--------------|
| 3.1 | `initialize` calls `admin.require_auth()` before reading or writing any state | ✅ done | `lib.rs:107` — auth called before the SEP-41 check and transfer |
| 3.2 | `claim` calls `claimant.require_auth()` before `claim_entry` | ✅ done | `lib.rs:145–146` |
| 3.3 | `batch_claim` calls `require_auth()` for every unique claimant before processing any entries | ✅ done | `lib.rs:172–180` — auth loop runs before the claim loop |
| 3.4 | `set_active` reads admin from storage and calls `admin.require_auth()` — cannot be spoofed via argument | ✅ done | `lib.rs:218–224` |
| 3.5 | `transfer_admin` reads current admin from storage for auth, does not trust a caller-supplied "old admin" | ✅ done | `lib.rs:245–249` |
| 3.6 | `upgrade` reads admin from storage for auth | ✅ done | `lib.rs:287–291` |
| 3.7 | `reclaim` reads admin from storage for auth | ✅ done | `lib.rs:310–314` |
| 3.8 | `restore` is intentionally public with no auth — acceptable because it only extends TTL | ✅ done | `lib.rs:303–307` — comment documents the design intent |
| 3.9 | No function accepts an admin address as a call argument and uses it for auth | ✅ done | All admin-gated functions read the stored address from instance storage |
| 3.10 | Re-entrancy guard: `Claimed` flag is written to persistent storage **before** the token transfer | ✅ done | `lib.rs:373–377` — `set(&claimed_key, &true)` precedes `TokenClient::transfer` |

---

## 4. Correct SEP-41 Token Interface Usage

| # | Check | Status | File / Lines |
|---|-------|--------|--------------|
| 4.1 | `initialize` validates the token implements SEP-41 by calling `try_decimals()` before storing the address | ✅ done | `lib.rs:110–114` — returns `InvalidToken` if `try_decimals()` fails |
| 4.2 | Token address is stored in instance storage only after successful validation | ✅ done | `lib.rs:120` — `set(&DataKey::TokenAddress, &token)` is after the validation block |
| 4.3 | `transfer` is called with `(from, to, amount)` matching the SEP-41 spec | ✅ done | `lib.rs:116`, `lib.rs:379–383` — argument order matches `token::Client::transfer` signature |
| 4.4 | `balance` is called with a single address argument | ✅ done | `lib.rs:319` — `token_client.balance(&env.current_contract_address())` |
| 4.5 | The contract never calls non-standard token methods beyond `transfer`, `balance`, and `decimals` | ✅ done | Grep `TokenClient::new` usages in `lib.rs` |
| 4.6 | Test: invalid token address returns `InvalidToken` | ✅ done | `test.rs` — `test_initialize_invalid_token_returns_error` |
| 4.7 | Test: valid SAC returns success | ✅ done | `test.rs` — `test_initialize_valid_sac_succeeds` |

---

## 5. TTL Expiry and Archival Risks

| # | Check | Status | File / Lines |
|---|-------|--------|--------------|
| 5.1 | Instance storage TTL is bumped on every `claim_entry` call | ✅ done | `lib.rs:343–346` |
| 5.2 | All read-only query functions bump instance TTL | ✅ done | `lib.rs` — `merkle_root`, `is_active`, `token`, `admin`, `total_deposited`, `expiration` each call `extend_ttl` |
| 5.3 | `is_claimed` bumps the **persistent** `Claimed(addr)` TTL when the entry exists, preventing silent archival and double-claim | ✅ done | `lib.rs:264–272` — extend_ttl called when `exists == true` |
| 5.4 | TTL constants are large enough to cover typical airdrop lifetimes (~2 years) | ✅ done | `lib.rs:55–58` — `CLAIMED_TTL = INSTANCE_TTL = 12_614_400` ledgers ≈ 2 years at 5-second ledger time |
| 5.5 | `restore()` is public and auth-free so anyone can revive an archived contract | ✅ done | `lib.rs:303–307` |
| 5.6 | Test: `restore()` extends instance TTL after near-archival | ✅ done | `test.rs` — `test_restore_extends_ttl` |
| 5.7 | Test: `is_claimed()` returns `true` after many ledger advances (persistent TTL refresh) | ✅ done | `test.rs` — `test_is_claimed_refreshes_persistent_ttl` |
| 5.8 | Persistent `Claimed` entries set a threshold + max TTL (not only the threshold) | ✅ done | `lib.rs:374–377` — `extend_ttl(CLAIMED_TTL_THRESHOLD, CLAIMED_TTL)` |

---

## 6. Event Correctness

| # | Check | Status | File / Lines |
|---|-------|--------|--------------|
| 6.1 | `initialize` emits `("init", admin) → (merkle_root, total_amount)` | ✅ done | `lib.rs:130–132` |
| 6.2 | `claim_entry` emits `("claimed", claimant) → amount` | ✅ done | `lib.rs:385–387` |
| 6.3 | `set_active` emits `("paused", admin) → active` | ✅ done | `lib.rs:228–230` |
| 6.4 | `transfer_admin` emits `("adm_xfer", old_admin) → new_admin` | ✅ done | `lib.rs:255–258` |
| 6.5 | `upgrade` emits `("upgrade", admin) → new_wasm_hash` | ✅ done | `lib.rs:297–299` |
| 6.6 | `reclaim` emits `("reclaimed", admin) → balance` | ✅ done | `lib.rs:327–329` |
| 6.7 | `set_active` does **not** emit an event when called on an uninitialized contract (returns `NotInitialized` first) | ✅ done | `test.rs` — `test_set_active_uninitialized_no_event` |
| 6.8 | Events are tested for correct topic and data in the test suite | ✅ done | `test.rs` — pause/unpause, transfer_admin tests check event topics and data |
| 6.9 | Topic symbols are ≤ 9 bytes (Soroban `symbol_short!` limit) | ✅ done | `lib.rs` — `"init"`, `"claimed"`, `"paused"`, `"adm_xfer"`, `"upgrade"`, `"reclaimed"` are all ≤ 9 chars |

---

## 7. Upgrade Path Safety

| # | Check | Status | File / Lines |
|---|-------|--------|--------------|
| 7.1 | `upgrade` is admin-gated | ✅ done | `lib.rs:287–291` |
| 7.2 | `upgrade` emits an observable event so indexers detect upgrades | ✅ done | `lib.rs:297–299` |
| 7.3 | Documentation notes that all storage survives an upgrade | ✅ done | `lib.rs:276–283` — doc comment on `upgrade` |
| 7.4 | Documentation warns that removing or renaming `DataKey` variants breaks existing state | ✅ done | `lib.rs:281–282` |
| 7.5 | No time-lock or staged upgrade mechanism exists (acknowledged risk) | 🔲 todo | A time-locked upgrade (e.g. propose → delay → execute) would give claimants time to act before a malicious upgrade takes effect. Consider for v2. |
| 7.6 | `set_active(false)` before upgrading is documented as a best practice | ✅ done | `lib.rs:279–280` — doc comment recommends pausing before upgrade |
| 7.7 | The contract can be upgraded by the admin to fix critical bugs post-deployment | ✅ done | `lib.rs:286–299` — `upgrade` function exists and is tested implicitly via compilation |

---

## Open Items (todo)

| # | Item | Severity |
|---|------|----------|
| 7.5 | Add a time-locked upgrade mechanism | Medium |

---

## Scope of Audit

The following components are in scope for an external audit:

| Component | Path |
|-----------|------|
| Contract entry points | `contracts/airdrop/src/lib.rs` |
| Merkle proof verification | `contracts/airdrop/src/merkle.rs` |
| Storage keys and error types | `contracts/airdrop/src/types.rs` |
| Contract test suite | `contracts/airdrop/src/test.rs` |
| TypeScript Merkle builder (leaf/node hashing) | `sdk/src/merkle.ts` |
| Cross-language hash vector tests | `test-vectors/leaf-hash-vectors.json` |

Out of scope: CLI, web frontend, GitHub Actions workflows.

Closes #47
