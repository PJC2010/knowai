"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Asterisk, KeyRound, Menu, X, Check, ExternalLink } from "lucide-react";
import { useConnection } from "./connection";

export function Logo() {
  return (
    <span className="logo">
      <span className="logo-icon">
        <Asterisk size={26} strokeWidth={2.3} />
      </span>
      know<span className="logo-ai">ai</span>
      <span className="logo-period">.</span>
    </span>
  );
}
export function Header() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const { connected, openConnect } = useConnection();
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link href="/" aria-label="knowai home">
          <Logo />
        </Link>
        <nav
          aria-label="Main navigation"
          className={menuOpen ? "main-nav open" : "main-nav"}
        >
          {[
            ["/", "The Brief"],
            ["/models", "Model Library"],
            ["/playground", "Playground"],
            ["/learn", "AI 101"],
          ].map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className={pathname === href ? "active" : ""}
              aria-current={pathname === href ? "page" : undefined}
              onClick={() => setMenuOpen(false)}
            >
              {label}
              {label === "Playground" && (
                <span className="nav-new">TRY IT</span>
              )}
            </Link>
          ))}
        </nav>
        <div className="header-actions">
          <button
            className={`button connect-button ${connected ? "is-connected" : ""}`}
            onClick={openConnect}
          >
            {connected ? <Check size={15} /> : <KeyRound size={15} />}
            <span>{connected ? "Connected" : "Connect OpenRouter"}</span>
          </button>
          <button
            className="icon-button mobile-menu"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X /> : <Menu />}
          </button>
        </div>
      </div>
    </header>
  );
}
export function Footer() {
  return (
    <footer className="site-footer">
      <div>
        <Link href="/" aria-label="knowai home">
          <Logo />
        </Link>
        <p>A little less noise. A lot more understanding.</p>
      </div>
      <div className="footer-links">
        <Link href="/learn">AI, explained</Link>
        <Link href="/playground">Try a model</Link>
        <a href="https://openrouter.ai" target="_blank" rel="noreferrer">
          Powered by OpenRouter <ExternalLink size={12} />
        </a>
      </div>
      <p className="footer-fine">
        Independent perspectives. Original sources. Always curious.
      </p>
    </footer>
  );
}
