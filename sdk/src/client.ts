/**
 * @module client
 * @description
 * Typed RPC client for the soroban-merkle-airdrop contract.
 *
 * Create a client with {@link createAirdropClient} and use it to query
 * contract state or submit claim transactions.
 */

import {
  Contract,
  rpc,
  TransactionBuilder,
  BASE_FEE,
  xdr,
  scValToNative,
  nativeToScVal,
  Keypair,
  Address,
  Account,
} from "@stellar/stellar-sdk";
import type { Transaction } from "@stellar/stellar-sdk";
import type { ClaimProof, ClaimResult, NetworkConfig } from "./types.js";
import { AirdropContractError, RpcError } from "./types.js";
import { verifyProof } from "./merkle.js";

/**
 * Create a typed client for an on-chain soroban-merkle-airdrop contract.
 *
 * All RPC calls are made against the `rpcUrl` and `networkPassphrase` specified
 * in `config`. The returned object is a plain object (not a class instance) — all
 * methods share the same closure-bound `config`.
 *
 * @param config - Network configuration and contract address. Use {@link NETWORKS}
 *   for well-known testnet/mainnet presets.
 * @returns An object with methods for querying contract state and submitting claims.
 *
 * @example
 * ```ts
 * import { createAirdropClient, NETWORKS } from '@soroban-merkle-airdrop/sdk';
 *
 * const client = createAirdropClient({
 *   ...NETWORKS.testnet,
 *   contractId: "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
 * });
 *
 * const active = await client.isActive();
 * console.log("Airdrop active:", active);
 * ```
 */
