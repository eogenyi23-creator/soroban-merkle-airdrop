/**
 * examples/event-stream.ts
 *
 * Streams and decodes Soroban contract events emitted by a deployed
 * soroban-merkle-airdrop contract, then prints each event with a timestamp,
 * the relevant address, and the token amount.
 *
 * Supported events:
 *   init       — contract was initialized (admin, merkle root, total tokens)
 *   claimed    — a claimant successfully claimed tokens
 *   reclaimed  — admin recovered unclaimed tokens after expiry
 *   paused     — contract was paused or unpaused
 *
 * Usage:
 *   npx ts-node examples/event-stream.ts
 *
 * Environment variables:
 *   CONTRACT_ID   – Deployed airdrop contract address (C...)  [required]
 *   NETWORK       – "testnet" | "mainnet"                      [default: testnet]
 *   START_LEDGER  – Ledger sequence to start streaming from   [default: latest]
 *   POLL_INTERVAL – Polling interval in milliseconds           [default: 5000]
 *   MAX_PAGES     – Stop after this many poll iterations       [default: run forever]
 *
 * Example:
 *   CONTRACT_ID=C... npx ts-node examples/event-stream.ts
 *   CONTRACT_ID=C... START_LEDGER=100000 POLL_INTERVAL=3000 npx ts-node examples/event-stream.ts
 */

import { rpc as StellarRpc, xdr, Address as StellarAddress } from "@stellar/stellar-sdk";
import type {
  ClaimedEvent,
  InitEvent,
  ReclaimedEvent,
  PausedEvent,
  AirdropEvent,
} from "@soroban-merkle-airdrop/sdk";

// ─── Configuration ─────────────────────────────────────────────────────────

const CONTRACT_ID = process.env.CONTRACT_ID ?? "";
const NETWORK = (process.env.NETWORK ?? "testnet") as "testnet" | "mainnet";
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL ?? "5000", 10);
const MAX_PAGES = process.env.MAX_PAGES ? parseInt(process.env.MAX_PAGES, 10) : Infinity;

// Each network's Soroban RPC endpoint.
const RPC_URLS: Record<string, string> = {
  testnet: "https://soroban-testnet.stellar.org",
  mainnet: "https://mainnet.sorobanrpc.com",
};

// ─── ANSI colour helpers ────────────────────────────────────────────────────

