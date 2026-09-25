/**
 * Tests for the `merkle-airdrop generate` command.
 *
 * Issues covered:
 *  #70 — Auto-detect and skip CSV header row
 *  #67 — --json output flag for generate command
 *
 * We test the exported helpers (parseAndValidateLine, isHeaderRow) and the
 * generate Command action via the makeGenerateCommand() factory.
 * File I/O is handled by writing real temp files to os.tmpdir() so no
 * fs mocking is needed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { writeFile, unlink } from "fs/promises";

// ─── Mock the SDK ─────────────────────────────────────────────────────────────

vi.mock("@soroban-merkle-airdrop/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@soroban-merkle-airdrop/sdk")>();
  return { ...actual }; // use the real buildMerkleTree — no need to mock it
});

// ─── Mock ora ─────────────────────────────────────────────────────────────────
vi.mock("ora", () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn((msg?: string) => { if (msg) console.log(msg); }),
    fail: vi.fn((msg: string) => console.error(msg)),
    get text() { return ""; },
    set text(_v: string) {},
  })),
}));

import { parseAndValidateLine, isHeaderRow, makeGenerateCommand } from "../commands/generate.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const ADDR_1 = "GBTL47RTFR5EKMZSXWOQU735WBK7LRPPDIDK3JTNTCZZ7NUBBRDTVSK2";
const ADDR_2 = "GBIRYNFBULFVEHPRNOZENOG6RZ4ZPTRDLR7HNMRKHV2QHISIDHOYV6ZN";

// ─── parseAndValidateLine ─────────────────────────────────────────────────────

describe("parseAndValidateLine", () => {
  it("parses a valid line", () => {
    const entry = parseAndValidateLine(`${ADDR_1},1000`, 1);
    expect(entry.address).toBe(ADDR_1);
    expect(entry.amount).toBe(1000n);
  });

  it("throws on empty address", () => {
    expect(() => parseAndValidateLine(",1000", 5)).toThrow("Line 5: address is empty");
  });

  it("throws on invalid Stellar address", () => {
    expect(() => parseAndValidateLine("not-an-address,1000", 3)).toThrow(
      /Line 3: invalid Stellar address/
    );
  });

  it("throws on missing amount", () => {
    expect(() => parseAndValidateLine(`${ADDR_1}`, 2)).toThrow("Line 2: amount is empty");
  });

  it("throws on non-integer amount", () => {
    expect(() => parseAndValidateLine(`${ADDR_1},abc`, 4)).toThrow(
      /Line 4: amount.*not a valid integer/
    );
  });

  it("throws on zero amount", () => {
    expect(() => parseAndValidateLine(`${ADDR_1},0`, 6)).toThrow(
      /Line 6: amount must be greater than zero/
    );
  });
});

// ─── isHeaderRow ──────────────────────────────────────────────────────────────

describe("isHeaderRow — Issue #70", () => {
  it("detects 'address,amount' as a header", () => {
    expect(isHeaderRow("address,amount")).toBe(true);
  });

  it("is case-insensitive: ADDRESS,AMOUNT", () => {
    expect(isHeaderRow("ADDRESS,AMOUNT")).toBe(true);
  });

  it("is case-insensitive: Address,Amount", () => {
    expect(isHeaderRow("Address,Amount")).toBe(true);
  });

  it("ignores leading/trailing whitespace in the first field", () => {
    expect(isHeaderRow("  address  ,amount")).toBe(true);
  });

  it("returns false for a real data row", () => {
    expect(isHeaderRow(`${ADDR_1},1000`)).toBe(false);
  });

  it("returns false when first field is not 'address'", () => {
    expect(isHeaderRow("wallet,tokens")).toBe(false);
  });
});

// ─── generate command action ──────────────────────────────────────────────────

/**
 * Run the generate command action with the given CSV content.
 * Returns captured stdout lines, stderr lines, whether process.exit was
 * called, and the path to the output file.
 */
async function runGenerate(
  csvContent: string,
  extraArgs: string[] = []
): Promise<{
  lines: string[];
  errorLines: string[];
  processExited: boolean;
  outputFile: string;
}> {
  const inputFile = join(tmpdir(), `test-input-${Date.now()}.csv`);
  const outputFile = join(tmpdir(), `test-output-${Date.now()}.json`);

  await writeFile(inputFile, csvContent, "utf-8");

  const lines: string[] = [];
  const errorLines: string[] = [];
  let processExited = false;

  const origLog = console.log;
  const origError = console.error;
  const origExit = process.exit;

  console.log = (...a: unknown[]) => lines.push(a.map(String).join(" "));
  console.error = (...a: unknown[]) => errorLines.push(a.map(String).join(" "));
  (process.exit as unknown as (...args: unknown[]) => void) = () => {
    processExited = true;
    throw new Error("__process_exit__");
  };

  try {
    const cmd = makeGenerateCommand();
    await cmd.parseAsync(
      ["--input", inputFile, "--output", outputFile, ...extraArgs],
      { from: "user" }
    );
  } catch (err) {
    if (!(err instanceof Error && err.message.includes("__process_exit__"))) {
      throw err;
    }
  } finally {
    console.log = origLog;
    console.error = origError;
    process.exit = origExit;
    // Clean up input file
    await unlink(inputFile).catch(() => {});
  }

  return { lines, errorLines, processExited, outputFile };
}

