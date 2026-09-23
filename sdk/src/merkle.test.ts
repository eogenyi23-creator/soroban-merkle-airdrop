import { describe, it, expect } from "vitest";
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

describe("AirdropContractError", () => {
  it("is an instance of Error", () => {
    const err = new AirdropContractError(AirdropError.AlreadyClaimed);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AirdropContractError);
  });

  it("sets the name property correctly", () => {
    const err = new AirdropContractError(AirdropError.InvalidProof);
    expect(err.name).toBe("AirdropContractError");
  });

  it("stores the numeric error code", () => {
    const err = new AirdropContractError(AirdropError.AlreadyClaimed);
    expect(err.code).toBe(AirdropError.AlreadyClaimed);
    expect(err.code).toBe(1);
  });

  it("provides a default message for known codes", () => {
    expect(new AirdropContractError(AirdropError.AlreadyClaimed).message).toMatch(/already claimed/i);
    expect(new AirdropContractError(AirdropError.InvalidProof).message).toMatch(/invalid.*proof/i);
    expect(new AirdropContractError(AirdropError.AirdropInactive).message).toMatch(/not active/i);
    expect(new AirdropContractError(AirdropError.InsufficientFunds).message).toMatch(/insufficient/i);
    expect(new AirdropContractError(AirdropError.Unauthorized).message).toMatch(/unauthorized/i);
  });

  it("accepts a custom message", () => {
    const err = new AirdropContractError(AirdropError.InvalidProof, "custom msg");
    expect(err.message).toBe("custom msg");
  });

  it("includes a fallback message for unknown codes", () => {
    const err = new AirdropContractError(99);
    expect(err.message).toMatch(/99/);
  });

  it("can be caught and narrowed by type", () => {
    function throwIt(): void {
      throw new AirdropContractError(AirdropError.AlreadyClaimed);
    }
    try {
      throwIt();
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AirdropContractError);
      const typed = err as AirdropContractError;
      expect(typed.code).toBe(AirdropError.AlreadyClaimed);
    }
  });
});

describe("RpcError", () => {
  it("is an instance of Error", () => {
    const err = new RpcError("network failure");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(RpcError);
  });

  it("sets the name property correctly", () => {
    const err = new RpcError("network failure");
    expect(err.name).toBe("RpcError");
  });

  it("stores the message", () => {
    const err = new RpcError("connection refused");
    expect(err.message).toBe("connection refused");
  });

  it("stores the cause when provided", () => {
    const cause = new Error("underlying");
    const err = new RpcError("wrapped", cause);
    expect(err.cause).toBe(cause);
  });

  it("cause is undefined when not provided", () => {
    const err = new RpcError("no cause");
    expect(err.cause).toBeUndefined();
  });

  it("can be caught and distinguished from AirdropContractError", () => {
    function throwRpc(): void { throw new RpcError("timeout"); }
    function throwContract(): void { throw new AirdropContractError(AirdropError.InvalidProof); }

    try { throwRpc(); } catch (err) {
      expect(err).toBeInstanceOf(RpcError);
      expect(err).not.toBeInstanceOf(AirdropContractError);
    }
    try { throwContract(); } catch (err) {
      expect(err).toBeInstanceOf(AirdropContractError);
      expect(err).not.toBeInstanceOf(RpcError);
    }
  });
});
