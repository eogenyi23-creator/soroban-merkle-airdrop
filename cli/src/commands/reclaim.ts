/**
 * `merkle-airdrop reclaim`
 *
 * Reclaim unclaimed tokens from an expired airdrop contract.
 * Only the contract admin can call this command.
 */

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { createAirdropClient, NETWORKS } from "@soroban-merkle-airdrop/sdk";
import { translateContractError } from "../errors.js";

export const reclaimCommand = new Command("reclaim")
  .description("Reclaim unclaimed tokens from an expired airdrop (admin only)")
  .option("-k, --secret-key <key>", "Admin Stellar secret key (or set STELLAR_SECRET_KEY)")
  .action(async (opts, cmd) => {
    const globalOpts = cmd.parent?.opts() ?? {};
    const network = globalOpts.network ?? "testnet";
    const contractId = globalOpts.contractId ?? process.env.AIRDROP_CONTRACT_ID;
    const secretKey = opts.secretKey ?? process.env.STELLAR_SECRET_KEY;

    if (!contractId) {
      console.error(chalk.red("Error: --contract-id or AIRDROP_CONTRACT_ID required"));
      process.exit(1);
    }
    if (!secretKey) {
      console.error(chalk.red("Error: --secret-key or STELLAR_SECRET_KEY required"));
      process.exit(1);
    }

    const spinner = ora("Connecting to contract...").start();
    try {
      const preset = NETWORKS[network];
      const client = createAirdropClient({ ...preset, contractId });

      spinner.text = "Submitting reclaim transaction...";
      const { txHash, amount } = await client.reclaim(secretKey);

      spinner.succeed(chalk.green("Reclaim submitted!"));
      console.log(`\n  ${chalk.bold("Tx hash:")}         ${chalk.cyan(txHash)}`);
      console.log(`  ${chalk.bold("Amount reclaimed:")} ${amount.toString()}\n`);
    } catch (err) {
      const message = translateContractError((err as Error).message);
      spinner.fail(`Error: ${message}`);
      process.exit(1);
    }
  });
