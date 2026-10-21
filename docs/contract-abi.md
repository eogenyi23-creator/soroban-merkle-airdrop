# soroban-merkle-airdrop — Contract ABI

> **Version:** 0.1.0  
> **Source:** [`contracts/airdrop/src/lib.rs`](../contracts/airdrop/src/lib.rs)  
> **Machine-readable spec:** [`docs/contract-spec.json`](./contract-spec.json)

This document describes all public functions, their parameter types, return types,
events, error codes, and storage layout for the `soroban-merkle-airdrop` Soroban
smart contract.

---

## Table of Contents

- [Functions](#functions)
  - [initialize](#initialize)
  - [claim](#claim)
  - [set\_active](#set_active)
  - [reclaim](#reclaim)
  - [merkle\_root](#merkle_root)
  - [is\_claimed](#is_claimed)
  - [is\_active](#is_active)
  - [token](#token)
  - [admin](#admin)
  - [total\_deposited](#total_deposited)
  - [expiration](#expiration)
- [Events](#events)
- [Error Codes](#error-codes)
- [Storage Layout](#storage-layout)
- [Hashing Algorithms](#hashing-algorithms)
- [Keeping This Document Up To Date](#keeping-this-document-up-to-date)

---

## Functions

### `initialize`

Initialise the airdrop. Must be called **once** before any claims. The caller
deposits `total_amount` tokens from the SEP-41 token contract into this contract.

**Authorization:** `admin` must sign (via `require_auth`).

| Parameter      | Type          | Description                                                                 |
| -------------- | ------------- | --------------------------------------------------------------------------- |
| `admin`        | `Address`     | Controls the airdrop; may pause or reclaim unclaimed tokens.                |
| `token`        | `Address`     | SEP-41 token contract address to distribute.                                |
| `merkle_root`  | `BytesN<32>`  | 32-byte Merkle root of the `(address, amount)` distribution tree.           |
| `total_amount` | `i128`        | Total tokens to distribute; transferred from `admin` into the contract.     |
| `expiration`   | `u64`         | Unix timestamp (seconds) after which `reclaim()` is permitted.              |

**Returns:** `Result<(), AirdropError>`

**Emits:**
```
topic: (Symbol("init"), Address(admin))
data:  (BytesN<32>(merkle_root), i128(total_amount))
```

**Errors:** `AlreadyInitialized` (1), `ZeroAmount` (6)

---

### `claim`

Claim tokens from the airdrop. The claimant supplies their allocated `amount`
and a Merkle `proof` demonstrating inclusion in the distribution tree. Tokens
are transferred immediately on success.

**Authorization:** `claimant` must sign (via `require_auth`).

| Parameter | Type               | Description                                                   |
| --------- | ------------------ | ------------------------------------------------------------- |
| `claimant` | `Address`         | Address claiming tokens; must sign the transaction.           |
| `amount`   | `i128`            | Token amount allocated to this claimant.                      |
| `proof`    | `Vec<BytesN<32>>` | Ordered list of sibling hashes from leaf to root.             |

**Returns:** `Result<(), AirdropError>`

**Emits:**
```
topic: (Symbol("claimed"), Address(claimant))
data:  i128(amount)
```

**Errors:** `NotActive` (4), `NotInitialized` (5), `ZeroAmount` (6), `AlreadyClaimed` (2), `InvalidProof` (3)

---

### `set_active`

Pause or unpause the airdrop. Only the admin can call this.

**Authorization:** stored `admin` must sign.

| Parameter | Type   | Description                                |
| --------- | ------ | ------------------------------------------ |
| `active`  | `bool` | `true` to activate, `false` to pause.     |

**Returns:** `Result<(), AirdropError>`

**Errors:** `NotInitialized` (5)

---

### `reclaim`

Reclaim unclaimed tokens after the airdrop expires. Admin only.  
Can only be called once `env.ledger().timestamp() >= expiration`.
Transfers the contract's remaining token balance back to the admin.

**Authorization:** stored `admin` must sign.

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| _(none)_  | —    | —           |

**Returns:** `Result<i128, AirdropError>` — the amount reclaimed.

**Emits:**
```
topic: (Symbol("reclaimed"), Address(admin))
data:  i128(balance)
```

**Errors:** `NotInitialized` (5), `NotYetExpired` (7)

---

### `merkle_root`

Return the Merkle root stored in this contract.

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| _(none)_  | —    | —           |

**Returns:** `Option<BytesN<32>>` — the 32-byte root, or `None` if not initialised.

---

### `is_claimed`

Return `true` if the given claimant has already claimed.

| Parameter  | Type      | Description          |
| ---------- | --------- | -------------------- |
| `claimant` | `Address` | Address to check.    |

**Returns:** `bool`

---

### `is_active`

Return whether the airdrop is currently active.

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| _(none)_  | —    | —           |

**Returns:** `bool` — `true` if active, `false` if paused or uninitialised.

---

### `token`

Return the SEP-41 token contract address being distributed.

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| _(none)_  | —    | —           |

**Returns:** `Option<Address>`

---

### `admin`

Return the admin address.

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| _(none)_  | —    | —           |

**Returns:** `Option<Address>`

---

### `total_deposited`

Return total tokens deposited at initialisation.

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| _(none)_  | —    | —           |

**Returns:** `i128` — `0` if not yet initialised.

---

### `expiration`

Return the expiration timestamp (unix seconds) after which `reclaim` is allowed.

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| _(none)_  | —    | —           |

**Returns:** `Option<u64>`

---

## Events

All events emitted by the contract follow the Soroban event format:
`(topics_tuple, data_val)`. Topics are encoded as a Soroban `Vec<Val>`.

| Function      | Topic                                        | Data                                    |
| ------------- | -------------------------------------------- | --------------------------------------- |
| `initialize`  | `(Symbol("init"), Address(admin))`           | `(BytesN<32>(merkle_root), i128(total_amount))` |
| `claim`       | `(Symbol("claimed"), Address(claimant))`     | `i128(amount)`                          |
| `reclaim`     | `(Symbol("reclaimed"), Address(admin))`      | `i128(balance)`                         |

---

## Error Codes

Errors are represented as `u32` values in the contract spec XDR.

| Code | Name                | Description                                                                       |
| ---- | ------------------- | --------------------------------------------------------------------------------- |
| `1`  | `AlreadyInitialized` | `initialize()` may only be called once.                                          |
| `2`  | `AlreadyClaimed`    | Each address may only claim once.                                                 |
| `3`  | `InvalidProof`      | The Merkle proof does not verify against the stored root.                         |
| `4`  | `NotActive`         | The airdrop has been paused by the admin.                                         |
| `5`  | `NotInitialized`    | `initialize()` has not been called yet.                                           |
| `6`  | `ZeroAmount`        | Zero or negative amount supplied to `initialize()` or `claim()`.                  |
| `7`  | `NotYetExpired`     | `reclaim()` called before the expiration timestamp has been reached.              |

---

## Storage Layout

### Instance storage (shared contract state)

| Key              | Type         | Description                                         |
| ---------------- | ------------ | --------------------------------------------------- |
| `MerkleRoot`     | `BytesN<32>` | 32-byte Merkle root of the distribution tree.       |
| `TokenAddress`   | `Address`    | SEP-41 token contract being distributed.            |
| `Admin`          | `Address`    | Admin address.                                      |
| `TotalDeposited` | `i128`       | Total tokens deposited at initialisation.           |
| `Active`         | `bool`       | Whether the airdrop is currently active.            |
| `Expiration`     | `u64`        | Unix timestamp after which `reclaim()` is allowed.  |

Instance storage TTL: **~2 years** (12,614,400 ledgers).

### Persistent storage (per-claimant)

| Key               | Type   | Description                                              |
| ----------------- | ------ | -------------------------------------------------------- |
| `Claimed(Address)` | `bool` | Whether a given address has claimed. One entry per claimant. |

Persistent entry TTL: **~2 years** (12,614,400 ledgers), refreshed on each claim.

---

## Hashing Algorithms

### Leaf hash

```
leaf = SHA-256(
  SHA-256(utf8_bytes(strkey_address))   -- 32 bytes
  ++
  big_endian_16_bytes(amount)           -- 16 bytes
)
```

1. Encode the Stellar address as its strkey UTF-8 string bytes  
   (e.g. `GABC...` for G-accounts, `CABC...` for contract addresses).
2. SHA-256 hash those bytes to produce a stable 32-byte address digest.
3. Encode the token amount as a 16-byte big-endian integer.
4. Concatenate `(address_digest ++ amount_bytes)` and SHA-256 hash to produce
   the 32-byte leaf.

The double-hash is necessary because Soroban's `Address` type does not expose
raw public-key bytes in contract code; hashing the strkey string is the stable
canonical substitute used by both the Rust contract and the TypeScript SDK.

### Node hash

```
node = SHA-256(min(left, right) ++ max(left, right))
```

Children are **sorted by byte value** before hashing, making the tree
position-independent. The same distribution produces the same root regardless
of the input list order, and proofs work from any leaf position.

---

## Keeping This Document Up To Date

This file must be updated whenever the contract interface changes:

1. Add, remove, or rename any public function in `contracts/airdrop/src/lib.rs`.
2. Add, remove, or rename an error variant in `contracts/airdrop/src/types.rs`.
3. Change a function's parameter types, return type, or event structure.

Update both this file (`docs/contract-abi.md`) and the machine-readable spec
(`docs/contract-spec.json`) in the same commit as the contract change.
