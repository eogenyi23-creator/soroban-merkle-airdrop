/**
 * Typed client for the soroban-merkle-airdrop contract.
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
  Networks,
} from "@stellar/stellar-sdk";
import type { ClaimProof, ClaimResult, NetworkConfig } from "./types.js";

export function createAirdropClient(config: NetworkConfig) {
  const server = new rpc.Server(config.rpcUrl, { allowHttp: false });
  const contractInst = new Contract(config.contractId);

  /** Check if an address has already claimed. */
  async function isClaimed(address: string): Promise<boolean> {
    const result = await simulateRead(
      contractInst.call("is_claimed", new Address(address).toScVal())
    );
    return scValToNative(result) as boolean;
  }

  /** Check if the airdrop is currently active. */
  async function isActive(): Promise<boolean> {
    const result = await simulateRead(contractInst.call("is_active"));
    return scValToNative(result) as boolean;
  }

  /** Fetch the Merkle root stored in the contract. */
  async function merkleRoot(): Promise<string | null> {
    const result = await simulateRead(contractInst.call("merkle_root"));
    const native = scValToNative(result);
    if (!native) return null;
    return Buffer.from(native as Uint8Array).toString("hex");
  }

  /** Fetch total tokens deposited. */
  async function totalDeposited(): Promise<bigint> {
    const result = await simulateRead(contractInst.call("total_deposited"));
    return BigInt(scValToNative(result) as number);
  }

  /**
   * Submit a claim transaction.
   *
   * @param claimProof - The proof package from `buildMerkleTree`.
   * @param signerSecretKey - The claimant's Stellar secret key (S...).
   */
  async function claim(
    claimProof: ClaimProof,
    signerSecretKey: string
  ): Promise<ClaimResult> {
    const keypair = Keypair.fromSecret(signerSecretKey);
    const sourceAccount = await server.getAccount(keypair.publicKey());

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
          new Address(keypair.publicKey()).toScVal(),
          nativeToScVal(claimProof.amount, { type: "i128" }),
          proofScVal
        )
      )
      .setTimeout(30)
      .build();

    const simResult = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simResult)) {
      throw new Error(`Simulation failed: ${simResult.error}`);
    }

    const preparedTx = rpc.assembleTransaction(tx, simResult).build();
    preparedTx.sign(keypair);

    const sendResult = await server.sendTransaction(preparedTx);
    if (sendResult.status === "ERROR") {
      throw new Error(`Transaction failed: ${sendResult.errorResult?.toXDR("base64")}`);
    }

    const txHash = sendResult.hash;
    while (true) {
      await sleep(2000);
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
        throw new Error(`Transaction failed on-chain: ${txHash}`);
      }
    }
  }

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
      throw new Error(`Read simulation failed: ${simResult.error}`);
    }
    return (simResult as rpc.Api.SimulateTransactionSuccessResponse).result!.retval;
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  return { isClaimed, isActive, merkleRoot, totalDeposited, claim };
}
