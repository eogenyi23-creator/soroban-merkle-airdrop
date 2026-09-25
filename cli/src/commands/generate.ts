/**
 * `merkle-airdrop generate`
 *
 * Read a CSV of (address, amount) pairs and produce a Merkle tree JSON
 * containing the root and all per-address proofs.
 *
 * Validation (Issue #25):
 *   - Each address must be a valid G... (Ed25519 public key) or C... (contract)
 *     Stellar strkey, checked via StrKey from @stellar/stellar-sdk.
 *   - Amount must be a non-empty, non-whitespace string that parses as a
 *     positive integer (BigInt > 0).
 *   - Clear, line-numbered error messages are emitted for any invalid row.
 */

import { Command } from "commander";
import { readFile, writeFile } from "fs/promises";
import { resolve } from "path";
import chalk from "chalk";
import ora from "ora";
import { StrKey } from "@stellar/stellar-sdk";
import { buildMerkleTree } from "@soroban-merkle-airdrop/sdk";
import type { AirdropEntry } from "@soroban-merkle-airdrop/sdk";

/**
 * Return true if `addr` is a valid Stellar G... account key or C... contract address.
 */
function isValidStellarAddress(addr: string): boolean {
  return StrKey.isValidEd25519PublicKey(addr) || StrKey.isValidContract(addr);
}

/**
 * Parse and validate a single CSV data line.
 * Returns an `AirdropEntry` on success, or throws an Error with a human-readable
 * message that includes the 1-based line number within the original file.
 *
 * @param rawLine  - The original untrimmed CSV line (for error context).
 * @param lineNum  - 1-based line number in the source file (used in error messages).
 */
export function parseAndValidateLine(rawLine: string, lineNum: number): AirdropEntry {
  const trimmed = rawLine.trim();

  const parts = trimmed.split(",");
  const address = parts[0]?.trim() ?? "";
  const amountRaw = parts[1]?.trim() ?? "";

  // Validate address
  if (!address) {
    throw new Error(`Line ${lineNum}: address is empty`);
  }
  if (!isValidStellarAddress(address)) {
    throw new Error(`Line ${lineNum}: invalid Stellar address "${address}"`);
  }

  // Validate amount — must be present and non-whitespace
  if (!amountRaw) {
    throw new Error(`Line ${lineNum}: amount is empty or whitespace-only`);
  }

  let amount: bigint;
  try {
    amount = BigInt(amountRaw);
  } catch {
    throw new Error(`Line ${lineNum}: amount "${amountRaw}" is not a valid integer`);
  }

  if (amount <= 0n) {
    throw new Error(`Line ${lineNum}: amount must be greater than zero, got "${amountRaw}"`);
  }

  return { address, amount };
}

/**
 * Factory that creates a fresh `generate` Command instance.
 * Exporting a factory rather than a singleton means tests can call
 * `makeGenerateCommand()` to get a clean instance with no cached option
 * values from a previous parse.
 */
export function makeGenerateCommand(): Command {
  return new Command("generate")
    .description("Build a Merkle tree from a CSV airdrop list")
    .requiredOption("-i, --input <file>", "CSV file: address,amount (one per line)")
    .requiredOption("-o, --output <file>", "Output JSON file for Merkle tree + proofs")
    .action(async (opts) => {
      const spinner = ora("Reading airdrop list...").start();

      try {
        const csv = await readFile(resolve(opts.input), "utf-8");
        const entries: AirdropEntry[] = [];
        const errors: string[] = [];

        const lines = csv.split("\n");
        let lineNum = 0;

        for (const line of lines) {
          lineNum++;
          const trimmed = line.trim();

          // Skip blank lines and comments
          if (!trimmed || trimmed.startsWith("#")) continue;

          try {
            entries.push(parseAndValidateLine(line, lineNum));
          } catch (err) {
            errors.push((err as Error).message);
          }
        }

        // Report all validation errors at once before aborting
        if (errors.length > 0) {
          spinner.fail(chalk.red(`Found ${errors.length} validation error(s) in ${opts.input}:`));
          for (const e of errors) {
            console.error(`  ${chalk.red("✖")} ${e}`);
          }
          process.exit(1);
        }

        if (entries.length === 0) {
          spinner.fail(chalk.red("CSV contains no valid entries"));
          process.exit(1);
        }

        spinner.text = `Building Merkle tree for ${entries.length} entries...`;
        const { root, proofs } = buildMerkleTree(entries);

        const output = {
          root,
          totalEntries: entries.length,
          totalAmount: entries.reduce((s, e) => s + e.amount, 0n).toString(),
          generatedAt: new Date().toISOString(),
          proofs: Object.fromEntries(
            [...proofs.entries()].map(([addr, p]) => [
              addr,
              { ...p, amount: p.amount.toString() },
            ])
          ),
        };

        await writeFile(resolve(opts.output), JSON.stringify(output, null, 2));
        spinner.succeed(chalk.green(`Merkle tree generated!`));
        console.log(`\n  ${chalk.bold("Root:")}    ${chalk.cyan(root)}`);
        console.log(`  ${chalk.bold("Entries:")} ${entries.length}`);
        console.log(`  ${chalk.bold("Output:")}  ${opts.output}\n`);
      } catch (err) {
        spinner.fail(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}

/** Singleton instance used by the CLI entry point. */
export const generateCommand = makeGenerateCommand();