// ─── Issue #70: CSV header row support ───────────────────────────────────────

describe("generate command — Issue #70: CSV header row support", () => {
  let outputFile: string;

  afterEach(async () => {
    if (outputFile) {
      await unlink(outputFile).catch(() => {});
    }
  });

  it("CSV with header row generates the same root as CSV without header row", async () => {
    const csvWithoutHeader = `${ADDR_1},1000\n${ADDR_2},500\n`;
    const csvWithHeader = `address,amount\n${ADDR_1},1000\n${ADDR_2},500\n`;

    const { outputFile: f1 } = await runGenerate(csvWithoutHeader);
    const { outputFile: f2 } = await runGenerate(csvWithHeader);

    const { readFile } = await import("fs/promises");
    const tree1 = JSON.parse(await readFile(f1, "utf-8"));
    const tree2 = JSON.parse(await readFile(f2, "utf-8"));

    expect(tree1.root).toBe(tree2.root);
    expect(tree1.totalEntries).toBe(tree2.totalEntries);

    await unlink(f1).catch(() => {});
    await unlink(f2).catch(() => {});
  });

  it("skips header when first field is 'address' (case-insensitive)", async () => {
    const csv = `Address,Amount\n${ADDR_1},1000\n`;
    const result = await runGenerate(csv);
    outputFile = result.outputFile;

    expect(result.processExited).toBe(false);
    const { readFile } = await import("fs/promises");
    const tree = JSON.parse(await readFile(outputFile, "utf-8"));
    expect(tree.totalEntries).toBe(1);
  });

  it("--has-header forces header skipping even when auto-detect would not trigger", async () => {
    // First line is 'wallet,tokens' — not auto-detected but we force-skip it
    const csv = `wallet,tokens\n${ADDR_1},1000\n`;
    const result = await runGenerate(csv, ["--has-header"]);
    outputFile = result.outputFile;

    expect(result.processExited).toBe(false);
    const { readFile } = await import("fs/promises");
    const tree = JSON.parse(await readFile(outputFile, "utf-8"));
    expect(tree.totalEntries).toBe(1);
  });

  it("does not skip a valid data row when there is no header", async () => {
    const csv = `${ADDR_1},1000\n${ADDR_2},500\n`;
    const result = await runGenerate(csv);
    outputFile = result.outputFile;

    const { readFile } = await import("fs/promises");
    const tree = JSON.parse(await readFile(outputFile, "utf-8"));
    expect(tree.totalEntries).toBe(2);
  });

  it("emits a validation error if a line that would be treated as data has an invalid address", async () => {
    // No header, the 'address,amount' line would be treated as data if
    // auto-detect were off, but auto-detect skips it here
    const csv = `${ADDR_1},1000\nnot-a-valid-address,500\n`;
    const result = await runGenerate(csv);

    // Should fail due to invalid address on line 2
    expect(result.processExited).toBe(true);
    expect(result.errorLines.join("\n")).toMatch(/invalid Stellar address/i);
  });
});

// ─── Issue #67: --json flag ───────────────────────────────────────────────────

describe("generate command — Issue #67: --json flag", () => {
  it("prints tree JSON to stdout when --json is passed", async () => {
    const csv = `${ADDR_1},1000\n${ADDR_2},500\n`;
    const { lines } = await runGenerate(csv, ["--json"]);

    // Should have printed JSON to stdout
    const jsonLine = lines.find((l) => {
      try { JSON.parse(l); return true; } catch { return false; }
    });
    expect(jsonLine).toBeDefined();
  });

  it("JSON output is parseable and contains required fields", async () => {
    const csv = `${ADDR_1},1000\n${ADDR_2},500\n`;
    const { lines } = await runGenerate(csv, ["--json"]);

    // Collect all lines and try to parse a valid JSON object
    const combined = lines.join("\n");
    let parsed: Record<string, unknown> | undefined;
    // The output might be multi-line JSON (with indentation)
    try {
      parsed = JSON.parse(combined);
    } catch {
      // Try finding a single-line JSON
      for (const line of lines) {
        try { parsed = JSON.parse(line); break; } catch { /* continue */ }
      }
    }

    expect(parsed).toBeDefined();
    expect(parsed).toHaveProperty("root");
    expect(parsed).toHaveProperty("totalEntries", 2);
    expect(parsed).toHaveProperty("proofs");
    expect(parsed).toHaveProperty("totalAmount");
    expect(parsed).toHaveProperty("generatedAt");
  });

  it("--json with header row still skips the header and outputs correct entry count", async () => {
    const csv = `address,amount\n${ADDR_1},1000\n${ADDR_2},500\n`;
    const { lines } = await runGenerate(csv, ["--json"]);

    const combined = lines.join("\n");
    let parsed: Record<string, unknown> | undefined;
    try {
      parsed = JSON.parse(combined);
    } catch {
      for (const line of lines) {
        try { parsed = JSON.parse(line); break; } catch { /* continue */ }
      }
    }

    expect(parsed).toBeDefined();
    expect(parsed!["totalEntries"]).toBe(2);
  });
});