const DIM   = "\x1b[2m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const CYAN  = "\x1b[36m";
const YELLOW = "\x1b[33m";
const BLUE  = "\x1b[34m";
const MAGENTA = "\x1b[35m";

// ─── Event decoder ─────────────────────────────────────────────────────────

/**
 * Decode a single Soroban event returned by `getEvents` into a typed
 * {@link AirdropEvent}, or return `null` if the event is unrecognised.
 *
 * The airdrop contract encodes events as:
 *   topics[0]: Symbol (event name)
 *   topics[1]: Address (admin or claimant)
 *   value:     i128 (amount) or tuple (init)
 */
function decodeEvent(
  event: StellarRpc.Api.RawEventResponse
): AirdropEvent | null {
  try {
    const topics = event.topic.map((t) => xdr.ScVal.fromXDR(t, "base64"));
    const dataVal = xdr.ScVal.fromXDR(event.value, "base64");

    if (topics.length < 1) return null;

    // topics[0] is always the event name symbol.
    const nameVal = topics[0];
    if (nameVal.switch() !== xdr.ScValType.scvSymbol()) return null;
    const name = nameVal.sym().toString();

    // topics[1] is the address (admin or claimant) when present.
    const addressStr =
      topics.length >= 2 && topics[1].switch() === xdr.ScValType.scvAddress()
        ? StellarAddress.fromScVal(topics[1]).toString()
        : "";

    switch (name) {
      case "init": {
        // Data is a map or struct containing merkle_root and total_amount.
        // We attempt to parse a Vec<ScVal> pair or a Map.
        const { merkleRoot, totalAmount } = decodeInitData(dataVal);
        const data: InitEvent = {
          admin: addressStr,
          merkleRoot,
          totalAmount,
        };
        return { type: "init", data };
      }

      case "claimed": {
        // Data is the i128 amount claimed.
        const amount = decodeI128(dataVal);
        const data: ClaimedEvent = {
          claimant: addressStr,
          amount,
        };
        return { type: "claimed", data };
      }

      case "reclaimed": {
        // Data is a tuple (balance: i128, expiration: u64).
        // We extract only the balance for display.
        const balance = decodeReclaimedBalance(dataVal);
        const data: ReclaimedEvent = {
          admin: addressStr,
          balance,
        };
        return { type: "reclaimed", data };
      }

      case "paused": {
        // Data is a bool: true = unpaused, false = paused.
        const active = decodeBool(dataVal);
        const data: PausedEvent = {
          admin: addressStr,
          active,
        };
        return { type: "paused", data };
      }

      default:
        return null;
    }
  } catch {
    // Decoding failures are silently skipped — they indicate events from
    // a different contract or a schema change. The stream continues.
    return null;
  }
}

// ─── XDR value helpers ──────────────────────────────────────────────────────

/**
 * Decode an i128 ScVal into a JavaScript bigint.
 * The XDR i128 is stored as two 64-bit words: hi (signed) and lo (unsigned).
 */
function decodeI128(val: xdr.ScVal): bigint {
  if (val.switch() === xdr.ScValType.scvI128()) {
    const i128 = val.i128();
    const hi = BigInt(i128.hi().toString());
    const lo = BigInt(i128.lo().toString());
    return (hi << 64n) | lo;
  }
  if (val.switch() === xdr.ScValType.scvI64()) {
    return BigInt(val.i64().toString());
  }
  // Fallback: some versions emit as u64.
  if (val.switch() === xdr.ScValType.scvU64()) {
    return BigInt(val.u64().toString());
  }
  return 0n;
}

/** Decode a bool ScVal. Returns false on parse failure. */
function decodeBool(val: xdr.ScVal): boolean {
  if (val.switch() === xdr.ScValType.scvBool()) {
    return val.b();
  }
  return false;
}

/**
 * Decode the `init` event data value.
 *
 * The contract emits init data as a `Map { "root" → Bytes(32), "total" → i128 }`.
 * We try to extract both fields gracefully.
 */
function decodeInitData(val: xdr.ScVal): { merkleRoot: string; totalAmount: bigint } {
  let merkleRoot = "";
  let totalAmount = 0n;

  if (val.switch() === xdr.ScValType.scvMap()) {
    for (const entry of val.map() ?? []) {
      const keyVal = entry.key();
      const keyStr =
        keyVal.switch() === xdr.ScValType.scvSymbol()
          ? keyVal.sym().toString()
          : keyVal.switch() === xdr.ScValType.scvString()
          ? keyVal.str().toString()
          : "";

      if (keyStr === "root" || keyStr === "merkle_root") {
        const v = entry.val();
        if (v.switch() === xdr.ScValType.scvBytes()) {
          merkleRoot = Buffer.from(v.bytes()).toString("hex");
        }
      } else if (keyStr === "total" || keyStr === "total_amount") {
        totalAmount = decodeI128(entry.val());
      }
    }
  }

  return { merkleRoot, totalAmount };
}

/**
 * Decode the `reclaimed` event data.
 *
 * The contract emits `(balance: i128, expiration: u64)` as a Vec or struct.
 * We extract only the balance (first element).
 */
function decodeReclaimedBalance(val: xdr.ScVal): bigint {
  // Tuple encoded as Vec.
  if (val.switch() === xdr.ScValType.scvVec()) {
    const items = val.vec() ?? [];
    if (items.length >= 1) {
      return decodeI128(items[0]);
    }
  }
  // May also come through as a plain i128 in simpler contract versions.
  return decodeI128(val);
}

// ─── Ledger cursor helpers ──────────────────────────────────────────────────

/**
 * Resolve the starting ledger number for event queries.
 * Falls back to `(latest - 1)` to ensure the first poll gets recent events.
 */
async function resolveStartLedger(server: StellarRpc.Server): Promise<number> {
  if (process.env.START_LEDGER) {
    const n = parseInt(process.env.START_LEDGER, 10);
    if (!isNaN(n) && n > 0) return n;
  }
  try {
    const info = await server.getLatestLedger();
    // Start one ledger back so we don't miss events on the very first poll.
    return Math.max(1, info.sequence - 1);
  } catch {
    return 1;
  }
}

// ─── Pretty-printing ────────────────────────────────────────────────────────

/** Format a raw bigint amount as a decimal string with optional label. */
function fmtAmount(amount: bigint): string {
  return `${amount.toLocaleString()} stroops`;
}

/** Print a decoded airdrop event to stdout with colour coding. */
function printEvent(event: AirdropEvent, ledger: number): void {
  const ts = new Date().toISOString();
  const ledgerLabel = `${DIM}[ledger ${ledger}]${RESET}`;

  switch (event.type) {
    case "init": {
      const { admin, merkleRoot, totalAmount } = event.data;
      console.log(
        `${GREEN}▶ INIT${RESET}  ${ledgerLabel} ${DIM}${ts}${RESET}\n` +
        `   admin       : ${CYAN}${admin}${RESET}\n` +
        `   merkle root : ${merkleRoot || "(not decoded)"}\n` +
        `   total       : ${fmtAmount(totalAmount)}`
      );
      break;
    }
    case "claimed": {
      const { claimant, amount } = event.data;
      console.log(
        `${BLUE}★ CLAIMED${RESET} ${ledgerLabel} ${DIM}${ts}${RESET}\n` +
        `   claimant : ${CYAN}${claimant}${RESET}\n` +
        `   amount   : ${fmtAmount(amount)}`
      );
      break;
    }
    case "reclaimed": {
      const { admin, balance } = event.data;
      console.log(
        `${YELLOW}↩ RECLAIMED${RESET} ${ledgerLabel} ${DIM}${ts}${RESET}\n` +
        `   admin   : ${CYAN}${admin}${RESET}\n` +
        `   balance : ${fmtAmount(balance)}`
      );
      break;
    }
    case "paused": {
      const { admin, active } = event.data;
      console.log(
        `${MAGENTA}⏸ PAUSED${RESET}  ${ledgerLabel} ${DIM}${ts}${RESET}\n` +
        `   admin  : ${CYAN}${admin}${RESET}\n` +
        `   active : ${active ? "▶ unpaused" : "⏸ paused"}`
      );
      break;
    }
  }
  console.log();
}

// ─── Main polling loop ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!CONTRACT_ID) {
    console.error(
      "❌ CONTRACT_ID is not set.\n" +
      "   Provide the deployed airdrop contract address via:\n" +
      "     CONTRACT_ID=C... npx ts-node examples/event-stream.ts"
    );
    process.exit(1);
  }

  const rpcUrl = RPC_URLS[NETWORK] ?? RPC_URLS.testnet;
  const server = new StellarRpc.Server(rpcUrl);

  console.log(`soroban-merkle-airdrop event stream`);
  console.log(`  network  : ${NETWORK}`);
  console.log(`  rpc      : ${rpcUrl}`);
  console.log(`  contract : ${CONTRACT_ID}`);
  console.log(`  poll     : every ${POLL_INTERVAL}ms`);
  console.log();

  // Resolve the ledger to start from.
  let cursorLedger = await resolveStartLedger(server);
  console.log(`Starting from ledger ${cursorLedger}…\n`);

  let pages = 0;

  // Graceful shutdown on Ctrl-C.
  process.on("SIGINT", () => {
    console.log("\nInterrupted — shutting down.");
    process.exit(0);
  });

  // Poll in a simple loop.  For production use, consider replacing this with a
  // persistent cursor stored to disk and a back-off strategy on errors.
  while (pages < MAX_PAGES) {
    try {
      const response = await server.getEvents({
        startLedger: cursorLedger,
        filters: [
          {
            type: "contract",
            contractIds: [CONTRACT_ID],
          },
        ],
        limit: 200,
      });

      let eventsDecoded = 0;

      for (const rawEvent of response.events ?? []) {
        const decoded = decodeEvent(rawEvent);
        if (decoded) {
          printEvent(decoded, rawEvent.ledger);
          eventsDecoded++;
        }
        // Advance the cursor past this event's ledger so we don't re-fetch it.
        if (rawEvent.ledger >= cursorLedger) {
          cursorLedger = rawEvent.ledger + 1;
        }
      }

      if (eventsDecoded === 0 && pages % 12 === 0) {
        // Print a heartbeat every ~60 s (12 × 5 s) when idle.
        console.log(
          `${DIM}[${new Date().toISOString()}] polling ledger ${cursorLedger}… (no new events)${RESET}`
        );
      }
    } catch (err) {
      // Network / RPC errors should not terminate the stream.
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${DIM}[poll error] ${msg}${RESET}`);
    }

    pages++;

    if (pages < MAX_PAGES) {
      await sleep(POLL_INTERVAL);
    }
  }

  console.log(`Reached MAX_PAGES=${MAX_PAGES} — exiting.`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
