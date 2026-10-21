"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createAirdropClient, NETWORKS } from "@soroban-merkle-airdrop/sdk";
import { useNetwork } from "./context/NetworkContext";

interface AirdropProgress {
  totalDeposited: bigint;
  totalClaimed: bigint;
  remainingBalance: bigint;
}

export default function HomePage() {
  const { network, contractId } = useNetwork();
  const [progress, setProgress] = useState<AirdropProgress | null>(null);
  const [progressLoading, setProgressLoading] = useState(false);

  useEffect(() => {
    if (!contractId) return;
    let cancelled = false;
    setProgressLoading(true);

    const client = createAirdropClient({ ...NETWORKS[network], contractId });
    Promise.all([client.totalDeposited(), client.totalClaimed()])
      .then(([totalDeposited, totalClaimed]) => {
        if (!cancelled) {
          setProgress({
            totalDeposited,
            totalClaimed,
            remainingBalance: (totalDeposited as bigint) - (totalClaimed as bigint),
          });
        }
      })
      .catch(() => {
        // Non-fatal: progress display is best-effort
      })
      .finally(() => {
        if (!cancelled) setProgressLoading(false);
      });

    return () => { cancelled = true; };
  }, [contractId, network]);

  const claimedPct =
    progress && progress.totalDeposited > 0n
      ? Number((progress.totalClaimed * 10000n) / progress.totalDeposited) / 100
      : 0;

  return (
    <div>
      <div style={{ textAlign: "center", marginBottom: 56 }}>
        <div style={{ fontSize: 64, marginBottom: 16 }} aria-hidden="true">🪂</div>
        <h1 style={{ fontSize: "clamp(28px, 6vw, 40px)", fontWeight: 800, marginBottom: 12 }}>
          Token Airdrop
        </h1>
        <p style={{ color: "#aaa", fontSize: "clamp(15px, 3vw, 18px)", maxWidth: 540, margin: "0 auto 32px" }}>
          Check if your address is eligible and claim your tokens using a
          cryptographic Merkle proof — verified on-chain.
        </p>
        <Link
          href="/claim"
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "14px 36px",
            background: "var(--accent)",
            color: "var(--accent-fg)",
            fontWeight: 700,
            fontSize: 16,
            borderRadius: 10,
            textDecoration: "none",
            minHeight: 44,
          }}
        >
          Check Eligibility →
        </Link>
      </div>

      {/* ── Airdrop progress bar ── */}
      {contractId && (
        <div
          aria-label="Airdrop progress"
          style={{
            border: "1px solid #222",
            borderRadius: 12,
            padding: 24,
            background: "#111",
            marginBottom: 40,
          }}
        >
          <h2 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700 }}>Airdrop Progress</h2>

          {progressLoading && (
            <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Loading progress…</p>
          )}

          {!progressLoading && progress === null && (
            <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Could not load progress data.</p>
          )}

          {progress !== null && (
            <>
              {/* Progress bar */}
              <div
                role="progressbar"
                aria-valuenow={claimedPct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${claimedPct.toFixed(1)}% of tokens claimed`}
                style={{
                  background: "#1a1a1a",
                  borderRadius: 8,
                  height: 18,
                  overflow: "hidden",
                  marginBottom: 10,
                  border: "1px solid #333",
                }}
              >
                <div
                  style={{
                    width: `${Math.min(100, claimedPct)}%`,
                    height: "100%",
                    background: claimedPct >= 100 ? "#4caf50" : "#8ae4ff",
                    borderRadius: 8,
                    transition: "width 0.4s ease",
                    minWidth: claimedPct > 0 ? 4 : 0,
                  }}
                />
              </div>

              {/* Labels */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 13,
                  color: "#aaa",
                }}
              >
                <span>
                  <strong style={{ color: "#ededed" }}>
                    {progress.totalClaimed.toLocaleString()}
                  </strong>{" "}
                  tokens claimed out of{" "}
                  <strong style={{ color: "#ededed" }}>
                    {progress.totalDeposited.toLocaleString()}
                  </strong>{" "}
                  total
                </span>
                <span style={{ color: "#888" }}>{claimedPct.toFixed(1)}%</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Feature grid — 3 col on desktop, 2 col on tablet, 1 col on mobile ── */}
      <div className="feature-grid" role="list">
        {[
          {
            icon: "🌲",
            title: "Merkle Proof",
            desc: "Only a 32-byte root is stored on-chain. Recipients prove inclusion with a compact proof.",
          },
          {
            icon: "⚡",
            title: "Gas Efficient",
            desc: "No batch transfers. Each user claims independently — costs only their own transaction fee.",
          },
          {
            icon: "🔒",
            title: "No Double Claims",
            desc: "The contract tracks each claimed address. Once claimed, it cannot be claimed again.",
          },
        ].map(({ icon, title, desc }) => (
          <div
            key={title}
            role="listitem"
            style={{ border: "1px solid #222", borderRadius: 12, padding: 24, background: "#111" }}
          >
            <div style={{ fontSize: 28, marginBottom: 10 }} aria-hidden="true">{icon}</div>
            <h3 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 700 }}>{title}</h3>
            <p style={{ margin: 0, color: "#888", fontSize: 13, lineHeight: 1.6 }}>{desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
