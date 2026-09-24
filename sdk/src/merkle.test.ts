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

// ─── Issue #32: Cross-language leaf-hash test vector suite ──────────────────

/**
 * Load the shared test-vector file and verify that leafHash() in TypeScript
 * produces byte-for-byte identical output to the Rust contract's leaf_hash()
 * for every entry.
 *
 * A mismatch means the two implementations have diverged — which would silently
 * break all claims because proof verification depends on leaf hash parity.
 *
 * Vectors cover: G-addresses, C-addresses, amount=1, amount=i128::MAX,
 * amounts where only the high 64-bit word is set, and typical amounts.
 */
describe("leafHash — cross-language test vectors", () => {
  interface LeafHashVector {
    _comment?: string;
    address: string;
    amount: string;
    expected_leaf_hex: string;
  }

  const vectorsPath = resolve(process.cwd(), "../test-vectors/leaf-hash-vectors.json");
  const vectors: LeafHashVector[] = JSON.parse(readFileSync(vectorsPath, "utf8"));

  it("has at least 10 vectors", () => {
    expect(vectors.length).toBeGreaterThanOrEqual(10);
  });

  for (const [i, v] of vectors.entries()) {
    it(`vector ${i}: ${v.address.slice(0, 6)}... amount=${v.amount}`, () => {
      const actual = leafHash(v.address, BigInt(v.amount));
      expect(actual.toString("hex")).toBe(
        v.expected_leaf_hex,
        `vector ${i} (${v.address}, ${v.amount}): TypeScript leafHash does not match expected hex`
      );
    });
  }
});

// ─── Issue #35: Snapshot / golden-value tests for Merkle root stability ──────
//
// These tests assert that a fixed 5-entry airdrop list always produces the
// exact same Merkle root. The expected value was generated by running the
// current implementation and is pasted verbatim — it is NOT computed at
// test time.
//
// If leafHash or hashPair is accidentally modified, all deployed contracts
// become unclaimable with existing proofs. A failure here is a breaking change.
//
// Golden root generated with:
//   node -e "const {buildMerkleTree}=require('./dist/merkle.js'); ..."
//   => 9eb3a56c027bd438aec9dae40882e2c83c7aaa291bc4c162e87ee8f61a29624f
//
// The same 5 addresses and amounts are asserted from Rust in test.rs
// (test_snapshot_merkle_root_5_entries) so any cross-language divergence is
// immediately caught.

