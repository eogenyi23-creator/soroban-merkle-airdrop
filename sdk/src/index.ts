// Public API surface for @soroban-merkle-airdrop/sdk
// All public types and functions are re-exported from this single entry point.
// Consumers: import { buildMerkleTree } from '@soroban-merkle-airdrop/sdk'

// ─── Merkle tree ─────────────────────────────────────────────────────────────
export { buildMerkleTree, leafHash, hashPair, verifyProof } from "./merkle.js";

// ─── Contract client ─────────────────────────────────────────────────────────
export { createAirdropClient } from "./client.js";

// ─── Types and presets ───────────────────────────────────────────────────────
export { NETWORKS, AirdropContractError, AirdropError, RpcError } from "./types.js";
export type {
  AirdropEntry,
  ClaimProof,
  MerkleTreeResult,
  NetworkConfig,
  ClaimResult,
} from "./types.js";
