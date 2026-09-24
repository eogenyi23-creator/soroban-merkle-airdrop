/**
 * Claim page — Check & Claim flow.
 *
 * Accessibility fixes applied for #80:
 *   - All form inputs have explicit <label htmlFor="..."> associations
 *   - Tab panels have role="tabpanel", aria-labelledby, id attributes
 *   - Tab buttons have role="tab", aria-selected, aria-controls
 *   - Error banners use role="alert" (assertive live region)
 *   - Status banners use role="status" + aria-live="polite"
 *   - Buttons have type="button" to prevent accidental form submission
 *   - Status message div has data-testid="status-message" for tests
 *   - Disabled buttons also carry aria-disabled for AT compatibility
 *   - Color contrast: all foreground/background pairs meet WCAG AA 4.5:1
 *     (#ededed on #111 ≈ 16:1, #4caf50 on #111 ≈ 5.3:1, etc.)
 */
"use client";

import { useState } from "react";
import { createAirdropClient, verifyProof, NETWORKS } from "@soroban-merkle-airdrop/sdk";
import {
  getPublicKey,
  signTransaction,
  isConnected,
} from "@stellar/freighter-api";
import { useNetwork } from "../context/NetworkContext";

/** If set, pre-fills the tree URL input so users don't have to type it. */
const DEFAULT_TREE_URL = process.env.NEXT_PUBLIC_MERKLE_TREE_URL ?? "";

export type Status =
  | "idle"
  | "checking"
  | "eligible"
  | "not_eligible"
  | "claimed"
  | "claiming"
  | "success"
  | "error";

/** Source for the merkle tree data */
export type TreeSource = "url" | "paste";

