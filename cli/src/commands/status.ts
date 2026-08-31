/**
 * `merkle-airdrop status`
 *
 * Query the on-chain airdrop contract status and optionally check
 * whether specific addresses have claimed.
 */

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { createAirdropClient, NETWORKS } from "@soroban-merkle-airdrop/sdk";

export const statusCommand = new Command("status")
  .description("Query on-chain airdrop contract status")
  .option("-a, --address <address>", "Check if a specific address has claimed")
  .action(async (opts, cmd) => {
    const globalOpts = cmd.parent?.opts() ?? {};
    const network = globalOpts.network ?? "testnet";
    const contractId = globalOpts.contractId ?? process.env.AIRDROP_CONTRACT_ID;

    if (!contractId) {
      console.error(chalk.red("Error: --contract-id or AIRDROP_CONTRACT_ID required"));
      process.exit(1);
    }

    const spinner = ora(`Querying contract on ${chalk.cyan(network)}...`).start();
    try {
      const preset = NETWORKS[network];
      const client = createAirdropClient({ ...preset, contractId });

      const [active, root, total] = await Promise.all([
        client.isActive(),
        client.merkleRoot(),
        client.totalDeposited(),
      ]);

      spinner.succeed("Contract status:");
      console.log(`\n  ${chalk.bold("Contract:")}  ${chalk.cyan(contractId)}`);
      console.log(`  ${chalk.bold("Network:")}   ${network}`);
      console.log(`  ${chalk.bold("Active:")}    ${active ? chalk.green("yes") : chalk.red("no")}`);
      console.log(`  ${chalk.bold("Root:")}      ${chalk.cyan(root ?? "not initialized")}`);
      console.log(`  ${chalk.bold("Deposited:")} ${total.toString()}`);

      if (opts.address) {
        const claimed = await client.isClaimed(opts.address);
        console.log(
          `\n  ${chalk.bold(opts.address)}: ${
            claimed ? chalk.yellow("already claimed") : chalk.green("not yet claimed")
          }`
        );
      }
      console.log();
    } catch (err) {
      spinner.fail(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  });
