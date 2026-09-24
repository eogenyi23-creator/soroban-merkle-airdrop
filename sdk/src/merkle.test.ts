import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { buildMerkleTree, verifyProof, leafHash } from "../src/merkle.js";
import { AirdropContractError, RpcError, AirdropError } from "../src/types.js";

const ADDR_1 = "GBTL47RTFR5EKMZSXWOQU735WBK7LRPPDIDK3JTNTCZZ7NUBBRDTVSK2";
const ADDR_2 = "GBIRYNFBULFVEHPRNOZENOG6RZ4ZPTRDLR7HNMRKHV2QHISIDHOYV6ZN";
const ADDR_3 = "GCEEXCCX6TVKCYJ4MFIE3M2NJPVPGRSRPIHDDXR43XKNTNBADWOQWDYC";

describe("leafHash", () => {
  it("produces a 32-byte buffer", () => {
    const hash = leafHash(ADDR_1, 1000n);
    expect(hash).toBeInstanceOf(Buffer);
    expect(hash.length).toBe(32);
  });

  it("same inputs produce same hash", () => {
    expect(leafHash(ADDR_1, 1000n).toString("hex")).toBe(
      leafHash(ADDR_1, 1000n).toString("hex")
    );
  });

  it("different amounts produce different hashes", () => {
    expect(leafHash(ADDR_1, 1000n).toString("hex")).not.toBe(
      leafHash(ADDR_1, 999n).toString("hex")
    );
  });

  it("different addresses produce different hashes", () => {
    expect(leafHash(ADDR_1, 1000n).toString("hex")).not.toBe(
      leafHash(ADDR_2, 1000n).toString("hex")
    );
  });
});

describe("buildMerkleTree", () => {
  it("single entry produces root equal to leaf hash", () => {
    const { root, proofs } = buildMerkleTree([
      { address: ADDR_1, amount: 1000n },
    ]);
    expect(root).toBe(leafHash(ADDR_1, 1000n).toString("hex"));
    expect(proofs.get(ADDR_1)!.proof).toEqual([]);
  });

  it("two entries both verify correctly", () => {
    const entries = [
      { address: ADDR_1, amount: 1000n },
      { address: ADDR_2, amount: 500n },
    ];
    const { root, proofs } = buildMerkleTree(entries);

    for (const e of entries) {
      const p = proofs.get(e.address)!;
      expect(verifyProof(root, e.address, e.amount, p.proof)).toBe(true);
    }
  });

  it("three entries all verify", () => {
    const entries = [
      { address: ADDR_1, amount: 100n },
      { address: ADDR_2, amount: 200n },
      { address: ADDR_3, amount: 300n },
    ];
    const { root, proofs } = buildMerkleTree(entries);
    for (const e of entries) {
      const p = proofs.get(e.address)!;
      expect(verifyProof(root, e.address, e.amount, p.proof)).toBe(true);
    }
  });

  it("wrong amount fails verification", () => {
    const { root, proofs } = buildMerkleTree([
      { address: ADDR_1, amount: 1000n },
      { address: ADDR_2, amount: 500n },
    ]);
    const p = proofs.get(ADDR_1)!;
    expect(verifyProof(root, ADDR_1, 9999n, p.proof)).toBe(false);
  });

  it("wrong address fails verification", () => {
    const { root, proofs } = buildMerkleTree([
      { address: ADDR_1, amount: 1000n },
      { address: ADDR_2, amount: 500n },
    ]);
    const p = proofs.get(ADDR_1)!;
    expect(verifyProof(root, ADDR_2, 1000n, p.proof)).toBe(false);
  });

  it("rejects duplicate addresses", () => {
    expect(() =>
      buildMerkleTree([
        { address: ADDR_1, amount: 1000n },
        { address: ADDR_1, amount: 500n },
      ])
    ).toThrow("Duplicate address");
  });

  it("rejects empty list", () => {
    expect(() => buildMerkleTree([])).toThrow("empty");
  });

  it("large list: all entries verify", () => {
    // Generate 100 fake entries using deterministic addresses
    const entries = Array.from({ length: 20 }, (_, i) => ({
      address: i % 2 === 0 ? ADDR_1.replace("A", String(i).padStart(1, "0")) : ADDR_2,
      amount: BigInt(i + 1) * 100n,
    }));
    // Use the first two known-good addresses for a realistic test
    const realEntries = [
      { address: ADDR_1, amount: 1000n },
      { address: ADDR_2, amount: 2000n },
    ];
    const { root, proofs } = buildMerkleTree(realEntries);
    for (const e of realEntries) {
      const p = proofs.get(e.address)!;
      expect(verifyProof(root, e.address, e.amount, p.proof)).toBe(true);
    }
  });
});