export default function ClaimPage() {
  const { network, contractId } = useNetwork();

  // Wallet state — no secret key ever stored
  const [walletAddress, setWalletAddress] = useState("");
  const [walletConnected, setWalletConnected] = useState(false);
  const [walletError, setWalletError] = useState("");

  // URL-based tree loading
  const [treeSource, setTreeSource] = useState<TreeSource>("url");
  const [treeUrl, setTreeUrl] = useState(DEFAULT_TREE_URL);
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState("");

  // Paste fallback
  const [proofJson, setProofJson] = useState("");

  // Parsed tree (populated either from fetch or from textarea)
  const [treeData, setTreeData] = useState<Record<string, unknown> | null>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [txHash, setTxHash] = useState("");

  // ─── Connect Wallet (Freighter) ─────────────────────────────────────────────

  async function handleConnectWallet() {
    setWalletError("");
    try {
      const connected = await isConnected();
      if (!connected) {
        setWalletError(
          "Freighter wallet is not installed. " +
            "Install it from https://freighter.app and refresh the page."
        );
        return;
      }
      const publicKey = await getPublicKey();
      setWalletAddress(publicKey);
      setWalletConnected(true);
    } catch (err) {
      setWalletError((err as Error).message ?? String(err));
    }
  }

  // ─── Fetch tree from URL ────────────────────────────────────────────────────

  async function handleFetchTree() {
    if (!treeUrl.trim()) return;
    setIsFetching(true);
    setFetchError("");
    setTreeData(null);

    try {
      let response: Response;
      try {
        response = await fetch(treeUrl.trim());
      } catch (networkErr) {
        const msg = (networkErr as Error).message ?? String(networkErr);
        const isCors =
          msg.toLowerCase().includes("cors") ||
          msg.toLowerCase().includes("blocked") ||
          msg.toLowerCase().includes("failed to fetch");
        if (isCors) {
          throw new Error(
            "Could not fetch the tree — the server may be blocking cross-origin requests (CORS). " +
              "Try hosting the JSON file on a CORS-enabled storage service (e.g. GitHub Pages, S3 + CORS policy, " +
              'or Cloudflare R2) or paste the file contents directly using the "Paste JSON" tab.'
          );
        }
        throw new Error(`Network error: ${msg}`);
      }

      if (!response.ok) {
        throw new Error(
          `Server returned ${response.status} ${response.statusText}. Check that the URL is correct and publicly accessible.`
        );
      }

      let json: Record<string, unknown>;
      try {
        json = await response.json();
      } catch {
        throw new Error("The response is not valid JSON. Make sure the URL points to a merkle-tree.json file.");
      }

      validateTree(json);
      setTreeData(json);
      setFetchError("");
    } catch (err) {
      setFetchError((err as Error).message);
      setTreeData(null);
    } finally {
      setIsFetching(false);
    }
  }

  // ─── Parse pasted JSON ──────────────────────────────────────────────────────

  function handlePasteChange(value: string) {
    setProofJson(value);
    setTreeData(null);
    setFetchError("");
    if (!value.trim()) return;
    try {
      const json = JSON.parse(value) as Record<string, unknown>;
      validateTree(json);
      setTreeData(json);
    } catch (err) {
      setFetchError((err as Error).message);
    }
  }

  // ─── Basic tree shape validation ────────────────────────────────────────────

  function validateTree(json: Record<string, unknown>) {
    if (typeof json.root !== "string" || json.root.length === 0) {
      throw new Error('Invalid merkle tree file: missing "root" field.');
    }
    if (typeof json.proofs !== "object" || json.proofs === null) {
      throw new Error('Invalid merkle tree file: missing "proofs" field.');
    }
  }

  // ─── Eligibility check ──────────────────────────────────────────────────────

  async function handleCheck() {
    if (!walletAddress.trim()) return;
    setStatus("checking");
    setMessage("");
    try {
      if (!contractId) throw new Error("Airdrop contract not configured. Set NEXT_PUBLIC_AIRDROP_CONTRACT_ID.");
      const client = createAirdropClient({ ...NETWORKS[network], contractId });
      const claimed = await client.isClaimed(walletAddress.trim());
      if (claimed) {
        setStatus("claimed");
        setMessage("This address has already claimed.");
      } else if (treeData) {
        const proofs = treeData.proofs as Record<string, { amount: string; proof: string[] }>;
        const entry = proofs[walletAddress.trim()];
        if (!entry) {
          setStatus("not_eligible");
          setMessage("This address is not in the airdrop list.");
        } else {
          setStatus("eligible");
          setMessage(`Eligible! Amount: ${entry.amount} tokens`);
        }
      } else {
        setStatus("eligible");
        setMessage("Address not yet claimed. Load a merkle tree to proceed.");
      }
    } catch (err) {
      setStatus("error");
      setMessage((err as Error).message);
    }
  }

  // ─── Claim (signed via Freighter, no secret key) ────────────────────────────

  async function handleClaim() {
    if (!treeData || !walletAddress) return;
    setStatus("claiming");
    try {
      const proofs = treeData.proofs as Record<string, { amount: string; proof: string[] }>;
      const entry = proofs[walletAddress.trim()];
      if (!entry) throw new Error("Address not found in merkle tree");

      const proof = {
        address: walletAddress.trim(),
        amount: BigInt(entry.amount),
        proof: entry.proof,
      };

      // Verify proof locally before submitting
      if (!verifyProof(treeData.root as string, proof.address, proof.amount, proof.proof)) {
        throw new Error("Proof verification failed — file may be corrupted or from a different airdrop");
      }

      const client = createAirdropClient({ ...NETWORKS[network], contractId });
      const unsignedXdr = await client.buildClaimTransaction(proof);
      const signedXdr = await signTransaction(unsignedXdr, {
        networkPassphrase:
          network === "mainnet"
            ? "Public Global Stellar Network ; September 2015"
            : "Test SDF Network ; September 2015",
      });
      const result = await client.submitSignedTransaction(signedXdr, proof);
      setTxHash(result.txHash);
      setStatus("success");
      setMessage(`Successfully claimed ${result.amount.toString()} tokens!`);
    } catch (err) {
      setStatus("error");
      setMessage((err as Error).message);
    }
  }

  const statusBorderColor: Record<Status, string> = {
    idle: "#888",
    checking: "#888",
    eligible: "#4caf50",
    not_eligible: "#f0a500",
    claimed: "#f0a500",
    claiming: "#888",
    success: "#4caf50",
    error: "#ff6b6b",
  };

  const statusTextColor: Record<Status, string> = {
    idle: "#888",
    checking: "#888",
    eligible: "#4caf50",
    not_eligible: "#f0a500",
    claimed: "#f0a500",
    claiming: "#888",
    success: "#4caf50",
    error: "#ff6b6b",
  };

  const treeLoaded = treeData !== null;

  return (
    <div>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Check &amp; Claim</h1>
      <p style={{ color: "#888", marginBottom: 32 }}>
        Connect your Freighter wallet to check eligibility and claim your tokens.
      </p>

      <div className="claim-form-section">

        {/* ── Wallet connect ── */}
        {!walletConnected ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              type="button"
              onClick={handleConnectWallet}
              className="claim-btn"
              style={{ background: "#8ae4ff", color: "#000" }}
            >
              Connect Wallet
            </button>
            {walletError && (
              <div
                role="alert"
                style={{
                  padding: "12px 16px",
                  borderRadius: 8,
                  background: "#111",
                  border: "1px solid #ff6b6b",
                  color: "#ff6b6b",
                  fontSize: 13,
                }}
              >
                {walletError}
              </div>
            )}
          </div>
        ) : (
          <div
            role="status"
            aria-live="polite"
            style={{
              padding: "12px 16px",
              borderRadius: 8,
              background: "#111",
              border: "1px solid #4caf50",
              color: "#4caf50",
              fontSize: 13,
              fontFamily: "monospace",
              wordBreak: "break-all",
            }}
          >
            ✓ Wallet connected: {walletAddress}
          </div>
        )}

        {/* ── Merkle tree source tabs ── */}
        <div>
          <div
            role="tablist"
            aria-label="Merkle tree source"
            style={{ display: "flex", gap: 4, marginBottom: 10 }}
          >
            <button
              type="button"
              role="tab"
              id="tab-url"
              aria-selected={treeSource === "url"}
              aria-controls="tabpanel-url"
              onClick={() => { setTreeSource("url"); setFetchError(""); }}
              className="tab-btn"
            >
              Load from URL
            </button>
            <button
              type="button"
              role="tab"
              id="tab-paste"
              aria-selected={treeSource === "paste"}
              aria-controls="tabpanel-paste"
              onClick={() => { setTreeSource("paste"); setFetchError(""); }}
              className="tab-btn"
            >
              Paste JSON
            </button>
          </div>

          {/* ── URL panel ── */}
          {treeSource === "url" && (
            <div
              role="tabpanel"
              id="tabpanel-url"
              aria-labelledby="tab-url"
              style={{ display: "flex", flexDirection: "column", gap: 10 }}
            >
              <div>
                <label htmlFor="tree-url-input" style={{ fontSize: 13, color: "#aaa", display: "block" }}>
                  Merkle Tree URL
                </label>
                <div className="url-row">
                  <input
                    id="tree-url-input"
                    type="url"
                    value={treeUrl}
                    onChange={(e) => { setTreeUrl(e.target.value); setTreeData(null); setFetchError(""); }}
                    placeholder="https://example.com/merkle-tree.json"
                    className="claim-input"
                    aria-describedby={fetchError ? "fetch-error" : undefined}
                  />
                  <button
                    type="button"
                    onClick={handleFetchTree}
                    disabled={!treeUrl.trim() || isFetching}
                    className="claim-btn"
                    style={{ background: "#8ae4ff", color: "#000" }}
                  >
                    {isFetching ? "Fetching…" : "Fetch Tree"}
                  </button>
                </div>
              </div>

              {DEFAULT_TREE_URL && !treeLoaded && !isFetching && !fetchError && (
                <p style={{ fontSize: 12, color: "#888", margin: 0 }}>
                  Default URL pre-filled from <code>NEXT_PUBLIC_MERKLE_TREE_URL</code>. Click &ldquo;Fetch Tree&rdquo; to load it.
                </p>
              )}

              {treeLoaded && (
                <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#4caf50", margin: 0 }}>
                  ✓ Tree loaded successfully
                </p>
              )}

              {fetchError && (
                <div
                  id="fetch-error"
                  role="alert"
                  style={{ padding: "12px 16px", borderRadius: 8, background: "#111", border: "1px solid #ff6b6b", color: "#ff6b6b", fontSize: 13 }}
                >
                  {fetchError}
                </div>
              )}
            </div>
          )}

          {/* ── Paste panel ── */}
          {treeSource === "paste" && (
            <div
              role="tabpanel"
              id="tabpanel-paste"
              aria-labelledby="tab-paste"
            >
              <label htmlFor="proof-json-input" style={{ fontSize: 13, color: "#aaa", display: "block" }}>
                Proof File (JSON from <code>merkle-airdrop generate</code>) — optional for check
              </label>
              <textarea
                id="proof-json-input"
                value={proofJson}
                onChange={(e) => handlePasteChange(e.target.value)}
                placeholder="Paste your merkle-tree.json contents here…"
                rows={6}
                className="claim-input"
                style={{ fontFamily: "monospace", fontSize: 12 }}
                aria-describedby={fetchError ? "paste-error" : undefined}
              />

              {treeLoaded && (
                <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#4caf50", margin: "6px 0 0" }}>
                  ✓ Tree parsed successfully
                </p>
              )}

              {fetchError && (
                <div
                  id="paste-error"
                  role="alert"
                  style={{ marginTop: 8, padding: "12px 16px", borderRadius: 8, background: "#111", border: "1px solid #ff6b6b", color: "#ff6b6b", fontSize: 13 }}
                >
                  {fetchError}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Check button ── */}
        <button
          type="button"
          onClick={handleCheck}
          disabled={!walletConnected || status === "checking"}
          className="claim-btn"
          style={{ background: "#8ae4ff", color: "#000" }}
          aria-disabled={!walletConnected || status === "checking"}
        >
          {status === "checking" ? "Checking..." : "Check Eligibility"}
        </button>

        {/* ── Status message ── */}
        {status !== "idle" && message && (
          <div
            role="status"
            aria-live="polite"
            data-testid="status-message"
            style={{
              padding: "12px 16px",
              borderRadius: 8,
              background: "#111",
              border: `1px solid ${statusBorderColor[status]}`,
              color: statusTextColor[status],
              fontSize: 14,
            }}
          >
            {message}
          </div>
        )}

        {/* ── Claim button (no secret key field) ── */}
        {(status === "eligible" || status === "claiming") && treeLoaded && walletConnected && (
          <button
            type="button"
            onClick={handleClaim}
            disabled={status === "claiming"}
            className="claim-btn"
            style={{ background: "#4caf50", color: "#000" }}
            aria-disabled={status === "claiming"}
          >
            {status === "claiming" ? "Claiming..." : "Claim Tokens →"}
          </button>
        )}

        {/* ── Success link ── */}
        {status === "success" && txHash && (
          <div style={{ marginTop: 8 }}>
            <a
              href={`https://stellar.expert/explorer/${network}/tx/${txHash}`}
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
