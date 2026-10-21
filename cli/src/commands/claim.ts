/**
 * `merkle-airdrop claim`
 *
 * Submit a claim transaction for a given address using the Merkle proof
 * from the generated tree JSON.
 *
 * With --verify-only the proof is verified locally and against the on-chain
 * root without submitting any transaction. No secret key is required.
 */

import { Command } from "commander";
import { readFile } from "fs/promises";
import { resolve } from "path";
import chalk from "chalk";
import ora from "ora";
import {
  createAirdropClient,
  verifyProof,
  NETWORKS,
  validateMerkleTreeFile,
} from "@soroban-merkle-airdrop/sdk";
import { translateContractError } from "../errors.js";

export const claimCommand = new Command("claim")
  .description("Claim tokens from the airdrop")
  .requiredOption("-t, --tree <file>", "Merkle tree JSON (output of generate)")
  .requiredOption("-a, --address <address>", "Address to claim for")
  .option("-k, --secret-key <key>", "Stellar secret key (or set STELLAR_SECRET_KEY)")
  .option("--verify-only", "Verify proof locally and on-chain without submitting a transaction")
  .action(async (opts, cmd) => {
    const globalOpts = cmd.parent?.opts() ?? {};
    const network = globalOpts.network ?? "testnet";
    const contractId = globalOpts.contractId ?? process.env.AIRDROP_CONTRACT_ID;

    // Warn if the secret key was supplied as a CLI argument — it will be
    // visible in shell history and process listings (e.g. `ps aux`).
    if (opts.secretKey) {
      console.warn(
        chalk.yellow(
          "Warning: passing secret keys as command-line arguments is insecure. " +
          "Use STELLAR_SECRET_KEY env var instead."
        )
      );
    }

    const secretKey = opts.secretKey ?? process.env.STELLAR_SECRET_KEY;
    const verifyOnly: boolean = opts.verifyOnly ?? false;

    if (!contractId) {
      console.error(chalk.red("Error: --contract-id or AIRDROP_CONTRACT_ID required"));
      process.exit(1);
    }

    if (!verifyOnly && !secretKey) {
      console.error(chalk.red("Error: --secret-key or STELLAR_SECRET_KEY required (omit with --verify-only)"));
      process.exit(1);
    }

    const spinner = ora("Loading Merkle tree...").start();
    try {
      // Parse and validate the tree file schema.
      let raw: unknown;
      try {
        raw = JSON.parse(await readFile(resolve(opts.tree), "utf-8"));
      } catch (parseErr) {
        spinner.fail(chalk.red(`Could not read/parse tree file: ${(parseErr as Error).message}`));
        process.exit(1);
      }

      const tree = validateMerkleTreeFile(raw);

      const entry = tree.proofs[opts.address];
      if (!entry) {
        spinner.fail(chalk.red(`Address ${opts.address} not found in airdrop list`));
        process.exit(1);
      }

      const proof = { ...entry, amount: BigInt(entry.amount) };

      // ── Local proof verification ───────────────────────────────────────────
      spinner.text = "Verifying proof locally...";
      const valid = verifyProof(raw.root, contractId, proof.address, proof.amount, proof.proof);
      if (!valid) {
        spinner.fail(chalk.red("Proof verification failed — tree may be corrupted"));
        process.exit(1);
      }

      const preset = NETWORKS[network];
      const client = createAirdropClient({
        ...preset,
        // Override rpcUrl if --rpc-url was provided on the global options.
        ...(globalOpts.rpcUrl ? { rpcUrl: globalOpts.rpcUrl } : {}),
        contractId,
      });

      // ── Already claimed check ──────────────────────────────────────────────
      spinner.text = "Checking claim status...";
      const alreadyClaimed = await client.isClaimed(opts.address);

      if (verifyOnly) {
        spinner.stop();

        // Proof validity
        if (locallyValid && rootMatches) {
          console.log(chalk.green(`✔  Proof is valid`) + chalk.gray(` (matches on-chain root: ${tree.root})`));
        } else if (locallyValid && !rootMatches) {
          console.log(
            chalk.yellow(`⚠  Proof is locally valid but the on-chain root differs.`) +
            `\n   File root:     ${chalk.cyan(tree.root)}` +
            `\n   On-chain root: ${chalk.cyan(onChainRoot ?? "(none)")}`
          );
        } else {
          console.log(chalk.red(`✖  Proof is INVALID`));
        }

        // Claimed status
        if (alreadyClaimed) {
          console.log(chalk.yellow(`ℹ  ${opts.address} has already claimed.`));
        } else {
          console.log(chalk.green(`ℹ  ${opts.address} has NOT yet claimed.`));
        }

        process.exit(locallyValid && rootMatches ? 0 : 1);
      }

      // ── Full claim flow ────────────────────────────────────────────────────
      if (!locallyValid) {
        spinner.fail(chalk.red("Proof verification failed — tree may be corrupted"));
        process.exit(1);
      }

      if (alreadyClaimed) {
        spinner.warn(chalk.yellow(`${opts.address} has already claimed.`));
        process.exit(0);
      }

      // ── Dry-run mode: simulate and print fee estimate, then exit ──────────
      if (isDryRun) {
        spinner.text = "Simulating claim transaction (dry run)...";

        // simulateClaim takes the public key, not the secret key
        const { Keypair } = await import("@stellar/stellar-sdk");
        const publicKey = Keypair.fromSecret(secretKey).publicKey();

        const sim = await client.simulateClaim(proof, publicKey);

        spinner.succeed(chalk.cyan("Dry-run simulation complete (no transaction submitted)"));
        console.log(`\n  ${chalk.bold("Estimated fee:")} ${chalk.yellow(sim.fee)} stroops`);

        if (sim.resources && Object.keys(sim.resources).length > 0) {
          console.log(`\n  ${chalk.bold("Resource usage:")}`);
          const r = sim.resources;
          if (r.instructions !== undefined)
            console.log(`    Instructions: ${chalk.dim(r.instructions.toLocaleString())}`);
          if (r.readBytes !== undefined)
            console.log(`    Read bytes:   ${chalk.dim(r.readBytes.toLocaleString())}`);
          if (r.writeBytes !== undefined)
            console.log(`    Write bytes:  ${chalk.dim(r.writeBytes.toLocaleString())}`);
          if (r.readEntries !== undefined)
            console.log(`    Read entries: ${chalk.dim(r.readEntries)}`);
          if (r.writeEntries !== undefined)
            console.log(`    Write entries:${chalk.dim(r.writeEntries)}`);
        }
        console.log(
          `\n  ${chalk.dim("Tip: remove --dry-run to submit the transaction for real.")}\n`
        );
        process.exit(0);
      }

      // ── Live mode: submit the transaction ─────────────────────────────────
      spinner.text = "Submitting claim transaction...";
      const result = await client.claim(proof, secretKey);

      spinner.succeed(chalk.green("Claim submitted!"));
      console.log(`\n  ${chalk.bold("Tx hash:")} ${chalk.cyan(result.txHash)}`);
      console.log(`  ${chalk.bold("Address:")} ${result.address}`);
      console.log(`  ${chalk.bold("Amount:")}  ${result.amount.toString()}\n`);
    } catch (err) {
      const message = translateContractError((err as Error).message);
      spinner.fail(`Error: ${message}`);
      process.exit(1);
    }
  });
