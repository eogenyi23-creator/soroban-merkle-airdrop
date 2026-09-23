/**
 * Contract error translation utilities for the `merkle-airdrop` CLI.
 *
 * Soroban / Stellar RPC surfaces contract errors in various formats depending
 * on the SDK version and network:
 *
 *   "Error(Contract, #1)"
 *   "contract error: AlreadyClaimed"
 *   "HostError: Value(Status(ContractError(1)))"
 *
 * `translateContractError` maps well-known codes to human-readable messages
 * and passes unknown errors through unchanged.
 */

/** Mapping: [pattern, human-readable message] */
const ERROR_MAP: [RegExp, string][] = [
  [/#1\b|AlreadyClaimed/i,  "This address has already claimed their allocation."],
  [/#2\b|NotActive/i,       "The airdrop is currently paused. Please try again later."],
  [/#3\b|InvalidProof/i,    "Invalid Merkle proof. Your proof file may be outdated."],
];

/**
 * Translate a raw contract error string to a human-readable message.
 *
 * Unknown errors are returned unchanged so operators always see diagnostic
 * output.
 */
export function translateContractError(raw: string): string {
  for (const [pattern, friendly] of ERROR_MAP) {
    if (pattern.test(raw)) return friendly;
  }
  return raw;
}
