# Frequently Asked Questions

This document answers common questions about soroban-merkle-airdrop — from
first-time users trying to claim tokens to operators deploying and managing
their own airdrop contract.

---

## General

### What is a Merkle proof?

A Merkle proof is a compact cryptographic argument that a particular piece of
data (in this case, your `(address, amount)` pair) is a member of a larger
dataset without revealing the rest of the dataset.

The airdrop organiser builds a **Merkle tree** from the full distribution list
off-chain. Only the 32-byte **root hash** of the tree is stored on-chain.
When you claim, you supply your allocation amount and a short list of
**sibling hashes** — the proof — that lets the contract recompute the root.
If the recomputed root matches the stored root, the proof is valid and the
contract transfers your tokens.

A proof for a list of 10,000 recipients is only ~13 hashes long (≈ log₂ 10,000),
so it fits comfortably inside a single Soroban transaction.

---

### How is the Merkle tree structured?

Leaves are hashed as:

```
leaf = SHA-256(
         SHA-256(contract_strkey_bytes) ++    # domain separator
         SHA-256(address_strkey_bytes)  ++    # claimant
         amount_16_byte_big_endian            # allocation
       )
```

The contract address is included as a **domain separator** (see [docs/replay-attack-analysis.md](replay-attack-analysis.md)). Interior nodes are hashed as:

```
node = SHA-256(min(left, right) ++ max(left, right))
```

Sorting before hashing makes the tree **position-independent**: the same
distribution always produces the same root regardless of the order entries
appear in the input CSV.

---

### How do I generate the Merkle tree?

Use the CLI's `generate` command, pointing it at a CSV file with one
`address,amount` entry per line:

```bash
# Install the CLI
cd cli && pnpm install && pnpm build

# Generate
pnpm start generate \
  --input airdrop.csv \
  --output merkle-tree.json
# → Prints Merkle root: 0xabc123...
```

The output JSON contains the root and every recipient's proof. Store it safely
— you will need it during deployment (`initialize`) and to distribute proofs to
recipients. The file is meant to be read-only after generation; re-generating
from the same CSV always produces the same root.

---

### What if my address is not in the list?

If your address does not appear in the distribution CSV, there is no valid
proof for your address and you cannot claim. The contract will return
`InvalidProof` on any attempt.

Options:
- Contact the airdrop organiser to confirm whether you are included.
- Ask the organiser to verify the CSV and regenerate the tree if your address
  was accidentally omitted.
- If the airdrop uses `update_merkle_root`, the organiser may be able to issue
  a corrected root that includes your address (note: already-claimed addresses
  cannot claim again even under a new root — see the contract's warning on
  `update_merkle_root`).

---

### Can I claim on behalf of someone else?

Yes. Use the `claim_for` contract function instead of `claim`:

```bash
stellar contract invoke --id <CONTRACT_ID> --source operator -- \
  claim_for \
  --claimant <RECIPIENT_ADDRESS> \
  --amount <AMOUNT> \
  --proof <JSON_ARRAY_OF_PROOF_HASHES>
```

`claim_for` does **not** require the recipient to sign. The Merkle proof
binds the `(claimant, amount)` pair to the on-chain root, so an operator
cannot redirect tokens — they always land in `claimant`'s wallet, not the
caller's.

This is useful for gasless UX: an operator or relayer pays Stellar network
fees while the recipient only needs to provide their proof.

---

### What happens to unclaimed tokens?

Unclaimed tokens remain locked in the contract until the admin calls
`reclaim()`. Reclaim is only permitted **after** the `expiration` timestamp
set at initialisation. When called, the contract's entire remaining token
balance is transferred back to the admin address.

The reclaim event includes the amount transferred and the expiration timestamp:

```
topic: ("reclaimed", admin)
data:  (balance, expiration)
```

If all recipients claimed before the deadline, `balance` will be 0 and no
transfer occurs — but the event is still emitted.

---

### Is there a deadline to claim?