export function createAirdropClient(config: NetworkConfig) {
  const server = new rpc.Server(config.rpcUrl, { allowHttp: false });
  const contractInst = new Contract(config.contractId);
  const pollTimeoutMs = config.pollTimeoutMs ?? 60_000;

  /**
   * Check if an address has already claimed their tokens.
   *
   * @param address - Stellar strkey address to check (G... or C...).
   * @returns `true` if the address has already claimed, `false` otherwise.
   *
   * @example
   * ```ts
   * const claimed = await client.isClaimed("GABC...");
   * if (claimed) console.log("Already claimed");
   * ```
   */
  async function isClaimed(address: string): Promise<boolean> {
    const result = await simulateRead(
      contractInst.call("is_claimed", new Address(address).toScVal())
    );
    return scValToNative(result) as boolean;
  }

  /**
   * Check if the airdrop is currently active.
   *
   * An airdrop becomes inactive after it has expired and the admin has
   * reclaimed the remaining tokens.
   *
   * @returns `true` if the airdrop is active and accepting claims.
   *
   * @example
   * ```ts
   * const active = await client.isActive();
   * if (!active) console.log("Airdrop has ended");
   * ```
   */
  async function isActive(): Promise<boolean> {
    const result = await simulateRead(contractInst.call("is_active"));
    return scValToNative(result) as boolean;
  }

  /**
   * Fetch the Merkle root stored in the contract.
   *
   * Compare this against the root produced by {@link buildMerkleTree} to
   * confirm that a `merkle-tree.json` file corresponds to this contract.
   *
   * @returns The 64-character hex Merkle root string, or `null` if the
   *   contract has not been initialised yet.
   *
   * @example
   * ```ts
   * const root = await client.merkleRoot();
   * console.log("On-chain root:", root);
   * ```
   */
  async function merkleRoot(): Promise<string | null> {
    const result = await simulateRead(contractInst.call("merkle_root"));
    const native = scValToNative(result);
    if (!native) return null;
    return Buffer.from(native as Uint8Array).toString("hex");
  }

  /**
   * Fetch the total tokens deposited into the airdrop contract.
   *
   * @returns Total deposited amount in base units (stroops for XLM-based tokens).
   *
   * @example
   * ```ts
   * const total = await client.totalDeposited();
   * console.log("Total tokens:", total.toString());
   * ```
   */
  async function totalDeposited(): Promise<bigint> {
    const result = await simulateRead(contractInst.call("total_deposited"));
    return BigInt(scValToNative(result) as number);
  }

  /** Return the number of successful claims so far. */
  async function claimedCount(): Promise<number> {
    const result = await simulateRead(contractInst.call("claimed_count"));
    return scValToNative(result) as number;
  }

  /**
   * Fetch the total tokens distributed through successful claims.
   *
   * This metric starts at 0 when the airdrop is initialised and grows
   * by the claimed amount with every successful `claim`, `claim_for`, or
   * `batch_claim` entry. Use it alongside {@link totalDeposited} to
   * calculate a progress ratio for dashboards.
   *
   * @returns Total claimed amount in base units (stroops for XLM-based tokens).
   *
   * @example
   * ```ts
   * const claimed = await client.totalClaimed();
   * const total = await client.totalDeposited();
   * const pct = Number(claimed * 100n / total);
   * console.log(`${pct}% of tokens claimed`);
   * ```
   */
  async function totalClaimed(): Promise<bigint> {
    const result = await simulateRead(contractInst.call("total_claimed"));
    return BigInt(scValToNative(result) as number);
  }

  /**
   * Fetch the expiration timestamp (Unix seconds) after which unclaimed tokens
   * can be reclaimed by the admin.
   *
   * Use this to display a countdown or expiration warning in a UI.
   *
   * @returns Unix timestamp in seconds as a bigint, or `null` if the contract
   *   has not been initialised or has no expiration set.
   *
   * @example
   * ```ts
   * const exp = await client.expiration();
   * if (exp !== null) {
   *   const date = new Date(Number(exp) * 1000);
   *   console.log("Airdrop expires:", date.toISOString());
   * }
   * ```
   */
  async function expiration(): Promise<bigint | null> {
    const result = await simulateRead(contractInst.call("expiration"));
    const native = scValToNative(result);
    if (native === null || native === undefined) return null;
    return BigInt(native as number);
  }

  /**
   * Fetch the contract's current token balance (remaining claimable tokens).
   *
   * Queries the SEP-41 token contract for this contract's balance. As
   * recipients claim tokens the balance decreases from `totalDeposited`.
   *
   * @returns Current token balance in base units, or `0n` if the contract
   *   is not yet initialised.
   *
   * @example
   * ```ts
   * const balance = await client.remainingBalance();
   * console.log("Tokens left:", balance.toString());
   * ```
   */
  async function remainingBalance(): Promise<bigint> {
    const result = await simulateRead(contractInst.call("remaining_balance"));
    return BigInt(scValToNative(result) as number);
  }

  /**
   * Fetch the decimal precision of the airdrop token by querying its SEP-41
   * `decimals()` function.
   *
   * SEP-41 tokens expose a `decimals()` entry point that returns a `u32` value.
   * For example, a token with `decimals() = 7` represents `1_000_000_0` raw
   * units as `1.0000000` in display notation.
   *
   * @returns Token decimal count as a number, or `null` if the token address
   *   is not set, the token contract does not implement `decimals()`, or the
   *   call fails for any reason.
   *
   * @example
   * ```ts
   * const decimals = await client.tokenDecimals();
   * if (decimals !== null) {
   *   const display = formatAmount(rawAmount, decimals);
   * }
   * ```
   */
  async function tokenDecimals(): Promise<number | null> {
    // First we need to know the token contract address.
    let tokenAddress: string;
    try {
      const tokenResult = await simulateRead(contractInst.call("token"));
      const native = scValToNative(tokenResult);
      if (!native) return null;
      // native is an Address object — convert to string
      tokenAddress = native.toString();
    } catch {
      return null;
    }

    // Now query decimals() on the token contract directly.
    try {
      const tokenContract = new Contract(tokenAddress);
      const result = await simulateRead(tokenContract.call("decimals"));
      const native = scValToNative(result);
      if (native === null || native === undefined) return null;
      return Number(native);
    } catch {
      return null;
    }
  }

  /**
   * Submit a claim transaction on behalf of the claimant.
   *
   * This method signs and submits the transaction using a raw Stellar secret key.
   * For browser-based flows where the user signs with Freighter, use
   * {@link buildClaimTransaction} + {@link submitSignedTransaction} instead.
   *
   * @param claimProof - The proof package for the claimant, as returned by
   *   `buildMerkleTree(...).proofs.get(address)`.
   * @param signerSecretKey - The claimant's Stellar secret key (S...).
   * @returns A {@link ClaimResult} with the on-chain transaction hash and claimed amount.
   * @throws {@link AirdropContractError} if the contract rejects the claim
   *   (e.g. already claimed, invalid proof, airdrop inactive).
   * @throws {@link RpcError} for network-level failures.
   *
   * @example
   * ```ts
   * import { buildMerkleTree, createAirdropClient, NETWORKS } from '@soroban-merkle-airdrop/sdk';
   *
   * const { root, proofs } = buildMerkleTree(entries);
   * const client = createAirdropClient({ ...NETWORKS.testnet, contractId });
   *
   * const proof = proofs.get("GABC...")!;
   * const result = await client.claim(proof, "SABC...");
   * console.log("Claimed in tx:", result.txHash);
   * ```
   */
  async function buildClaimTx(
    claimProof: ClaimProof,
    signerPublicKey: string
  ) {
    const sourceAccount = await server.getAccount(signerPublicKey);

    // Convert proof array of hex strings → ScVal vec of BytesN<32>
    const proofScVal = xdr.ScVal.scvVec(
      claimProof.proof.map((h) => {
        const bytes = Buffer.from(h, "hex");
        return xdr.ScVal.scvBytes(bytes);
      })
    );

    const tx = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(
        contractInst.call(
          "claim",
          new Address(signerPublicKey).toScVal(),
          nativeToScVal(claimProof.amount, { type: "i128" }),
          proofScVal
        )
      )
      .setTimeout(30)
      .build();

    return tx;
  }

  /**
   * Simulate a claim transaction and return the estimated fee and resource
   * usage without submitting anything on-chain.
   *
   * @param claimProof      - The proof package from `buildMerkleTree`.
   * @param signerPublicKey - The claimant's Stellar public key (G...).
   * @returns               Fee estimate in stroops and Soroban resource details.
   */
  async function simulateClaim(
    claimProof: ClaimProof,
    signerPublicKey: string
  ): Promise<SimulateClaimResult> {
    const tx = await buildClaimTx(claimProof, signerPublicKey);

    const simResult = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simResult)) {
      throw new Error(`Simulation failed: ${simResult.error}`);
    }

    const successResult = simResult as rpc.Api.SimulateTransactionSuccessResponse;

    // The minResourceFee from simulation is the Soroban resource fee.
    // Add it to the base fee to get the total estimated fee.
    const resourceFee = BigInt(successResult.minResourceFee ?? "0");
    const baseFee = BigInt(BASE_FEE);
    const totalFee = (baseFee + resourceFee).toString();

    // Extract resource consumption details from the simulation footprint.
    const resources = successResult.transactionData
      ? extractResources(successResult.transactionData)
      : {};

    return {
      fee: totalFee,
      resources,
    };
  }

  /**
   * Submit a claim transaction.
   *
   * Internally reuses the same simulation logic as `simulateClaim` to avoid
   * duplication — the simulation result is used to assemble the final tx.
   *
   * @param claimProof      - The proof package from `buildMerkleTree`.
   * @param signerSecretKey - The claimant's Stellar secret key (S...).
   */
  async function claim(
    claimProof: ClaimProof,
    signerSecretKey: string
  ): Promise<ClaimResult> {
    const keypair = Keypair.fromSecret(signerSecretKey);
    const tx = await buildClaimTx(claimProof, keypair.publicKey());

    const simResult = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simResult)) {
      const contractCode = parseContractErrorCode(simResult.error);
      if (contractCode !== null) {
        throw new AirdropContractError(contractCode);
      }
      throw new RpcError(`Simulation failed: ${simResult.error}`);
    }

    const preparedTx = rpc.assembleTransaction(tx, simResult).build();
    preparedTx.sign(keypair);

    const sendResult = await server.sendTransaction(preparedTx);
    if (sendResult.status === "ERROR") {
      throw new RpcError(
        `Transaction submission failed`,
        sendResult.errorResult?.toXDR("base64")
      );
    }

    const txHash = sendResult.hash;
    const claimDeadline = Date.now() + pollTimeoutMs;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await sleep(2000);
      if (Date.now() >= claimDeadline) {
        throw new RpcError(
          `Transaction confirmation timeout after ${pollTimeoutMs}ms: ${txHash}`
        );
      }
      const poll = await server.getTransaction(txHash);
      if (poll.status === "SUCCESS") {
        return {
          success: true,
          txHash,
          address: claimProof.address,
          amount: claimProof.amount,
        };
      }
      if (poll.status === "FAILED") {
        throw new RpcError(`Transaction failed on-chain: ${txHash}`);
      }
    }
  }

  /**
   * Build an unsigned claim transaction XDR string for external signing
   * (e.g. via a browser wallet like Freighter).
   *
   * The caller is responsible for signing the returned XDR and submitting it
   * via {@link submitSignedTransaction}.
   *
   * @param claimProof - The proof package for the claimant, as returned by
   *   `buildMerkleTree(...).proofs.get(address)`.
   * @returns Base64-encoded unsigned transaction envelope XDR suitable for
   *   passing to `signTransaction()` from `@stellar/freighter-api`.
   * @throws {@link AirdropContractError} if simulation rejects the claim.
   * @throws {@link RpcError} for network-level failures.
   *
   * @example
   * ```ts
   * import { signTransaction } from '@stellar/freighter-api';
   *
   * const unsignedXdr = await client.buildClaimTransaction(proof);
   * const signedXdr = await signTransaction(unsignedXdr, { networkPassphrase });
   * const result = await client.submitSignedTransaction(signedXdr, proof);
   * ```
   */
  async function buildClaimTransaction(claimProof: ClaimProof): Promise<string> {
    const sourceAccount = await server.getAccount(claimProof.address);

    const proofScVal = xdr.ScVal.scvVec(
      claimProof.proof.map((h) => {
        const bytes = Buffer.from(h, "hex");
        return xdr.ScVal.scvBytes(bytes);
      })
    );

    const tx = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(
        contractInst.call(
          "claim",
          new Address(claimProof.address).toScVal(),
          nativeToScVal(claimProof.amount, { type: "i128" }),
          proofScVal
        )
      )
      .setTimeout(30)
      .build();

    const simResult = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simResult)) {
      const contractCode = parseContractErrorCode(simResult.error);
      if (contractCode !== null) {
        throw new AirdropContractError(contractCode);
      }
      throw new RpcError(`Simulation failed: ${simResult.error}`);
    }

    // Assemble (adds auth + footprint) and return as unsigned XDR.
    return rpc.assembleTransaction(tx, simResult).build().toXDR();
  }

  /**
   * Submit a signed transaction XDR produced by an external wallet.
   *
   * Call this after {@link buildClaimTransaction} and signing the result with
   * Freighter (or any other Stellar wallet).
   *
   * @param signedXdr - Base64-encoded signed transaction envelope XDR.
   * @param claimProof - The original proof used to build the transaction
   *   (used to populate the returned {@link ClaimResult}).
   * @returns A {@link ClaimResult} with the on-chain transaction hash and claimed amount.
   * @throws {@link RpcError} for submission failures or polling timeouts.
   *
   * @example
   * ```ts
   * const unsignedXdr = await client.buildClaimTransaction(proof);
   * const signedXdr = await signTransaction(unsignedXdr, { networkPassphrase });
   * const result = await client.submitSignedTransaction(signedXdr, proof);
   * console.log("Tx hash:", result.txHash);
   * ```
   */
  async function submitSignedTransaction(
    signedXdr: string,
    claimProof: ClaimProof
  ): Promise<ClaimResult> {
    const txEnvelope = TransactionBuilder.fromXDR(signedXdr, config.networkPassphrase) as Transaction;
    const sendResult = await server.sendTransaction(txEnvelope);
    if (sendResult.status === "ERROR") {
      throw new RpcError(
        `Transaction submission failed`,
        sendResult.errorResult?.toXDR("base64")
      );
    }

    const txHash = sendResult.hash;
    const submitDeadline = Date.now() + pollTimeoutMs;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await sleep(2000);
      if (Date.now() >= submitDeadline) {
        throw new RpcError(
          `Transaction confirmation timeout after ${pollTimeoutMs}ms: ${txHash}`
        );
      }
      const poll = await server.getTransaction(txHash);
      if (poll.status === "SUCCESS") {
        return {
          success: true,
          txHash,
          address: claimProof.address,
          amount: claimProof.amount,
        };
      }
      if (poll.status === "FAILED") {
        throw new RpcError(`Transaction failed on-chain: ${txHash}`);
      }
    }
  }

  /**
   * Verify a claim proof against the on-chain Merkle root.
   *
   * Fetches the current Merkle root from the contract and verifies the proof
   * locally using {@link verifyProof} from the SDK's Merkle module. Useful for
   * confirming a proof is valid before submitting a claim transaction.
   *
   * @param claimProof - The proof package for the claimant (from `buildMerkleTree`).
   * @returns `true` if the proof is valid against the on-chain root,
   *   `false` if it is invalid **or** if the contract has not been initialised
   *   (i.e. `merkleRoot()` returns `null`).
   *
   * @example
   * ```ts
   * const valid = await client.verifyClaimProof(proof);
   * if (!valid) {
   *   console.error("Proof is invalid — tree may be for a different contract");
   * }
   * ```
   */
  async function verifyClaimProof(claimProof: ClaimProof): Promise<boolean> {
    const root = await merkleRoot();
    if (root === null) {
      return false;
    }
    return verifyProof(root, config.contractId, claimProof.address, claimProof.amount, claimProof.proof);
  }

  // ─── Internal helpers ──────────────────────────────────────────────────────

  async function simulateRead(operation: xdr.Operation): Promise<xdr.ScVal> {
    const dummy = Keypair.random();
    const account = new Account(dummy.publicKey(), "0");
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const simResult = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simResult)) {
      throw new RpcError(`Read simulation failed: ${simResult.error}`);
    }
    return (simResult as rpc.Api.SimulateTransactionSuccessResponse).result!.retval;
  }

  /**
   * Extract a human-readable resource summary from the simulation's
   * SorobanTransactionData XDR object.
   */
  function extractResources(
    transactionData: rpc.Api.SimulateTransactionSuccessResponse["transactionData"]
  ): SimulateClaimResult["resources"] {
    try {
      // transactionData may be an XDR object or base64 string depending on SDK version
      const sorobanData =
        typeof transactionData === "string"
          ? xdr.SorobanTransactionData.fromXDR(transactionData, "base64")
          : (transactionData as unknown as xdr.SorobanTransactionData);

      const resources = sorobanData.resources();
      return {
        instructions: resources.instructions(),
        readBytes: resources.readBytes(),
        writeBytes: resources.writeBytes(),
        readEntries: resources.footprint().readOnly().length,
        writeEntries: resources.footprint().readWrite().length,
      };
    } catch {
      // If extraction fails (e.g., SDK version differences), return an empty object
      return {};
    }
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  return {
    isClaimed,
    isActive,
    merkleRoot,
    totalDeposited,
    totalClaimed,
    expiration,
    remainingBalance,
    tokenDecimals,
    claim,
    buildClaimTransaction,
    submitSignedTransaction,
    verifyClaimProof,
  };
}

/**
 * Parse a numeric contract error code from a Soroban simulation error string.
 * Soroban formats contract errors as: `"Error(Contract, #N)"` where N is the code.
 *
 * @param error - Raw error string from the Soroban RPC simulation response.
 * @returns The numeric error code, or `null` if the string does not match.
 * @internal
 */
function parseContractErrorCode(error: string): number | null {
  const match = /Error\s*\(\s*Contract\s*,\s*#(\d+)\s*\)/i.exec(error);
  if (match) {
    return parseInt(match[1], 10);
  }
  return null;
}
