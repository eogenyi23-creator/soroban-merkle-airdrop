"use client";

import { useState } from "react";
import { createAirdropClient, verifyProof, NETWORKS } from "@soroban-merkle-airdrop/sdk";

const CONTRACT_ID = process.env.NEXT_PUBLIC_AIRDROP_CONTRACT_ID ?? "";
const NETWORK = (process.env.NEXT_PUBLIC_NETWORK ?? "testnet") as "testnet" | "mainnet";
// Operators can pre-fill the tree URL via this env var.
const DEFAULT_TREE_URL = process.env.NEXT_PUBLIC_MERKLE_TREE_URL ?? "";

type Status =
  | "idle"
  | "checking"
  | "eligible"
  | "not_eligible"
  | "claimed"
  | "claiming"
  | "success"
  | "error";

type TreeInputMode = "url" | "paste";

export default function ClaimPage() {
  const [address, setAddress] = useState("");
  const [secretKey, setSecretKey] = useState("");

  // Tree data — either pasted JSON or fetched from URL
  const [treeInputMode, setTreeInputMode] = useState<TreeInputMode>(
    DEFAULT_TREE_URL ? "url" : "paste"
  );
  const [treeUrl, setTreeUrl] = useState(DEFAULT_TREE_URL);
  const [proofJson, setProofJson] = useState("");
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState("");
  // Parsed tree held in memory after a successful fetch
  const [parsedTree, setParsedTree] = useState<Record<string, unknown> | null>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [txHash, setTxHash] = useState("");

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /** Return the active tree object (parsed JSON or fetched tree). */
  function getTree(): Record<string, unknown> | null {
    if (treeInputMode === "url") return parsedTree;
    if (!proofJson.trim()) return null;
    try {
      return JSON.parse(proofJson) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  function validateTree(tree: unknown): tree is { root: string; proofs: Record<string, unknown> } {
    if (!tree || typeof tree !== "object") return false;
    const t = tree as Record<string, unknown>;
    return typeof t.root === "string" && typeof t.proofs === "object" && t.proofs !== null;
  }

  // ─── Fetch tree from URL ───────────────────────────────────────────────────

  async function handleFetchTree() {
    const url = treeUrl.trim();
    if (!url) return;
    setIsFetching(true);
    setFetchError("");
    setParsedTree(null);

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Server returned ${response.status} ${response.statusText}`);
      }
      const data: unknown = await response.json();
      if (!validateTree(data)) {
        throw new Error("Fetched file is not a valid merkle-tree.json (missing root or proofs)");
      }
      setParsedTree(data as Record<string, unknown>);
      setFetchError("");
    } catch (err) {
      const error = err as Error;
      // Provide a helpful message for CORS failures, which surface as TypeError
      // with a generic "Failed to fetch" message in the browser.
      if (
        error instanceof TypeError &&
        error.message.toLowerCase().includes("failed to fetch")
      ) {
        setFetchError(
          "Could not fetch the tree — this is likely a CORS error. " +
            "Ask the host to set Access-Control-Allow-Origin: * on the file, " +
            "or paste the JSON directly using the textarea below."
        );
      } else {
        setFetchError(error.message);
      }
    } finally {
      setIsFetching(false);
    }
  }

  // ─── Check eligibility ────────────────────────────────────────────────────

  async function handleCheck() {
    if (!address.trim()) return;
    setStatus("checking");
    setMessage("");
    try {
      if (!CONTRACT_ID) throw new Error("Airdrop contract not configured (NEXT_PUBLIC_AIRDROP_CONTRACT_ID)");
      const client = createAirdropClient({ ...NETWORKS[NETWORK], contractId: CONTRACT_ID });
      const claimed = await client.isClaimed(address.trim());
      if (claimed) {
        setStatus("claimed");
        setMessage("This address has already claimed.");
      } else {
        const tree = getTree();
        if (tree) {
          if (!validateTree(tree)) {
            throw new Error("Invalid tree format — check your JSON or URL");
          }
          const entry = (tree.proofs as Record<string, unknown>)[address.trim()];
          if (!entry) {
            setStatus("not_eligible");
            setMessage("This address is not in the airdrop list.");
          } else {
            const typedEntry = entry as { amount: string | number | bigint };
            setStatus("eligible");
            setMessage(`Eligible! Amount: ${typedEntry.amount} tokens`);
          }
        } else {
          setStatus("eligible");
          setMessage("Address not yet claimed. Provide your merkle-tree.json to proceed.");
        }
      }
    } catch (err) {
      setStatus("error");
      setMessage((err as Error).message);
    }
  }

  // ─── Claim ────────────────────────────────────────────────────────────────

  async function handleClaim() {
    const tree = getTree();
    if (!tree || !secretKey) return;
    setStatus("claiming");
    try {
      if (!validateTree(tree)) throw new Error("Invalid tree format");
      const rawEntry = (tree.proofs as Record<string, unknown>)[address.trim()];
      if (!rawEntry) throw new Error("Address not found in proof file");

      const entry = rawEntry as { address: string; amount: string | number | bigint; proof: string[] };
      const proof = { ...entry, amount: BigInt(entry.amount) };

      // Verify proof locally before submitting
      if (!verifyProof(tree.root, proof.address, proof.amount, proof.proof)) {
        throw new Error("Proof verification failed — file may be corrupted");
      }

      const client = createAirdropClient({ ...NETWORKS[NETWORK], contractId: CONTRACT_ID });
      const result = await client.claim(proof, secretKey);
      setTxHash(result.txHash);
      setStatus("success");
      setMessage(`Successfully claimed ${result.amount.toString()} tokens!`);
    } catch (err) {
      setStatus("error");
      setMessage((err as Error).message);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const statusColor: Record<Status, string> = {
    idle: "#888",
    checking: "#888",
    eligible: "#4caf50",
    not_eligible: "#f0a500",
    claimed: "#f0a500",
    claiming: "#888",
    success: "#4caf50",
    error: "#ff6b6b",
  };

  const treeIsReady =
    treeInputMode === "paste"
      ? proofJson.trim().length > 0
      : parsedTree !== null;

  return (
    <div>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Check &amp; Claim</h1>
      <p style={{ color: "#888", marginBottom: 32 }}>
        Enter your Stellar address to check eligibility, then claim your tokens.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Address input */}
        <label style={{ fontSize: 13, color: "#aaa" }}>
          YOUR STELLAR ADDRESS
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="G... or C..."
            style={inputStyle}
            aria-label="Stellar address"
          />
        </label>

        {/* Tree input — mode toggle */}
        <div>
          <div style={{ fontSize: 13, color: "#aaa", marginBottom: 8 }}>
            MERKLE TREE SOURCE
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button
              onClick={() => setTreeInputMode("url")}
              style={tabStyle(treeInputMode === "url")}
              aria-pressed={treeInputMode === "url"}
            >
              URL
            </button>
            <button
              onClick={() => setTreeInputMode("paste")}
              style={tabStyle(treeInputMode === "paste")}
              aria-pressed={treeInputMode === "paste"}
            >
              Paste JSON
            </button>
          </div>

          {/* URL mode */}
          {treeInputMode === "url" && (
            <div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="url"
                  value={treeUrl}
                  onChange={(e) => {
                    setTreeUrl(e.target.value);
                    setParsedTree(null);
                    setFetchError("");
                  }}
                  placeholder="https://example.com/merkle-tree.json"
                  style={{ ...inputStyle, flex: 1, marginTop: 0 }}
                  aria-label="Merkle tree URL"
                />
                <button
                  onClick={handleFetchTree}
                  disabled={!treeUrl.trim() || isFetching}
                  style={{
                    ...btnStyle("#8ae4ff"),
                    width: "auto",
                    padding: "12px 20px",
                    fontSize: 13,
                    flexShrink: 0,
                  }}
                >
                  {isFetching ? "Fetching…" : "Fetch Tree"}
                </button>
              </div>

              {fetchError && (
                <div
                  role="alert"
                  style={{
                    marginTop: 10,
                    padding: "10px 14px",
                    borderRadius: 8,
                    background: "#1a0a0a",
                    border: "1px solid #ff6b6b",
                    color: "#ff6b6b",
                    fontSize: 13,
                  }}
                >
                  {fetchError}
                </div>
              )}

              {parsedTree && (
                <div
                  style={{
                    marginTop: 10,
                    padding: "10px 14px",
                    borderRadius: 8,
                    background: "#0a1a0a",
                    border: "1px solid #4caf50",
                    color: "#4caf50",
                    fontSize: 13,
                  }}
                >
                  ✓ Tree loaded —{" "}
                  {Object.keys((parsedTree.proofs as Record<string, unknown>) ?? {}).length} entries
                </div>
              )}
            </div>
          )}

          {/* Paste mode */}
          {treeInputMode === "paste" && (
            <textarea
              value={proofJson}
              onChange={(e) => setProofJson(e.target.value)}
              placeholder="Paste your merkle-tree.json contents here…"
              rows={5}
              style={{ ...inputStyle, fontFamily: "monospace", fontSize: 12 }}
              aria-label="Merkle proof JSON"
            />
          )}
        </div>

        {/* Check button */}
        <button
          onClick={handleCheck}
          disabled={!address || status === "checking"}
          style={btnStyle("#8ae4ff")}
        >
          {status === "checking" ? "Checking…" : "Check Eligibility"}
        </button>

        {/* Status message */}
        {status !== "idle" && message && (
          <div
            role="status"
            aria-live="polite"
            style={{
              padding: "12px 16px",
              borderRadius: 8,
              background: "#111",
              border: `1px solid ${statusColor[status]}`,
              color: statusColor[status],
              fontSize: 14,
            }}
          >
            {message}
          </div>
        )}

        {/* Claim form — shown when eligible and tree is loaded */}
        {(status === "eligible" || status === "claiming") && treeIsReady && (
          <>
            <label style={{ fontSize: 13, color: "#aaa" }}>
              SECRET KEY (signs the claim transaction — never sent to any server)
              <input
                type="password"
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                placeholder="S..."
                style={inputStyle}
                aria-label="Stellar secret key"
              />
            </label>
            <button
              onClick={handleClaim}
              disabled={!secretKey || status === "claiming"}
              style={btnStyle("#4caf50")}
            >
              {status === "claiming" ? "Claiming…" : "Claim Tokens →"}
            </button>
          </>
        )}

        {/* Transaction link */}
        {status === "success" && txHash && (
          <div style={{ marginTop: 8 }}>
            <a
              href={`https://stellar.expert/explorer/${NETWORK}/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#8ae4ff", fontSize: 13 }}
            >
              View transaction on Stellar Expert →
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "12px 14px",
  marginTop: 6,
  fontSize: 14,
  background: "#111",
  border: "1px solid #333",
  borderRadius: 8,
  color: "#ededed",
  outline: "none",
  boxSizing: "border-box",
  fontFamily: "monospace",
};

function btnStyle(bg: string): React.CSSProperties {
  return {
    padding: "14px 24px",
    background: bg,
    color: "#000",
    fontWeight: 700,
    fontSize: 15,
    border: "none",
    borderRadius: 10,
    cursor: "pointer",
    width: "100%",
  };
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    padding: "8px 18px",
    background: active ? "#8ae4ff" : "#1a1a1a",
    color: active ? "#000" : "#888",
    fontWeight: active ? 700 : 400,
    fontSize: 13,
    border: `1px solid ${active ? "#8ae4ff" : "#333"}`,
    borderRadius: 8,
    cursor: "pointer",
  };
}