The contract has **no claim deadline**. The `expiration` field only gates the
admin's `reclaim()` call — it does not prevent new claims.

Claims are valid at any ledger timestamp as long as the contract still holds
tokens. If the admin calls `reclaim()` after the expiration and drains the
contract, any subsequent claim will fail because the token contract rejects a
transfer from a zero-balance account.

---

## Proof Generation & Verification

### How do I verify my proof off-chain?

The TypeScript SDK exports a `verifyProof` helper:

```typescript
import { buildMerkleTree, verifyProof } from '@soroban-merkle-airdrop/sdk';

const { root, proofs } = buildMerkleTree([
  { address: "GABC...", amount: 1000n },
  { address: "GDEF...", amount: 500n },
]);

const valid = verifyProof({
  contractId: "C...",     // the deployed airdrop contract
  address:    "GABC...",
  amount:     1000n,
  proof:      proofs["GABC..."],
  root,
});

console.log(valid); // true
```

You can also verify against the stored on-chain root by querying
`merkle_root()` first and substituting it for `root` above. Any mismatch
indicates either a wrong amount, wrong address, or a stale proof from a
different tree version.

---

### Why does my proof fail on the contract but verify off-chain?

The most common causes:

| Cause | Fix |
|---|---|
| Proof was generated for a different contract address | Regenerate proofs with the correct deployed contract ID as domain separator |
| Amount mismatch (e.g. off-by-one, different precision) | Confirm the exact integer amount (in base token units, not decimals) |
| Wrong address format (lowercase vs Stellar strkey) | Use the full Stellar strkey (`G...` for accounts, `C...` for contracts) |
| Stale proof from an old root after `update_merkle_root` | Re-generate proofs from the updated tree |
| Network mismatch (testnet vs mainnet contract ID) | Ensure you are using the contract ID for the correct network |

---

### What does the expiration timestamp mean?

`expiration` is a **Unix timestamp in seconds** stored at initialisation. It
represents the earliest moment the admin can call `reclaim()` to recover
unclaimed tokens.

The contract checks `env.ledger().timestamp() >= expiration`. Stellar ledger
timestamps approximate wall-clock time and increase monotonically; they are not
strictly real-time, but are close enough for day/week-scale windows.

To set a 30-day window:

```bash
# Current Unix time + 30 days in seconds
EXPIRATION=$(( $(date +%s) + 30 * 24 * 3600 ))
```

Then pass `--expiration $EXPIRATION` to the `initialize` call.

---

## Deployment & Operations

### Why is the contract WASM needed?

The contract WASM is the compiled Rust bytecode that runs inside the Soroban
host on Stellar. Deploying a contract is a two-step process:

1. **Upload** the WASM to the network — this produces a 32-byte `wasm_hash`
   that uniquely identifies the bytecode.
2. **Deploy** an instance — using the `wasm_hash`, the network creates a new
   contract address with its own isolated storage.

```bash
# Step 1 — upload bytecode
stellar contract upload \
  --network testnet \
  --source deployer \
  --wasm soroban_merkle_airdrop.wasm
# → <WASM_HASH>

# Step 2 — deploy instance
stellar contract deploy \
  --network testnet \
  --source deployer \
  --wasm-hash <WASM_HASH>
# → <CONTRACT_ID>
```

