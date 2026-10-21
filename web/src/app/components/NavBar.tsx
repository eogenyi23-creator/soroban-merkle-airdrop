"use client";

import { useEffect, useState } from "react";
import { useNetwork, type Network } from "../context/NetworkContext";

type Theme = "dark" | "light";

export default function NavBar() {
  const { network, setNetwork } = useNetwork();

  // Initialise from whatever the FOUC-prevention script already set on <html>.
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === "dark" || attr === "light") setTheme(attr);
  }, []);

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("theme", next); } catch { /* private browsing */ }
  }

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setNetwork(e.target.value as Network);
  }

  return (
    <nav className="nav" aria-label="Site navigation">
      <a href="/" className="nav-logo">
        🪂 Merkle Airdrop
      </a>
      <span className="nav-tagline" aria-hidden="true">
        Powered by Soroban · Stellar
      </span>

      {/* ── Network switcher + badge ── */}
      <div className="network-switcher">
        <label htmlFor="network-select" className="network-label">
          Network:
        </label>
        <select
          id="network-select"
          value={network}
          onChange={handleChange}
          className="network-select"
          aria-label="Select network"
        >
          <option value="testnet">Testnet</option>
          <option value="mainnet">Mainnet</option>
        </select>

        {/* Visual badge — announces the currently active network */}
        <span
          className={`network-badge network-badge--${network}`}
          role="status"
          aria-live="polite"
          aria-label={`Active network: ${network}`}
          data-testid="network-badge"
        >
          {network}
        </span>

        {/* ── Theme toggle (#113) ── */}
        <button
          onClick={toggleTheme}
          className="theme-toggle"
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          data-testid="theme-toggle"
        >
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
      </div>
    </nav>
  );
}
