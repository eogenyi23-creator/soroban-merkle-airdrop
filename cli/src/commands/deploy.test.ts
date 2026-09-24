/**
 * Unit tests for the programmatic deploy command (Issue #69).
 *
 * All Stellar RPC calls are mocked — no real network access occurs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { programmaticDeploy, type DeployOptions } from "./deploy.js";

// ─── Mock @stellar/stellar-sdk ──────────────────────────────────────────────

// We capture the mock server so individual tests can configure return values.
let mockServer: {
  getAccount: ReturnType<typeof vi.fn>;
  simulateTransaction: ReturnType<typeof vi.fn>;
  sendTransaction: ReturnType<typeof vi.fn>;
  getTransaction: ReturnType<typeof vi.fn>;
};

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();

  mockServer = {
    getAccount: vi.fn(),
    simulateTransaction: vi.fn(),
    sendTransaction: vi.fn(),
    getTransaction: vi.fn(),
  };

  const MockServer = vi.fn(() => mockServer);

  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: MockServer,
      assembleTransaction: vi.fn().mockReturnValue({
        build: vi.fn().mockReturnValue({ sign: vi.fn(), toXDR: vi.fn() }),
      }),
      Api: {
        ...(actual.rpc?.Api ?? {}),
        isSimulationError: (r: unknown) =>
          typeof r === "object" && r !== null && "error" in r,
      },
    },
    Keypair: {
      ...actual.Keypair,
      fromSecret: vi.fn().mockReturnValue({
        publicKey: vi.fn().mockReturnValue("GADMIN123PUBLICKEY"),
        sign: vi.fn(),
      }),
      random: vi.fn().mockReturnValue({ publicKey: vi.fn().mockReturnValue("GRND") }),
    },
    TransactionBuilder: vi.fn().mockImplementation(() => ({
      addOperation: vi.fn().mockReturnThis(),
      setTimeout: vi.fn().mockReturnThis(),
      build: vi.fn().mockReturnValue({ sign: vi.fn(), toXDR: vi.fn() }),
    })),
    Operation: {
      ...actual.Operation,
      uploadContractWasm: vi.fn().mockReturnValue({}),
      createCustomContract: vi.fn().mockReturnValue({}),
    },
    Contract: vi.fn().mockImplementation(() => ({
      call: vi.fn().mockReturnValue({}),
    })),
    Address: vi.fn().mockImplementation((addr: string) => ({
      toScVal: vi.fn().mockReturnValue({}),
      toString: () => addr,
    })),
    xdr: {
      ...actual.xdr,
      ScVal: {
        scvBytes: vi.fn().mockReturnValue({}),
      },
      TransactionMeta: {
        fromXDR: vi.fn().mockReturnValue({
          v3: vi.fn().mockReturnValue({
            sorobanMeta: vi.fn().mockReturnValue({
              returnValue: vi.fn().mockReturnValue({
                switch: vi.fn().mockReturnValue({ name: "scvBytes" }),
                bytes: vi.fn().mockReturnValue(Buffer.alloc(32, 0xab)),
              }),
            }),
          }),
        }),
      },
      ScValType: actual.xdr?.ScValType ?? {},
    },
    nativeToScVal: vi.fn().mockReturnValue({}),
    Networks: actual.Networks,
  };
});

// ─── Mock fs/promises ────────────────────────────────────────────────────────

vi.mock("fs/promises", () => ({
  readFile: vi.fn().mockImplementation((path: string) => {
    // Return fake WASM bytes for .wasm files
    if (String(path).endsWith(".wasm")) {
      return Promise.resolve(Buffer.from([0x00, 0x61, 0x73, 0x6d])); // WASM magic bytes
    }
    // Return a mock Merkle tree JSON for .json files
    return Promise.resolve(
      JSON.stringify({
        root: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
        totalAmount: "150000",
        proofs: {},
      })
    );
  }),
}));

// ─── Test helpers ────────────────────────────────────────────────────────────

const BASE_OPTS: DeployOptions = {
  wasm: "contract.wasm",
  token: "CTOKEN123",
  tree: "merkle-tree.json",
  expiration: "9999999999",
  secretKey: "STEST123SECRETKEY",
  network: "testnet",
};

/** Build a successful simResult (no 'error' key). */
function simSuccess() {
  return {
    result: { retval: {} },
    transactionData: {},
    minResourceFee: "100",
  };
}

