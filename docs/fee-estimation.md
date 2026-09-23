# Fee & Storage Estimation for Large Airdrops

This guide explains the on-chain storage costs and fee model for
`soroban-merkle-airdrop` so operators can budget accurately before deploying a
large-scale distribution.

---

## Background: Soroban storage types

Soroban has three storage types, each with a different cost and TTL model:

| Type       | Used for                          | TTL model        |
|------------|-----------------------------------|------------------|
| Instance   | Core contract data (root, admin…) | Shared with contract instance |
| Persistent | Per-claimant `Claimed` flags      | Independent TTL per entry |
| Temporary  | Not used by this contract         | Cheap; expires automatically |

For this contract every successful `claim()` writes one **persistent** entry:

```
DataKey::Claimed(claimant_address)  →  bool (true)
```

Each entry occupies ledger space and accrues **rent** until its TTL expires.

---

## Per-entry cost formula

Soroban charges rent in **stroops** (1 XLM = 10 000 000 stroops) based on:

```
rent_per_ledger = write_fee_per_1kb  ×  entry_size_in_bytes / 1024
total_rent      = rent_per_ledger    ×  TTL_in_ledgers
```

For a `Claimed` entry:

- **Entry size:** ~100 bytes (XDR-encoded key + boolean value + ledger metadata overhead)
- **TTL:** `CLAIMED_TTL = 12_614_400` ledgers ≈ 2 years (at ~5 s/ledger)

Using current Stellar **testnet/mainnet** write fee benchmarks
(approximately 1 000 stroops per 1 KB per ledger):

```
rent_per_ledger ≈ 1_000 × (100 / 1_024) ≈ 98 stroops / ledger
rent_per_entry  ≈ 98 × 12_614_400 ≈ 1_236_211_200 stroops ≈ 123.6 XLM
```

> **Important:** Actual fees depend on network load and the current fee schedule.
> Always use the Stellar fee-estimation tools (links below) for an up-to-date
> figure before deploying to mainnet.

---

## How CLAIMED_TTL affects cost

`CLAIMED_TTL` is defined in `contracts/airdrop/src/lib.rs`:

```rust
const CLAIMED_TTL: u32 = 12_614_400;           // ~2 years
const CLAIMED_TTL_THRESHOLD: u32 = CLAIMED_TTL / 2;
```

A claimant's entry is written at claim time with a TTL of `CLAIMED_TTL` ledgers.
The TTL is **not** automatically extended after that — an entry that is never
read again will expire and be archived after approximately 2 years.

If your airdrop runs for longer than 1 year, claimants who claimed early could
have their `Claimed` flag archived. This is fine for this contract because:

1. The airdrop has an `expiration` timestamp after which no new claims are
   accepted anyway.
2. Even if a flag archives, the tokens were already transferred — the only risk
   would be a re-claim attempt, which the archived entry can no longer prevent.
   Therefore **ensure `CLAIMED_TTL` comfortably exceeds your airdrop window**.

To shorten TTL (reducing costs) or lengthen it (increasing safety window),
change `CLAIMED_TTL` before deploying:

```rust
// ~6 months — suitable for short airdrops (lower storage cost)
const CLAIMED_TTL: u32 = 3_153_600;

// ~4 years — maximum safety margin for long-running airdrops
const CLAIMED_TTL: u32 = 25_228_800;
```

---

## Worked examples

The table below uses the current approximate mainnet rate.  Run the
[Stellar Laboratory fee estimator](https://laboratory.stellar.org/#?network=public)
for exact figures.

### 10 000 recipients

| Item                    | Calculation                        | Cost        |
|-------------------------|------------------------------------|-------------|
| `Claimed` entries       | 10 000                             | —           |
| Rent per entry          | ~123.6 XLM (2-year TTL)            | —           |
| **Total storage rent**  | 10 000 × 123.6 XLM                 | **~1 236 XLM** |
| Claim tx fee (avg)      | ~0.001 XLM × 10 000                | ~10 XLM     |
| **Paid by claimants**   | Each claimant pays their own tx + rent | — |

> Storage rent for persistent entries is paid at write time by the **claimant**
> as part of their transaction fee, not by the organiser.

### 100 000 recipients

| Item                    | Calculation                        | Cost          |
|-------------------------|------------------------------------|---------------|
| `Claimed` entries       | 100 000                            | —             |
| Rent per entry          | ~123.6 XLM (2-year TTL)            | —             |
| **Total storage rent**  | 100 000 × 123.6 XLM               | **~12 360 XLM** |
| Claim tx fee (avg)      | ~0.001 XLM × 100 000              | ~100 XLM      |
| **Paid by claimants**   | Distributed across all claimants   | — |

### 1 000 000 recipients

| Item                    | Calculation                        | Cost           |
|-------------------------|------------------------------------|----------------|
| `Claimed` entries       | 1 000 000                          | —              |
| Rent per entry          | ~123.6 XLM (2-year TTL)            | —              |
| **Total storage rent**  | 1 000 000 × 123.6 XLM             | **~123 600 XLM** |
| Claim tx fee (avg)      | ~0.001 XLM × 1 000 000            | ~1 000 XLM     |
| **Paid by claimants**   | Distributed across all claimants   | — |

Key takeaway: **storage rent scales linearly** with recipient count and TTL
length, but the cost is distributed among claimants — the organiser only pays
for instance storage (fixed, ~a few XLM for the 2-year window).

---

## Instance storage

The contract stores six instance keys (root, token, admin, total_deposited,
active, expiration). Instance storage TTL is `INSTANCE_TTL = 12_614_400`
ledgers (~2 years) and is refreshed on **every read query** (issue #61) so the
contract stays live as long as anyone queries it.

Instance storage cost is negligible: ~6 entries × ~50 bytes × 12 614 400
ledgers × rent rate ≈ a few XLM total, paid by the deployer.

---

## Fee estimation tools

- **Stellar Laboratory** — simulate transactions and inspect fee breakdowns:
  https://laboratory.stellar.org/
- **Stellar Expert fee stats** — live network fee histogram:
  https://stellar.expert/explorer/public/network-activity
- **Stellar Developers: Fees and Metering** — authoritative reference:
  https://developers.stellar.org/docs/learn/fundamentals/fees-and-metering
- **Stellar Developers: State Archival** — TTL, rent, and archival mechanics:
  https://developers.stellar.org/docs/learn/encyclopedia/storage/state-archival

---

## Summary checklist for operators

- [ ] Choose `CLAIMED_TTL` that covers your airdrop window plus a safety buffer.
- [ ] Inform claimants that each claim transaction includes storage rent (~a few XLM).
- [ ] Deploy on testnet first and use Stellar Laboratory to inspect actual fees.
- [ ] For 100 000+ recipients, consider announcing estimated claim costs in your
      airdrop communications.
