/**
 * Unit tests for translateContractError (issue #66).
 *
 * The function must map well-known Soroban contract error strings to
 * human-readable messages and pass unknown errors through unchanged.
 */

import { describe, it, expect } from "vitest";
import { translateContractError } from "../errors.js";

describe("translateContractError", () => {
  // ── AlreadyClaimed ──────────────────────────────────────────────────────

  it("translates 'Error(Contract, #1)' to AlreadyClaimed message", () => {
    const result = translateContractError("Error(Contract, #1)");
    expect(result).toBe("This address has already claimed their allocation.");
  });

  it("translates string containing 'AlreadyClaimed'", () => {
    const result = translateContractError("contract error: AlreadyClaimed");
    expect(result).toBe("This address has already claimed their allocation.");
  });

  it("translates AlreadyClaimed case-insensitively", () => {
    const result = translateContractError("HostError: alreadyclaimed");
    expect(result).toBe("This address has already claimed their allocation.");
  });

  // ── NotActive ───────────────────────────────────────────────────────────

  it("translates 'Error(Contract, #2)' to NotActive message", () => {
    const result = translateContractError("Error(Contract, #2)");
    expect(result).toBe("The airdrop is currently paused. Please try again later.");
  });

  it("translates string containing 'NotActive'", () => {
    const result = translateContractError("contract error: NotActive");
    expect(result).toBe("The airdrop is currently paused. Please try again later.");
  });

  it("translates NotActive case-insensitively", () => {
    const result = translateContractError("HostError: notactive");
    expect(result).toBe("The airdrop is currently paused. Please try again later.");
  });

  // ── InvalidProof ────────────────────────────────────────────────────────

  it("translates 'Error(Contract, #3)' to InvalidProof message", () => {
    const result = translateContractError("Error(Contract, #3)");
    expect(result).toBe("Invalid Merkle proof. Your proof file may be outdated.");
  });

  it("translates string containing 'InvalidProof'", () => {
    const result = translateContractError("contract error: InvalidProof");
    expect(result).toBe("Invalid Merkle proof. Your proof file may be outdated.");
  });

  it("translates InvalidProof case-insensitively", () => {
    const result = translateContractError("HostError: invalidproof");
    expect(result).toBe("Invalid Merkle proof. Your proof file may be outdated.");
  });

  // ── Unknown errors — pass through unchanged ─────────────────────────────

  it("returns raw message for unknown error codes", () => {
    const raw = "Error(Contract, #99)";
    expect(translateContractError(raw)).toBe(raw);
  });

  it("returns raw message for network errors", () => {
    const raw = "Network request failed: ECONNREFUSED";
    expect(translateContractError(raw)).toBe(raw);
  });

  it("returns raw message for empty string", () => {
    expect(translateContractError("")).toBe("");
  });

  it("returns raw message for unrelated error text", () => {
    const raw = "TypeError: Cannot read properties of undefined";
    expect(translateContractError(raw)).toBe(raw);
  });
});