/** Build a fake successful GetTransaction response. */
function txSuccess(returnValueOverride?: object) {
  return {
    status: "SUCCESS" as const,
    resultMetaXdr: {
      toXDR: () => Buffer.alloc(0),
    },
    // Store override so we can use it in extractReturnValue
    _returnValue: returnValueOverride,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("programmaticDeploy (Issue #69)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default happy-path responses
    mockServer.getAccount.mockResolvedValue({
      id: "GADMIN123PUBLICKEY",
      sequenceNumber: () => "100",
      incrementSequenceNumber: vi.fn(),
    });
    mockServer.simulateTransaction.mockResolvedValue(simSuccess());
    mockServer.sendTransaction.mockResolvedValue({ status: "PENDING", hash: "txhash123" });
    mockServer.getTransaction.mockResolvedValue(txSuccess());
  });

  it("calls getAccount, simulateTransaction, and sendTransaction for each of the 3 steps", async () => {
    // Each step (upload, deploy, init) calls: getAccount(×2 refreshes), simulateTransaction, sendTransaction.
    // getTransaction is called once per step after sendTransaction.
    mockServer.sendTransaction
      .mockResolvedValueOnce({ status: "PENDING", hash: "upload-hash" })
      .mockResolvedValueOnce({ status: "PENDING", hash: "deploy-hash" })
      .mockResolvedValueOnce({ status: "PENDING", hash: "init-hash" });

    // getTransaction resolves SUCCESS for each hash
    mockServer.getTransaction.mockResolvedValue(txSuccess());

    await programmaticDeploy(BASE_OPTS);

    // simulateTransaction called 3 times (upload + deploy + init)
    expect(mockServer.simulateTransaction).toHaveBeenCalledTimes(3);
    // sendTransaction called 3 times
    expect(mockServer.sendTransaction).toHaveBeenCalledTimes(3);
  });

  it("throws if WASM upload simulation returns an error", async () => {
    mockServer.simulateTransaction.mockResolvedValueOnce({
      error: "Simulation error: out of budget",
    });

    await expect(programmaticDeploy(BASE_OPTS)).rejects.toThrow(
      /WASM upload simulation failed/
    );
  });

  it("throws if contract deploy simulation returns an error", async () => {
    // First simulation (upload) succeeds, second (deploy) fails
    mockServer.simulateTransaction
      .mockResolvedValueOnce(simSuccess())
      .mockResolvedValueOnce({ error: "Deploy simulation error" });

    await expect(programmaticDeploy(BASE_OPTS)).rejects.toThrow(
      /Contract deploy simulation failed/
    );
  });

  it("throws if initialize simulation returns an error", async () => {
    mockServer.simulateTransaction
      .mockResolvedValueOnce(simSuccess())   // upload
      .mockResolvedValueOnce(simSuccess())   // deploy
      .mockResolvedValueOnce({ error: "Init simulation error" }); // init

    await expect(programmaticDeploy(BASE_OPTS)).rejects.toThrow(
      /Initialize simulation failed/
    );
  });

  it("throws if upload sendTransaction returns ERROR status", async () => {
    mockServer.sendTransaction.mockResolvedValueOnce({
      status: "ERROR",
      errorResult: { toXDR: () => "errorXDR" },
    });

    await expect(programmaticDeploy(BASE_OPTS)).rejects.toThrow(
      /WASM upload transaction failed/
    );
  });

  it("throws if deploy sendTransaction returns ERROR status", async () => {
    mockServer.sendTransaction
      .mockResolvedValueOnce({ status: "PENDING", hash: "upload-hash" }) // upload ok
      .mockResolvedValueOnce({ status: "ERROR", errorResult: { toXDR: () => "err" } }); // deploy fails

    await expect(programmaticDeploy(BASE_OPTS)).rejects.toThrow(
      /Contract deploy transaction failed/
    );
  });

  it("throws a timeout error if getTransaction never returns SUCCESS", async () => {
    // Override the polling timeout via a short value — we'll test the flow
    // by making getTransaction always return NOT_FOUND.
    mockServer.getTransaction.mockResolvedValue({ status: "NOT_FOUND" });

    // The actual timeout is 90s which is too long for a unit test,
    // so we mock Date.now to advance time artificially.
    const realDateNow = Date.now;
    let callCount = 0;
    vi.spyOn(Date, "now").mockImplementation(() => {
      // After 5 calls, jump past the 90s timeout
      callCount++;
      return callCount > 5 ? realDateNow() + 100_000 : realDateNow();
    });

    try {
      await expect(programmaticDeploy(BASE_OPTS)).rejects.toThrow(
        /Transaction confirmation timeout/
      );
    } finally {
      vi.restoreAllMocks();
    }
  }, 30_000);

  it("rejects if Merkle tree JSON has no root field", async () => {
    const { readFile } = await import("fs/promises");
    vi.mocked(readFile).mockImplementationOnce((path) => {
      if (String(path).endsWith(".wasm")) return Promise.resolve(Buffer.from([0x00]));
      return Promise.resolve(JSON.stringify({ totalAmount: "1000" })); // missing root
    });

    await expect(programmaticDeploy(BASE_OPTS)).rejects.toThrow(
      /missing a 'root' field/
    );
  });

  it("rejects if Merkle tree JSON has no totalAmount field", async () => {
    const { readFile } = await import("fs/promises");
    vi.mocked(readFile).mockImplementationOnce((path) => {
      if (String(path).endsWith(".wasm")) return Promise.resolve(Buffer.from([0x00]));
      return Promise.resolve(
        JSON.stringify({ root: "abc123".repeat(10).slice(0, 64) })
      ); // missing totalAmount
    });

    await expect(programmaticDeploy(BASE_OPTS)).rejects.toThrow(
      /missing 'totalAmount'/
    );
  });
});
