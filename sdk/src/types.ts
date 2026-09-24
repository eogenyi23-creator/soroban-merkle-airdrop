/** A single entry in the airdrop distribution list. */
export interface AirdropEntry {
  /** Stellar address of the recipient (G... or C...). */
  address: string;
  /** Token amount allocated to this recipient (in base units, e.g. stroops). */
  amount: bigint;
}

/** A claimant's proof package — everything needed to call `claim`. */
export interface ClaimProof {
  address: string;
  amount: bigint;
  /** Ordered list of sibling hashes (hex strings) from leaf to root. */
  proof: string[];
}

/** The full output of MerkleTree construction. */
export interface MerkleTreeResult {
  /** 32-byte Merkle root as a hex string. */
  root: string;
  /** Map from address → ClaimProof for every entry. */
  proofs: Map<string, ClaimProof>;
}

/** Network config for the airdrop contract client. */
export interface NetworkConfig {
  network: "testnet" | "mainnet";
  rpcUrl: string;
  networkPassphrase: string;
  contractId: string;
  /**
   * Maximum time in milliseconds to wait for a submitted transaction to be
   * confirmed on-chain. The polling loop throws an RpcError if this limit is
   * exceeded.
   *
   * @default 60000 (60 seconds)
   */
  pollTimeoutMs?: number;
}

/** Well-known network presets. */
export const NETWORKS: Record<string, Omit<NetworkConfig, "contractId">> = {
  testnet: {
    network: "testnet",
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
  },
  mainnet: {
    network: "mainnet",
    rpcUrl: "https://mainnet.sorobanrpc.com",
    networkPassphrase: "Public Global Stellar Network ; September 2015",
  },
};

/** Result returned from a claim transaction. */
export interface ClaimResult {
  success: boolean;
  txHash: string;
  address: string;
  amount: bigint;
}

// ─── Typed error classes ─────────────────────────────────────────────────────

/**
 * Numeric error codes returned by the on-chain airdrop contract.
 * These must stay in sync with the `AirdropError` enum in contracts/airdrop/src/types.rs.
 */
export enum AirdropError {
  AlreadyClaimed = 1,
  InvalidProof = 2,
  AirdropInactive = 3,
  InsufficientFunds = 4,
  Unauthorized = 5,
}

/**
 * Thrown when the airdrop contract returns a known error code.
 * Allows callers to distinguish contract-level failures from network issues.
 *
 * @example
 * ```ts
 * try {
 *   await client.claim(proof, secretKey);
 * } catch (err) {
 *   if (err instanceof AirdropContractError && err.code === AirdropError.AlreadyClaimed) {
 *     console.log("Already claimed");
 *   }
 * }
 * ```
 */
export class AirdropContractError extends Error {
  /** The numeric error code from the contract (maps to {@link AirdropError}). */
  readonly code: number;

  constructor(code: number, message?: string) {
    super(message ?? AirdropContractError.defaultMessage(code));
    this.name = "AirdropContractError";
    this.code = code;
    // Maintain proper prototype chain in transpiled ES5 output.
    Object.setPrototypeOf(this, AirdropContractError.prototype);
  }

  private static defaultMessage(code: number): string {
    switch (code) {
      case AirdropError.AlreadyClaimed:   return "Address has already claimed";
      case AirdropError.InvalidProof:     return "Invalid Merkle proof";
      case AirdropError.AirdropInactive:  return "Airdrop is not active";
      case AirdropError.InsufficientFunds: return "Insufficient contract funds";
      case AirdropError.Unauthorized:     return "Unauthorized";
      default:                            return `Contract error (code ${code})`;
    }
  }
}

/**
 * Thrown for network-level or RPC errors (connection failures, simulation errors,
 * transaction submission failures, polling timeouts).
 */
export class RpcError extends Error {
  /** The underlying cause (if available). */
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "RpcError";
    this.cause = cause;
    Object.setPrototypeOf(this, RpcError.prototype);
  }
}
