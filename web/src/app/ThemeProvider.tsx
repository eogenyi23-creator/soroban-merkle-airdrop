"use client";

import { useEffect, useState } from "react";

type Theme = "dark" | "light";

function getInitialTheme(): Theme {
  // This runs only on the client; the FOUC-prevention script in <head>
  // has already set data-theme, so we just read it back.
  if (typeof document !== "undefined") {
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === "dark" || attr === "light") return attr;
  }
  return "dark";
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  // Sync state with whatever the FOUC script already applied
  useEffect(() => {
    setTheme(getInitialTheme());
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // localStorage may be unavailable in some private-browsing modes
    }
  }

  return (
    <button
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      style={{
        marginLeft: "auto",
        background: "none",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "6px 10px",
        cursor: "pointer",
        fontSize: 18,
        lineHeight: 1,
        color: "var(--text)",
      }}
    >
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
}
