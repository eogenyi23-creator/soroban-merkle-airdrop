# Mainnet Deployment Checklist

> Use this checklist before every mainnet deployment. Copy it into your deployment
> tracking issue or ops run-book and tick each item off before proceeding.
>
> Related resources:
> - Full deployment guide: [docs/deploying.md](deploying.md)
> - Automated workflow: [.github/workflows/deploy.yml](../.github/workflows/deploy.yml)
> - Security policy: [SECURITY.md](../SECURITY.md)

---

## 1. Contract Audit Status

- [ ] A formal third-party security audit has been completed **or** the team has
      explicitly accepted the risk of deploying unaudited code and documented that
      decision.
      > ⚠️  As of now this contract is **pre-audit**. See [SECURITY.md](../SECURITY.md).
      > Do not deposit significant funds without an independent audit.
- [ ] All known audit findings have been remediated and re-verified.
- [ ] The WASM artifact being deployed was built from the exact commit that was
      audited (verify `git rev-parse HEAD` matches the audit report commit SHA).

---

## 2. Testnet Dry-Run

- [ ] A complete end-to-end testnet deployment was run **with the same CSV / Merkle
      tree** you intend to use on mainnet.
- [ ] At least one test claim was submitted and confirmed on testnet.
- [ ] The `reclaim` path was verified on testnet (advance the clock or use a short
      expiration on the testnet deployment to confirm it works).
- [ ] The web UI or CLI was pointed at the testnet contract and tested with a real
      wallet.

---

## 3. Merkle Root Verification

- [ ] Re-run `merkle-airdrop generate` against the **canonical, final** airdrop CSV:
      ```bash
      cd cli
      pnpm start generate --input ../airdrop.csv --output ../merkle-tree.json
      ```
- [ ] The Merkle root printed by the command matches the root you recorded in the
      original generation run.
- [ ] The `merkle-tree.json` file is stored in a location recipients can access
      (e.g. GitHub Releases, S3 with public read, IPFS) and the URL is final before
      initialising the contract.
- [ ] Spot-check at least 3 proofs from the tree using `verifyProof` from the SDK:
      ```ts
      import { verifyProof } from "@soroban-merkle-airdrop/sdk";
      console.log(verifyProof(root, address, amount, proof)); // must be true
      ```
- [ ] The sum of all allocations in the CSV equals the `total_amount` you will pass
      to `initialize`.

---

## 4. Token Balance Check

- [ ] The deployer account holds at least `total_amount` of the token that will be
      deposited into the contract.
- [ ] The deployer account has sufficient XLM to cover:
      - WASM upload fees
      - Contract deployment fees
      - Storage rent (contract entry TTL)
      - The `initialize` token-transfer transaction
      - A small buffer (≥ 10 XLM) for unexpected ledger cost fluctuations
- [ ] The token contract address (`token_address` input) is the **correct mainnet
      asset**. Cross-check against the issuer's official announcement or the
      Stellar Expert asset page.
- [ ] The deployer has issued an allowance to the airdrop contract **or** the
      token transfer is handled atomically by `initialize` (verify with the SDK or
      contract source).

---

## 5. Expiration Sanity Check

- [ ] The `expiration` Unix timestamp is **in the future** relative to the planned
      go-live date.
- [ ] The expiration window is reasonable for your recipient audience:
      - Minimum recommended: **30 days** after public announcement.
      - Typical: **90–180 days**.
      - Longer than 1 year is unusual and locks capital unnecessarily.
- [ ] You have calculated the timestamp correctly:
      ```bash
      # Linux: 90 days from now
      date -d "+90 days" +%s

      # macOS
      date -v+90d +%s
      ```
- [ ] A calendar reminder or monitoring alert is set for 7 days before expiration
      so the team can notify recipients.

---

## 6. Admin Key Custody

- [ ] The `admin` address passed to `initialize` is the **intended long-term admin**,
      not a temporary or CI/CD key.
- [ ] The admin keypair is stored in a hardware wallet or multi-sig setup — **not**
      only in the `DEPLOYER_SECRET_KEY` GitHub secret.
- [ ] If a separate deployer key was used for uploading and deploying, `transfer_admin`
      has been (or is planned to be) called to rotate to the permanent admin key:
      ```bash
      stellar contract invoke --network mainnet --source deployer \
        --id "$CONTRACT_ID" \
        -- transfer_admin --new_admin <PERMANENT_ADMIN_ADDRESS>
      ```
- [ ] Access to the admin key is limited to authorised personnel only (document who
      holds it).
- [ ] A key-rotation plan exists and is documented in case of compromise.

---

## 7. Monitoring Setup

- [ ] A Stellar account watch is configured for the admin address (e.g. via
      [Stellar Expert alerts](https://stellar.expert), [Horizon webhooks](https://developers.stellar.org/docs/data/horizon), or an internal monitor).
- [ ] An alert is set for unexpected `set_active(false)` or `reclaim` events.
- [ ] Claim rate is being tracked (at minimum, check `merkle-airdrop status` daily
      during the active period):
      ```bash
      merkle-airdrop status --network mainnet --contract-id "$CONTRACT_ID"
      ```
- [ ] A public communication channel (Discord, Twitter/X, email) is ready to
      notify recipients of the contract address and claim URL.
- [ ] You have a runbook for pausing the airdrop via `set_active(false)` if an
      incident is detected.

---

## 8. Reclaim Process

- [ ] The reclaim procedure is documented and accessible to the admin:
      ```bash
      # After expiration timestamp has passed:
      stellar contract invoke \
        --network mainnet \
        --source <admin-key> \
        --id "$CONTRACT_ID" \
        -- reclaim
      ```
      See [docs/deploying.md — Reclaiming Unclaimed Tokens](deploying.md#reclaiming-unclaimed-tokens).
- [ ] The destination of reclaimed tokens (treasury, burn address, etc.) is decided
      and documented **before** going live.
- [ ] A post-expiration task is scheduled in your team's project tracker to
      actually execute `reclaim`.

---

## 9. Workflow Gate (deploy.yml)

- [ ] You are triggering the deployment via the GitHub Actions workflow
      (`.github/workflows/deploy.yml`) rather than running commands locally,
      **or** you have a documented reason for a manual deployment.
- [ ] If using the workflow, the `mainnet` GitHub Actions environment has been
      configured with required reviewers so the job cannot run without human
      approval (see [docs/deploying.md — GitHub Actions: deploy.yml](deploying.md#github-actions-deployyml)).
- [ ] All workflow inputs have been double-checked before clicking **Approve**:
      - `network`: `mainnet`
      - `merkle_root`: matches the root from step 3
      - `total_amount`: matches the sum from step 3
      - `token_address`: matches the verified address from step 4
      - `expiration`: matches the timestamp from step 5

---

## Sign-off

Before proceeding, confirm:

- [ ] All items above are checked.
- [ ] A second team member has reviewed this completed checklist.
- [ ] Deployment date/time has been communicated to the team.

**Operator:** ___________________________  **Date:** _______________

**Reviewer:** ___________________________  **Date:** _______________
