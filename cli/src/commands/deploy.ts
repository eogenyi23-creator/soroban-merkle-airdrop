/**
 * `merkle-airdrop deploy`
 *
 * Deploy the airdrop contract and initialise it from a generated Merkle tree.
 */

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";

export const deployCommand = new Command("deploy")
  .description("Deploy and initialise the airdrop contract (requires stellar CLI)")
  .requiredOption("-t, --tree <file>", "Merkle tree JSON (output of generate)")
  .requiredOption("--token <address>", "SEP-41 token contract address to distribute")
  .option("-k, --secret-key <key>", "Deployer secret key (or set STELLAR_SECRET_KEY)")
  .action(async (opts, cmd) => {
    const globalOpts = cmd.parent?.opts() ?? {};
    const network = globalOpts.network ?? "testnet";

    console.log(chalk.bold("\n🚀 Deployment via stellar CLI\n"));
    console.log(chalk.gray("This command guides you through deploying with the Stellar CLI."));
    console.log(chalk.gray("Ensure stellar CLI is installed: https://developers.stellar.org/docs/tools/cli\n"));

    console.log(`${chalk.bold("1.")} Build the WASM:`);
    console.log(chalk.cyan("   cargo build --manifest-path contracts/airdrop/Cargo.toml --target wasm32v1-none --release\n"));

    console.log(`${chalk.bold("2.")} Upload WASM:`);
    console.log(chalk.cyan(`   stellar contract upload --network ${network} --source deployer \\\n       --wasm target/wasm32v1-none/release/soroban_merkle_airdrop.wasm\n`));

    console.log(`${chalk.bold("3.")} Deploy contract:`);
    console.log(chalk.cyan(`   stellar contract deploy --network ${network} --source deployer --wasm-hash <WASM_HASH>\n`));

    const tree = JSON.parse(
      await import("fs").then((fs) =>
        fs.readFileSync(opts.tree, "utf-8")
      )
    );

    console.log(`${chalk.bold("4.")} Initialise with your Merkle root:`);
    console.log(chalk.cyan(
      `   stellar contract invoke --network ${network} --source deployer \\\n` +
      `       --id <CONTRACT_ID> -- initialize \\\n` +
      `       --admin $(stellar keys address deployer) \\\n` +
      `       --token ${opts.token} \\\n` +
      `       --merkle_root ${tree.root} \\\n` +
      `       --total_amount ${tree.totalAmount}\n`
    ));

    console.log(chalk.green("See docs/deploying.md for full instructions.\n"));
  });