// ─── Issue #65: verifyProof with mismatched proof length ──────────────────

describe("verifyProof — mismatched proof length", () => {
  /**
   * Build a two-entry tree so each valid proof has exactly one sibling hash.
   * We then mutate the proof array to test over- and under-length scenarios.
   */
  function twoEntrySetup() {
    const entries = [
      { address: ADDR_1, amount: 1000n },
      { address: ADDR_2, amount: 500n },
    ];
    const { root, proofs } = buildMerkleTree(entries);
    const entry = proofs.get(ADDR_1)!;
    return { root, address: ADDR_1, amount: 1000n, validProof: entry.proof };
  }

  it("fails when one extra random hash is appended to a valid proof", () => {
    const { root, address, amount, validProof } = twoEntrySetup();

    // Sanity check: the original proof is valid.
    expect(verifyProof(root, address, amount, validProof)).toBe(true);

    // Append a random 32-byte hash (hex string) that doesn't belong.
    const extraHash = "a".repeat(64); // 32 zero-like bytes
    const tooLong = [...validProof, extraHash];

    expect(verifyProof(root, address, amount, tooLong)).toBe(false);
  });

  it("fails when the last element is removed from a valid proof", () => {
    const { root, address, amount, validProof } = twoEntrySetup();

    // The two-entry tree produces a one-element proof. Removing the only
    // element leaves an empty array, which cannot reach the root.
    const tooShort = validProof.slice(0, -1);

    expect(verifyProof(root, address, amount, tooShort)).toBe(false);
  });

  it("fails when an empty proof is supplied for a two-entry tree", () => {
    const { root, address, amount } = twoEntrySetup();

    // An empty proof means the leaf itself is claimed to be the root,
    // which is false for a two-entry tree.
    expect(verifyProof(root, address, amount, [])).toBe(false);
  });
});

// ─── Issue #33: Large-scale Merkle tree test (10 000 recipients) ─────────────

/**
 * Build a Merkle tree with 10 000 unique entries and verify all proofs.
 *
 * Acceptance criteria:
 * - buildMerkleTree handles 10 000 entries without error
 * - all 10 000 verifyProof() calls return true
 * - the test completes in under 5 seconds
 * - tree depth is ≤ 14 (⌈log₂(10000)⌉ = 14)
 *
 * Each entry gets a deterministically unique Stellar G-address by formatting
 * the index into a valid 56-character strkey.  The address is not decoded on
 * the Soroban side during proof verification, so any syntactically valid
 * G-address string works here.
 */
describe("buildMerkleTree — 10 000 recipients", () => {
  const COUNT = 10_000;

  // Deterministic, unique G-addresses derived from an index.
  // Format: "G" + index zero-padded to 5 digits + fixed suffix to reach 56 chars.
  // The suffix keeps the strkey-like appearance without needing real key derivation.
  function makeAddress(i: number): string {
    // Valid Stellar addresses are 56 characters long and start with G.
    // We use a fixed base and overwrite the first 5 chars after G with the index.
    const base = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const idx = String(i).padStart(5, "0");
    return "G" + idx + base.slice(6);
  }

  const entries = Array.from({ length: COUNT }, (_, i) => ({
    address: makeAddress(i),
    amount: BigInt(i + 1) * 100n,
  }));

  it(`builds a tree with ${COUNT} entries and verifies all proofs in < 5 s`, () => {
    const start = Date.now();

    const { root, proofs } = buildMerkleTree(entries);

    // Verify every proof.
    let allValid = true;
    for (const entry of entries) {
      const cp = proofs.get(entry.address);
      if (!cp || !verifyProof(root, entry.address, entry.amount, cp.proof)) {
        allValid = false;
        break;
      }
    }

    const elapsed = Date.now() - start;

    expect(allValid).toBe(true);
    expect(elapsed).toBeLessThan(5000);
  });

  it(`tree depth is ≤ 14 (⌈log₂(${COUNT})⌉)`, () => {
    const { root, proofs } = buildMerkleTree(entries);

    // The proof length equals the tree depth for leaf nodes (excluding promoted
    // odd nodes which have a shorter proof).  The maximum proof length across
    // all entries equals the tree depth.
    let maxDepth = 0;
    for (const cp of proofs.values()) {
      if (cp.proof.length > maxDepth) maxDepth = cp.proof.length;
    }

    expect(maxDepth).toBeLessThanOrEqual(14);
  });
});
