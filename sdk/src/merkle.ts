/**
 * Merkle tree builder for soroban-merkle-airdrop.
 *
 * Produces a binary Merkle tree from a list of (address, amount) pairs.
 * The on-chain contract uses SHA-256 with lexicographic node sorting, so
 * this implementation must match exactly.
 *
 * # Leaf hash
 *   SHA-256(strkey_address_bytes[32] ++ amount_big_endian[16])
 *
 * # Node hash
 *   SHA-256(min(left, right) ++ max(left, right))
 *   (sorted so the tree is position-independent)
 */

import { createHash } from "crypto";
import { StrKey } from "@stellar/stellar-sdk";
import type { AirdropEntry, ClaimProof, MerkleTreeResult } from "./types.js";

// ─── Hashing ────────────────────────────────────────────────────────────────

function sha256(data: Buffer): Buffer {
  return createHash("sha256").update(data).digest();
}

/**
 * Compute the leaf hash for a given (address, amount) pair.
 * Must match `merkle::leaf_hash` in the Rust contract.
 */
export function leafHash(address: string, amount: bigint): Buffer {
  // Decode the Stellar address to its raw 32-byte public key.
  let addrBytes: Buffer;
  if (StrKey.isValidEd25519PublicKey(address)) {
    addrBytes = Buffer.from(StrKey.decodeEd25519PublicKey(address));
  } else if (StrKey.isValidContract(address)) {
    addrBytes = Buffer.from(StrKey.decodeContract(address));
  } else {
    throw new Error(`Invalid Stellar address: ${address}`);
  }

  // Encode amount as 16-byte big-endian (i128 = two 64-bit words).
  const amountBuf = Buffer.alloc(16);
  const hi = amount >> 64n;
  const lo = amount & 0xffffffffffffffffn;
  amountBuf.writeBigInt64BE(BigInt.asIntN(64, hi), 0);
  amountBuf.writeBigUInt64BE(lo, 8);

  return sha256(Buffer.concat([addrBytes, amountBuf]));
}

/**
 * Hash two nodes together, sorting them lexicographically first.
 * Must match `merkle::hash_pair` in the Rust contract.
 */
export function hashPair(a: Buffer, b: Buffer): Buffer {
  const [first, second] = a.compare(b) <= 0 ? [a, b] : [b, a];
  return sha256(Buffer.concat([first, second]));
}

// ─── Tree builder ───────────────────────────────────────────────────────────

/**
 * Build a Merkle tree from a list of airdrop entries and return the root
 * and per-address claim proofs.
 *
 * @example
 * ```ts
 * const { root, proofs } = buildMerkleTree([
 *   { address: "GABC...", amount: 1000n },
 *   { address: "GDEF...", amount: 500n },
 * ]);
 * console.log("Merkle root:", root);
 * const proof = proofs.get("GABC...");
 * ```
 */
export function buildMerkleTree(entries: AirdropEntry[]): MerkleTreeResult {
  if (entries.length === 0) {
    throw new Error("Cannot build Merkle tree from empty list");
  }

  // Deduplicate by address.
  const seen = new Set<string>();
  const unique: AirdropEntry[] = [];
  for (const e of entries) {
    if (seen.has(e.address)) {
      throw new Error(`Duplicate address in airdrop list: ${e.address}`);
    }
    seen.add(e.address);
    unique.push(e);
  }

  // Compute leaves in order.
  const leaves: Buffer[] = unique.map((e) => leafHash(e.address, e.amount));

  // Build tree layer by layer.
  // `layers[0]` = leaf hashes, `layers[last]` = [root].
  const layers: Buffer[][] = [leaves];
  let current = leaves;

  while (current.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < current.length; i += 2) {
      if (i + 1 < current.length) {
        next.push(hashPair(current[i], current[i + 1]));
      } else {
        // Odd node: promote unchanged.
        next.push(current[i]);
      }
    }
    layers.push(next);
    current = next;
  }

  const root = current[0].toString("hex");

  // Build proofs for each leaf.
  const proofs = new Map<string, ClaimProof>();

  for (let i = 0; i < unique.length; i++) {
    const entry = unique[i];
    const proofHashes: string[] = [];
    let idx = i;

    for (let layer = 0; layer < layers.length - 1; layer++) {
      const nodes = layers[layer];
      const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
      if (siblingIdx < nodes.length) {
        proofHashes.push(nodes[siblingIdx].toString("hex"));
      }
      idx = Math.floor(idx / 2);
    }

    proofs.set(entry.address, {
      address: entry.address,
      amount: entry.amount,
      proof: proofHashes,
    });
  }

  return { root, proofs };
}

/**
 * Verify that a proof is valid against a given root.
 * Useful for off-chain validation before submitting a claim transaction.
 */
export function verifyProof(
  root: string,
  address: string,
  amount: bigint,
  proof: string[]
): boolean {
  let current = leafHash(address, amount);

  for (const sibling of proof) {
    current = hashPair(current, Buffer.from(sibling, "hex"));
  }

  return current.toString("hex") === root;
}
