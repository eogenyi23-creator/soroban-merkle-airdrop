import type { Metadata } from "next";
import { NetworkProvider } from "./context/NetworkContext";
import NavBar from "./components/NavBar";

/**
 * Canonical base URL for Open Graph / Twitter card meta tags.
 * Set NEXT_PUBLIC_BASE_URL in your environment (e.g. https://airdrop.example.com).
 * Falls back to an empty string so relative URLs still work locally.
 */
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "";

export const metadata: Metadata = {
  title: "Merkle Airdrop — Stellar",
  description:
    "Claim your token allocation from this gas-efficient Merkle airdrop on Stellar. One compact proof — no batch transfers.",
  metadataBase: BASE_URL ? new URL(BASE_URL) : undefined,
  openGraph: {
    title: "Merkle Airdrop — Stellar",
    description:
      "Claim your token allocation from this gas-efficient Merkle airdrop on Stellar. One compact proof — no batch transfers.",
    type: "website",
    url: BASE_URL || undefined,
  },
  twitter: {
    card: "summary",
    title: "Merkle Airdrop — Stellar",
    description:
      "Claim your token allocation from this gas-efficient Merkle airdrop on Stellar. One compact proof — no batch transfers.",
  },
};

// FOUC-prevention script: runs synchronously before the first paint so the
// correct data-theme is applied before any CSS is rendered.
const themeScript = `(function(){
  var theme = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Responsive viewport meta — ensures mobile scaling */}
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* Blocking script — must run before any paint to prevent FOUC (#113) */}
        {/* eslint-disable-next-line react/no-danger */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <style>{`
          /* ── Theme variables (#113) ──────────────────── */
          :root[data-theme='dark'] {
            --bg:         #0a0a0a;
            --surface:    #111;
            --border:     #222;
            --border-alt: #1a1a1a;
            --text:       #ededed;
            --text-muted: #555;
            --text-dim:   #888;
            --accent:     #8ae4ff;
            --accent-fg:  #000;
            --success:    #4caf50;
            --success-bg: #1a3a1a;
            --success-bd: #2e5c2e;
            --error:      #ff6b6b;
            --error-bg:   #3a1a1a;
            --error-bd:   #5c2e2e;
            --surface-alt:#1e1e1e;
            --border-sel: #444;
          }
          :root[data-theme='light'] {
            --bg:         #f8f9fa;
            --surface:    #ffffff;
            --border:     #e2e8f0;
            --border-alt: #e2e8f0;
            --text:       #0f172a;
            --text-muted: #475569;
            --text-dim:   #64748b;
            --accent:     #0891b2;
            --accent-fg:  #ffffff;
            --success:    #16a34a;
            --success-bg: #dcfce7;
            --success-bd: #86efac;
            --error:      #dc2626;
            --error-bg:   #fee2e2;
            --error-bd:   #fca5a5;
            --surface-alt:#f1f5f9;
            --border-sel: #94a3b8;
          }

          *, *::before, *::after { box-sizing: border-box; }
          body {
            margin: 0;
            font-family: system-ui, sans-serif;
            background: var(--bg);
            color: var(--text);
            min-height: 100vh;
            transition: background 0.2s ease, color 0.2s ease;
          }
          /* ── Nav ─────────────────────────────────────── */
          .nav {
            border-bottom: 1px solid var(--border);
            padding: 16px 24px;
            display: flex;
            align-items: center;
            gap: 12px;
            flex-wrap: wrap;
          }
          .nav-logo {
            color: var(--accent);
            text-decoration: none;
            font-weight: 700;
            font-size: 18px;
            min-height: 44px;
            display: inline-flex;
            align-items: center;
          }
          .nav-tagline {
            color: var(--text-muted);
            font-size: 13px;
            flex: 1;
          }
          /* ── Network switcher ────────────────────────── */
          .network-switcher {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-left: auto;
          }
          .network-label {
            font-size: 12px;
            color: var(--text-dim);
            white-space: nowrap;
          }
          .network-select {
            background: var(--surface);
            color: var(--text);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 6px 10px;
            font-size: 13px;
            cursor: pointer;
            min-height: 44px;
            min-width: 130px;
          }
          .network-select:focus {
            outline: 2px solid var(--accent);
            outline-offset: 2px;
          }
          /* ── Network badge ───────────────────────────── */
          .network-badge {
            display: inline-block;
            padding: 4px 10px;
            border-radius: 999px;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            min-height: 24px;
            line-height: 1.5;
          }
          .network-badge--testnet {
            background: var(--success-bg);
            color: var(--success);
            border: 1px solid var(--success-bd);
          }
          .network-badge--mainnet {
            background: var(--error-bg);
            color: var(--error);
            border: 1px solid var(--error-bd);
          }
          /* ── Theme toggle button (#113) ──────────────── */
          .theme-toggle {
            background: none;
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 6px 10px;
            cursor: pointer;
            font-size: 18px;
            line-height: 1;
            color: var(--text);
            min-height: 44px;
            min-width: 44px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
          }
          .theme-toggle:focus-visible {
            outline: 2px solid var(--accent);
            outline-offset: 2px;
          }
          /* ── Main content ────────────────────────────── */
          .main-content {
            max-width: 760px;
            margin: 0 auto;
            padding: 48px 24px;
          }
          /* ── Footer ──────────────────────────────────── */
          .footer {
            text-align: center;
            padding: 24px;
            color: var(--text-muted);
            font-size: 13px;
            border-top: 1px solid var(--border-alt);
          }
          .footer a { color: var(--accent); }

          /* ── Feature grid (landing page) ─────────────── */
          /* Responsive breakpoints (#79):
           *   ≥ 768px  → 3-column grid (default)
           *   600–767px → 2-column grid
           *   < 600px  → single column (mobile-first)
           * All interactive elements have min-height: 44px (touch target).
           */
          .feature-grid {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 20px;
            margin-top: 48px;
          }
          @media (max-width: 600px) {
            .feature-grid {
              grid-template-columns: 1fr;
            }
            .nav { padding: 12px 16px; }
            .main-content { padding: 32px 16px; }
          }
          @media (min-width: 601px) and (max-width: 767px) {
            .feature-grid {
              grid-template-columns: 1fr 1fr;
            }
          }

          /* ── Claim page form ─────────────────────────── */
          .claim-form-section {
            display: flex;
            flex-direction: column;
            gap: 16px;
          }
          .claim-input {
            display: block;
            width: 100%;
            padding: 12px 14px;
            margin-top: 6px;
            font-size: 14px;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 8px;
            color: var(--text);
            outline: none;
            font-family: monospace;
          }
          .claim-input:focus {
            outline: 2px solid var(--accent);
            outline-offset: 2px;
            border-color: var(--accent);
          }
          .claim-btn {
            padding: 14px 24px;
            font-weight: 700;
            font-size: 15px;
            border: none;
            border-radius: 10px;
            cursor: pointer;
            width: 100%;
            min-height: 44px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
          }
          .claim-btn:focus-visible {
            outline: 2px solid var(--accent);
            outline-offset: 2px;
          }
          .claim-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          .tab-btn {
            padding: 8px 18px;
            font-size: 13px;
            background: transparent;
            color: var(--text-dim);
            border: 1px solid var(--border);
            border-radius: 8px;
            cursor: pointer;
            min-height: 44px;
          }
          .tab-btn[aria-selected="true"] {
            font-weight: 700;
            background: var(--surface-alt);
            color: var(--text);
            border-color: var(--border-sel);
          }
          .tab-btn:focus-visible {
            outline: 2px solid var(--accent);
            outline-offset: 2px;
          }
          /* URL row — stacks on mobile */
          .url-row {
            display: flex;
            gap: 8px;
            margin-top: 6px;
          }
          .url-row .claim-input {
            flex: 1;
            margin-top: 0;
          }
          .url-row .claim-btn {
            width: auto;
            padding: 0 20px;
            white-space: nowrap;
          }
          @media (max-width: 480px) {
            .url-row { flex-direction: column; }
            .url-row .claim-btn { width: 100%; padding: 14px 24px; }
          }

          /* Touch-target helper — guarantee 44×44 on interactive elements */
          a, button, [role="tab"] {
            min-height: 44px;
          }
          /* Logo link inline-flex already handles it; override anchors-in-text */
          .footer a, p a { min-height: unset; }
        `}</style>
      </head>
      <body>
        <NetworkProvider>
          <NavBar />
          <main className="main-content" id="main-content">
            {children}
          </main>
          <footer className="footer">
            Built on Stellar ·{" "}
            <a
              href="https://github.com/eogenyi23-creator/soroban-merkle-airdrop"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
          </footer>
        </NetworkProvider>
      </body>
    </html>
  );
}