The WASM binary is attached to every [GitHub Release](https://github.com/eogenyi23-creator/soroban-merkle-airdrop/releases)
along with its SHA-256 hash so you can verify integrity before uploading.

---

### How do I initialize the contract after deploying?

Call `initialize` with the admin address, token address, Merkle root, total
supply, and expiration timestamp. The admin must have already approved the
token transfer (or hold the tokens):

```bash
stellar contract invoke \
  --network testnet \
  --source deployer \
  --id <CONTRACT_ID> \
  -- initialize \
  --admin   <ADMIN_ADDRESS> \
  --token   <TOKEN_CONTRACT_ID> \
  --merkle_root <ROOT_FROM_GENERATE> \
  --total_amount 1000000 \
  --expiration $(($(date +%s) + 2592000))
```

Optional parameters `--claimed_ttl` and `--instance_ttl` control Soroban
storage TTLs (in ledgers). Leave them unset to use the defaults (~2-year TTL).

---

### How do I pause or unpause the airdrop?

Call `set_active` with `true` (unpause) or `false` (pause). Only the admin can
do this:

```bash
# Pause
stellar contract invoke --id <CONTRACT_ID> --source admin \
  -- set_active --active false

# Unpause
stellar contract invoke --id <CONTRACT_ID> --source admin \
  -- set_active --active true
```

While paused, all `claim` and `claim_for` calls return `NotActive`.

---

### Can I update the Merkle root after deployment?

Yes, via `update_merkle_root`. This replaces the on-chain root with a new one,
which is useful for correcting errors or adding new recipients:

```bash
stellar contract invoke --id <CONTRACT_ID> --source admin \
  -- update_merkle_root \
  --new_root <NEW_ROOT_HEX> \
  --new_total <NEW_TOTAL>
```

**Important:** Existing `Claimed` flags are **not** reset. Any address that
already claimed under the old root cannot claim again — even if it appears in
the new tree with a different amount. Deploy a separate contract if a
corrected allocation must reach an already-claimed address.

---

### How do I transfer admin ownership?

Use `transfer_admin`:

```bash
stellar contract invoke --id <CONTRACT_ID> --source current_admin \
  -- transfer_admin --new_admin <NEW_ADMIN_ADDRESS>
```

The current admin must sign. Once transferred, all admin-only functions
(`set_active`, `reclaim`, `update_merkle_root`, `upgrade`, `transfer_admin`)
require the new admin's signature.

---

### What happens if the contract gets archived (TTL expires)?

Soroban's state-archival mechanism archives contract storage once its TTL
reaches zero, making the contract inaccessible. The `restore()` function lets
**anyone** extend the instance TTL back to the configured value — no auth
required:

```bash
stellar contract invoke --id <CONTRACT_ID> --source anyone \
  -- restore
```

To avoid archival in production, monitor the instance TTL and call `restore()`
before it reaches zero, or configure a longer TTL at initialisation via
`--instance_ttl`.

---

## Troubleshooting

### The CLI says "Merkle root mismatch" — what does that mean?

Your local `merkle-tree.json` was generated with a different distribution list
than the one committed to the on-chain contract. Common causes:

- The organiser updated the root after you downloaded the proof file.
- You are using a proof file for a different network (testnet vs mainnet).
- The proof file was corrupted or partially overwritten.

Fix: re-download the latest `merkle-tree.json` from the organiser and
re-generate your proof, or query the contract's `merkle_root()` to confirm
which root is currently active:

```bash
stellar contract invoke --id <CONTRACT_ID> --source anyone \
  -- merkle_root
```

---

### Can I run the full workflow locally without a real Stellar node?

Yes. The Soroban test harness in `contracts/airdrop/src/test.rs` runs entirely
in-process — no node required. Run:

```bash
cargo test --manifest-path contracts/airdrop/Cargo.toml
```

For the TypeScript SDK:

```bash
cd sdk && pnpm test
```

For a full end-to-end dry run (no keys needed):

```bash
DRY_RUN=1 npx ts-node examples/full-workflow.ts
```

This prints the unsigned transaction XDR without submitting anything.

---

### Where can I find more documentation?

| Document | Description |
|---|---|
| [docs/architecture.md](architecture.md) | System design and component overview |
| [docs/deploying.md](deploying.md) | Step-by-step deployment guide |
| [docs/events.md](events.md) | All on-chain events and their schemas |
| [docs/contract-abi.md](contract-abi.md) | Full contract ABI reference |
| [docs/threat-model.md](threat-model.md) | Security analysis and threat model |
| [docs/replay-attack-analysis.md](replay-attack-analysis.md) | Domain separation and replay protection |
| [docs/contributing.md](contributing.md) | How to contribute to the project |