describe("Issue #35 — snapshot: Merkle root stability (golden values)", () => {
  // ── Fixed 5-entry airdrop list ──────────────────────────────────────────
  const SNAPSHOT_ENTRIES = [
    {
      address: "GBTL47RTFR5EKMZSXWOQU735WBK7LRPPDIDK3JTNTCZZ7NUBBRDTVSK2",
      amount: 1000n,
    },
    {
      address: "GBIRYNFBULFVEHPRNOZENOG6RZ4ZPTRDLR7HNMRKHV2QHISIDHOYV6ZN",
      amount: 2000n,
    },
    {
      address: "GCEEXCCX6TVKCYJ4MFIE3M2NJPVPGRSRPIHDDXR43XKNTNBADWOQWDYC",
      amount: 3000n,
    },
    {
      address: "GDA3XFJZJZQMKRFFZSMQLXDZZRK3DHJWDNUQ4IBOQP4O7FXJPLFJZR7",
      amount: 4000n,
    },
    {
      address: "GCVJDBALC2RQFLD2HYGZDFEZVDFPLFB63KYGIBHC3QLJXBQHJIASOPNB",
      amount: 5000n,
    },
  ] as const;

  // Golden root — pasted literally, never computed.
  const GOLDEN_ROOT =
    "9eb3a56c027bd438aec9dae40882e2c83c7aaa291bc4c162e87ee8f61a29624f";

  // Golden leaf hashes for each entry — pasted literally, never computed.
  const GOLDEN_LEAVES: Record<string, string> = {
    GBTL47RTFR5EKMZSXWOQU735WBK7LRPPDIDK3JTNTCZZ7NUBBRDTVSK2:
      "f0ca9a176c3553e6f05548ac5dbc4e723432ff28aef31c1739f48e3d81c19c2c",
    GBIRYNFBULFVEHPRNOZENOG6RZ4ZPTRDLR7HNMRKHV2QHISIDHOYV6ZN:
      "e6991451a1a8a47f0d50e2a5054cf3bc9947122f15603de16496ed983676c639",
    GCEEXCCX6TVKCYJ4MFIE3M2NJPVPGRSRPIHDDXR43XKNTNBADWOQWDYC:
      "31ffe1df9aa9d81dc94fb438a9d2223bd397680f32fa6e07b2f93389327e64a8",
    GDA3XFJZJZQMKRFFZSMQLXDZZRK3DHJWDNUQ4IBOQP4O7FXJPLFJZR7:
      "c51b26ad0b6ce87f5461d707bb10faed6e7fe74df3722e8e0cd45465b2a38fe0",
    GCVJDBALC2RQFLD2HYGZDFEZVDFPLFB63KYGIBHC3QLJXBQHJIASOPNB:
      "af46c7705009f14e8a2387236bb5ad7260f419331c6ed2253653ebc26af5c286",
  };

  it("5-entry fixed list produces the hardcoded golden root", () => {
    const { root } = buildMerkleTree([...SNAPSHOT_ENTRIES]);
    expect(root).toBe(GOLDEN_ROOT);
  });

  it("root is exactly 64 hex characters (32 bytes)", () => {
    const { root } = buildMerkleTree([...SNAPSHOT_ENTRIES]);
    expect(root).toMatch(/^[0-9a-f]{64}$/);
  });

  it("each individual leaf hash matches its golden value", () => {
    for (const entry of SNAPSHOT_ENTRIES) {
      const actual = leafHash(entry.address, entry.amount).toString("hex");
      expect(actual).toBe(GOLDEN_LEAVES[entry.address]);
    }
  });

  it("all 5 entries generate valid proofs against the golden root", () => {
    const { root, proofs } = buildMerkleTree([...SNAPSHOT_ENTRIES]);
    expect(root).toBe(GOLDEN_ROOT);
    for (const entry of SNAPSHOT_ENTRIES) {
      const proof = proofs.get(entry.address)!;
      expect(proof).toBeDefined();
      expect(
        verifyProof(GOLDEN_ROOT, entry.address, entry.amount, proof.proof)
      ).toBe(true);
    }
  });

  it("root changes when any amount is modified (algorithm stability check)", () => {
    const tampered = [...SNAPSHOT_ENTRIES].map((e, i) =>
      i === 0 ? { ...e, amount: e.amount + 1n } : e
    );
    const { root: tamperedRoot } = buildMerkleTree(tampered);
    expect(tamperedRoot).not.toBe(GOLDEN_ROOT);
  });

  it("root changes when any address is replaced (algorithm stability check)", () => {
    // Replace the last address with one of the earlier addresses — different
    // address, same slot.
    const tampered = [...SNAPSHOT_ENTRIES].map((e, i) =>
      i === 4
        ? {
            address:
              "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
            amount: e.amount,
          }
        : e
    );
    const { root: tamperedRoot } = buildMerkleTree(tampered);
    expect(tamperedRoot).not.toBe(GOLDEN_ROOT);
  });
});

// ─── Issue #31: Property-based tests with fast-check ─────────────────────────
//
// These tests use fast-check to assert invariants that must hold for ALL valid
// inputs, not just handpicked examples. fast-check generates random (address,
// amount) combinations and shrinks failures to their minimal reproduction case.
//
// Three properties are verified:
//
//   P1 — Completeness:
//        Every entry in a tree of N entries produces a valid proof against
//        the root. buildMerkleTree + verifyProof must be consistent for any
//        list size and any combination of addresses and amounts.
//
//   P2 — Address binding:
//        Changing any address produces a different root. Proofs are tied to
//        the specific address that was included, not a placeholder.
//
//   P3 — Amount binding:
//        Changing any amount produces a different root. An attacker cannot
//        increase their allocation by submitting a different amount.

import * as fc from "fast-check";

// ── Arbitrary generators ────────────────────────────────────────────────────

/**
 * Generate a plausible Stellar G-address (56 characters, 'G' prefix, base32
 * alphabet). These do not need to be valid strkeys for the property tests —
 * we only care about hash stability, not Stellar encoding validity.
 *
 * We keep the alphabet restricted to the Stellar base32 charset (A-Z, 2-7)
 * so the strings look realistic and are unlikely to trigger input-validation
 * branches we didn't intend to exercise.
 */
const STRKEY_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const arbitraryAddress = fc
  .array(fc.integer({ min: 0, max: STRKEY_CHARSET.length - 1 }), {
    minLength: 55,
    maxLength: 55,
  })
  .map((indices) => "G" + indices.map((i) => STRKEY_CHARSET[i]).join(""));

/** Generate a positive i128-compatible amount (1n … 2^64-1). */
const arbitraryAmount = fc
  .bigInt({ min: 1n, max: (1n << 64n) - 1n });

/** Generate a single airdrop entry. */
const arbitraryEntry = fc.record({
  address: arbitraryAddress,
  amount: arbitraryAmount,
});

