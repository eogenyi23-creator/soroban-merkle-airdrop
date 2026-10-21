/**
 * Claim-page layout segment.
 *
 * Overrides the root layout's metadata so the browser tab and social-share
 * cards show a claim-specific title (Issue #95).
 *
 * This file must be a Server Component (no "use client") so that Next.js can
 * statically extract the `metadata` export.  The actual interactive page
 * content lives in `page.tsx` which is a Client Component.
 */
import type { Metadata } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "";
const CLAIM_URL = BASE_URL ? `${BASE_URL}/claim` : undefined;

export const metadata: Metadata = {
  title: "Claim Tokens — Merkle Airdrop",
  description:
    "Check your eligibility and claim your token allocation from this Merkle airdrop on Stellar.",
  openGraph: {
    title: "Claim Tokens — Merkle Airdrop",
    description:
      "Check your eligibility and claim your token allocation from this Merkle airdrop on Stellar.",
    type: "website",
    url: CLAIM_URL,
  },
  twitter: {
    card: "summary",
    title: "Claim Tokens — Merkle Airdrop",
    description:
      "Check your eligibility and claim your token allocation from this Merkle airdrop on Stellar.",
  },
};

export default function ClaimLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
