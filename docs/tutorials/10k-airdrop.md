# Building a 10 000-Address Airdrop from Scratch

This tutorial walks you through every step of running a production-scale
Merkle airdrop on Stellar — from assembling your recipient list all the way to
monitoring on-chain claims.

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 20+ | https://nodejs.org |
| pnpm | 8+ | `npm i -g pnpm` |
| Rust + Cargo | stable | https://rustup.rs |
| `wasm32v1-none` target | – | `rustup target add wasm32v1-none` |
| Stellar CLI | latest | [docs](https://developers.stellar.org/docs/tools/cli) |

You also need a funded Stellar account. On testnet, use Friendbot:

```bash
curl "https://friendbot.stellar.org?addr=$(stellar keys address deployer)"
```

---

## Step 1 — Prepare the CSV

Create a file named `airdrop.csv` with one `address,amount` pair per line.
Amounts are integer token units (no decimals). Lines starting with `#` are
ignored.

```csv
# address,amount
GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR,1000
GCATS5YOVB6ROX2WUNKGNQ2MP3GMXDMKSG2O4N5CLX3A6W4PZGZZI55U,500
# ... 9 998 more rows
```

### Validation rules (enforced by the CLI)

| Rule | Constraint |
|------|-----------|
| Line length | ≤ 200 characters |
| Address | Valid Stellar Ed25519 key (`G…`) or contract address (`C…`) |
| Amount | Positive integer, ≤ 2^127 − 1 |
| No duplicates | Each address must appear once |

> **Generating test data**  
> A quick Python snippet to produce 10 000 random-looking rows:
>
> ```python
> import subprocess, random
>
> addresses = []
> for _ in range(10_000):
>     pub = subprocess.check_output(
>         ["stellar", "keys", "generate", "--no-fund", "--as-secret"],
>         text=True
>     ).strip()
>     # real workflow: collect existing wallet addresses instead
>     addresses.append(pub)
>
> with open("airdrop.csv", "w") as f:
>     for addr in addresses:
>         amount = random.randint(100, 10_000)
>         f.write(f"{addr},{amount}\n")
> ```
>
> For a real airdrop, your source of addresses will be a snapshot export from
> your application database or on-chain event logs.

---

## Step 2 — Generate the Merkle Tree

Install and build the CLI, then run `generate`:

```bash
cd cli
pnpm install
pnpm build

pnpm start generate \
  --input ../airdrop.csv \
  --output ../merkle-tree.json
```

Example output:

```
✔ Merkle tree generated!

  Root:    a3f2c1d8e4b7f0a1...   ← 64 hex chars (32 bytes)
  Entries: 10000
  Output:  ../merkle-tree.json
```

The output file looks like this (truncated):

```json
{
  "root": "a3f2c1d8e4b7f0a1...",
  "totalEntries": 10000,
  "totalAmount": "53127400",
  "generatedAt": "2026-10-17T00:00:00.000Z",
  "proofs": {
    "GCFIRY65...": {
      "amount": "1000",
      "proof": ["d1e2f3...", "a4b5c6...", "..."]
    }
  }
}
```

> **Important:** Keep `merkle-tree.json`. You will need to share it with
> recipients so they can locate their proof. The file contains no secrets —
> it is safe to host publicly.

---

## Step 3 — Verify the Root Locally

Before deploying, spot-check a few proofs with the SDK:

```ts
import { verifyProof } from "@soroban-merkle-airdrop/sdk";
import tree from "./merkle-tree.json";

const root = tree.root;
const proofs = tree.proofs as Record<string, { amount: string; proof: string[] }>;

// Check the first entry
const [address, entry] = Object.entries(proofs)[0];
const valid = verifyProof(root, address, BigInt(entry.amount), entry.proof);
console.log(`Proof valid for ${address}: ${valid}`); // → true
```

Run this before every deployment. An invalid proof at this stage means the
CSV was modified after `generate` ran, or the file was corrupted.

---

## Step 4 — Build the WASM Contract

```bash
cargo build \
  --manifest-path contracts/airdrop/Cargo.toml \
  --target wasm32v1-none \
  --release
```

The compiled artefact lands at:

```
target/wasm32v1-none/release/soroban_merkle_airdrop.wasm
```

---

## Step 5 — Deploy via `deploy.yml`

The repository ships a GitHub Actions workflow (`.github/workflows/deploy.yml`)
for automated deployment. Trigger it manually from the **Actions** tab:

1. Go to **Actions → Deploy Contract → Run workflow**.
2. Fill in the inputs:

| Input | Example value | Notes |
|-------|--------------|-------|
| `network` | `testnet` | Use `mainnet` only after full testing |
| `merkle_root` | `a3f2c1d8e4b7f0a1...` | From Step 2 |
| `total_amount` | `53127400` | Sum of all amounts (use `totalAmount` from the JSON) |
| `token_address` | `CTOKEN...` | Your SEP-41 token contract address |
| `expiration` | `1800000000` | Unix timestamp — must be in the future |

3. The workflow will:
   - Build the WASM
   - Upload it to the network
   - Deploy and initialise the contract
   - Print the **Contract ID** in the job summary

> **Setting up `DEPLOYER_SECRET_KEY`**  
> Add your deployer's secret key as a repository secret under  
> **Settings → Secrets and variables → Actions → New repository secret**,  
> named `DEPLOYER_SECRET_KEY`.  
> The workflow injects it via an environment variable — it is never echoed
> to the log.

### Manual deploy alternative

If you prefer the command line:

```bash
# 1. Upload the WASM
HASH=$(stellar contract upload \
  --network testnet \
  --source deployer \
  --wasm target/wasm32v1-none/release/soroban_merkle_airdrop.wasm)

# 2. Deploy the contract
CONTRACT_ID=$(stellar contract deploy \
  --network testnet \
  --source deployer \
  --wasm-hash "$HASH")

# 3. Initialise with the Merkle root
stellar contract invoke \
  --network testnet \
  --source deployer \
  --id "$CONTRACT_ID" \
  -- initialize \
  --admin "$(stellar keys address deployer)" \
  --token <TOKEN_CONTRACT> \
  --merkle_root <ROOT_FROM_STEP_2> \
  --total_amount <TOTAL_AMOUNT> \
  --expiration <UNIX_TIMESTAMP>

echo "Contract ID: $CONTRACT_ID"
```

---

## Step 6 — Share the Tree with Recipients

After deployment, recipients need two things to claim:

1. **The contract ID** — post it on your announcement page or airdrop UI.
2. **The Merkle tree JSON** — host `merkle-tree.json` on a public URL so the
   web UI can fetch it, or distribute it directly.

Recommended hosting options:

| Option | Cost | CORS |
|--------|------|------|
| GitHub Releases asset | Free | ✓ |
| AWS S3 + CloudFront | Low | ✓ (configure CORS policy) |
| Cloudflare R2 | Free tier | ✓ |
| GitHub Pages | Free | ✓ |

Once hosted, set `NEXT_PUBLIC_MERKLE_TREE_URL` in the web app's environment so
the claim UI pre-fills the URL field automatically:

```bash
# web/.env.production
NEXT_PUBLIC_AIRDROP_CONTRACT_ID=C<CONTRACT_ID>
NEXT_PUBLIC_MERKLE_TREE_URL=https://example.com/merkle-tree.json
```

---

## Step 7 — Monitor Claims via `status`

Use the CLI `status` command to watch progress in real time:

```bash
pnpm start status \
  --contract-id <CONTRACT_ID> \
  --network testnet
```

Example output:

```
  Status:       active
  Claimed:      3 412 / 10 000 (34.1 %)
  Remaining:    46 715 tokens
  Expiration:   2026-12-01 00:00:00 UTC
```

You can poll this periodically with a simple cron job or watch loop:

```bash
watch -n 60 'pnpm --prefix cli start status \
  --contract-id <CONTRACT_ID> \
  --network testnet'
```

---

## Gas / Storage Cost Notes

| Item | Cost estimate | Notes |
|------|--------------|-------|
| WASM upload | ~0.1 XLM | One-time, paid by deployer |
| Contract deploy | ~0.1 XLM | One-time, paid by deployer |
| `initialize` call | ~0.05 XLM | One-time, includes storage deposit |
| **On-chain storage** | **O(1)** | Only the 32-byte Merkle root is stored |
| Per-claim transaction | ~0.001–0.01 XLM | **Paid by the recipient**, not the organiser |
| Claimed-flag storage | ~0.00003 XLM × n | Small per-claimant storage deposit, refunded on reclaim |

**Total organiser cost for 10 000 recipients: ≈ 0.3–0.5 XLM** (contract
setup only). The gas cost scales to recipients, not the organiser — this is
the core economic advantage of the Merkle pattern.

Merkle proof depth for 10 000 entries ≈ ⌈log₂(10 000)⌉ = **14 hashes**.
Each claim submits 14 × 32 = 448 bytes of proof data, keeping transaction
sizes small and fees low regardless of total recipient count.

> **Storage deposit refund**  
> After the airdrop expires, call `reclaim` to recover deposited tokens.
> The per-claimant storage entries are also cleaned up at that point.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `invalid Stellar address` | Non-G/non-C address in CSV | Re-export with correct network addresses |
| `amount exceeds maximum` | Amount ≥ 2^127 | Check for unit confusion (e.g. raw stroops vs tokens) |
| `line too long` | CSV has extra fields | Ensure exactly two columns: address, amount |
| Proof verification fails | CSV modified after `generate` | Re-run `generate` on the original CSV |
| `transaction simulation failed` | Insufficient balance | Fund the deployer account before deploying |
| Claims not found on-chain | Wrong `--network` | Confirm CLI and web use the same network |

---

## Further Reading

- [Architecture overview](../architecture.md)
- [Deploying guide](../deploying.md)
- [SDK API reference](../../sdk/src/merkle.ts)
- [Example end-to-end script](../../examples/full-workflow.ts)