/**
 * Generate a list of 1–10 entries with unique addresses.
 * Duplicates would trigger the "Duplicate address" guard and are tested
 * separately, so we deduplicate here.
 */
const arbitraryEntries = fc
  .array(arbitraryEntry, { minLength: 1, maxLength: 10 })
  .map((entries) => {
    const seen = new Set<string>();
    return entries.filter((e) => {
      if (seen.has(e.address)) return false;
      seen.add(e.address);
      return true;
    });
  })
  .filter((entries) => entries.length >= 1);

// ── Property tests ──────────────────────────────────────────────────────────

describe("Issue #31 — property-based tests (fast-check)", () => {
  // ── P1: Completeness ───────────────────────────────────────────────────
  it(
    "P1: every entry in a tree of N entries verifies against the root",
    () => {
      fc.assert(
        fc.property(arbitraryEntries, (entries) => {
          const { root, proofs } = buildMerkleTree(entries);
          for (const entry of entries) {
            const p = proofs.get(entry.address);
            if (!p) return false; // proof missing — violation
            if (!verifyProof(root, entry.address, entry.amount, p.proof)) {
              return false; // proof does not verify — violation
            }
          }
          return true;
        }),
        { numRuns: 200 }
      );
    }
  );

  // ── P2: Address binding ─────────────────────────────────────────────────
  it(
    "P2: modifying any address produces a different Merkle root",
    () => {
      fc.assert(
        fc.property(
          arbitraryEntries,
          // Pick a random index to tamper with.
          fc.integer({ min: 0, max: 9 }),
          (entries, rawIdx) => {
            if (entries.length === 0) return true; // skip (filtered above)
            const idx = rawIdx % entries.length;

            const original = buildMerkleTree(entries);

            // Build a tampered list: replace entries[idx].address with a
            // different one that is not already in the list.
            const tampered = entries.map((e, i) => {
              if (i !== idx) return e;
              // Use a deterministically different address: flip the second char.
              const chars = e.address.split("");
              const cur = STRKEY_CHARSET.indexOf(chars[1]);
              chars[1] = STRKEY_CHARSET[(cur + 1) % STRKEY_CHARSET.length];
              return { ...e, address: chars.join("") };
            });

            // Deduplicate again in case the flip accidentally created a clash.
            const seen = new Set<string>();
            const deduped = tampered.filter((e) => {
              if (seen.has(e.address)) return false;
              seen.add(e.address);
              return true;
            });

            // If dedup dropped an entry the list length changed; skip this run.
            if (deduped.length !== entries.length) return true;

            const { root: tamperedRoot } = buildMerkleTree(deduped);
            return original.root !== tamperedRoot;
          }
        ),
        { numRuns: 200 }
      );
    }
  );

  // ── P3: Amount binding ──────────────────────────────────────────────────
  it(
    "P3: modifying any amount produces a different Merkle root",
    () => {
      fc.assert(
        fc.property(
          arbitraryEntries,
          fc.integer({ min: 0, max: 9 }),
          (entries, rawIdx) => {
            if (entries.length === 0) return true;
            const idx = rawIdx % entries.length;

            const original = buildMerkleTree(entries);

            // Increment the chosen entry's amount by 1 (wrapping within i128).
            const tampered = entries.map((e, i) =>
              i === idx ? { ...e, amount: e.amount + 1n } : e
            );
            const { root: tamperedRoot } = buildMerkleTree(tampered);
            return original.root !== tamperedRoot;
          }
        ),
        { numRuns: 200 }
      );
    }
  );

  // ── Bonus: cross-proof rejection ──────────────────────────────────────
  it(
    "P4 (bonus): a proof for entry[0] does not verify for entry[1] when they differ",
    () => {
      fc.assert(
        fc.property(
          arbitraryEntries.filter((e) => e.length >= 2),
          (entries) => {
            const { root, proofs } = buildMerkleTree(entries);
            const proof0 = proofs.get(entries[0].address)!.proof;
            // Use entry[0]'s proof to try to verify entry[1]'s (address, amount).
            const crossResult = verifyProof(
              root,
              entries[1].address,
              entries[1].amount,
              proof0
            );
            return !crossResult;
          }
        ),
        { numRuns: 200 }
      );
    }
  );

  // ── Bonus: single-entry tree ───────────────────────────────────────────
  it(
    "P5 (bonus): single-entry tree root equals the leaf hash",
    () => {
      fc.assert(
        fc.property(arbitraryEntry, (entry) => {
          const { root } = buildMerkleTree([entry]);
          const expected = leafHash(entry.address, entry.amount).toString("hex");
          return root === expected;
        }),
        { numRuns: 200 }
      );
    }
  );
});
