"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Asterisk, KeyRound, Check, ExternalLink } from "@/components/icons";
import { useConnection } from "./connection";

const navigation = [
  ["/", "The Brief"],
  ["/models", "Model Library"],
  ["/playground", "Playground"],
  ["/learn", "AI 101"],
] as const;

export function Logo() {
  return (
    <span className="logo">
      <span className="logo-icon">
        <Asterisk size={24} aria-hidden="true" />
      </span>
      know<span className="logo-ai">ai</span>
      <span className="logo-period">.</span>
    </span>
  );
}
export function Header() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const connectAfterClose = useRef(false);
  const { connected, openConnect } = useConnection();

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 64rem)");
    const closeOnDesktop = () => {
      if (desktop.matches) setMenuOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  if (pathname === "/editor" || pathname.startsWith("/editor/")) return <header className="desk-chrome"><Link href="/editor" aria-label="knowai editorial home"><Logo /></Link><span>Editorial <span className="desk-private">/ private</span></span><Link className="text-button" href="/" target="_blank">View The Brief ↗</Link></header>;

  return (
    <Dialog.Root open={menuOpen} onOpenChange={setMenuOpen}>
      <header className="site-header">
        <div className="header-inner">
          <Link href="/" aria-label="knowai home">
            <Logo />
          </Link>
          <nav aria-label="Main navigation" className="main-nav">
            {navigation.map(([href, label]) => (
              <Link
                key={href}
                href={href}
                className={pathname === href ? "active" : ""}
                aria-current={pathname === href ? "page" : undefined}
              >
                {label}
              </Link>
            ))}
          </nav>
          <div className="header-actions">
            <button
              type="button"
              className={`button connect-button ${connected ? "is-connected" : ""}`}
              aria-label={
                connected
                  ? "Manage OpenRouter connection"
                  : "Connect OpenRouter"
              }
              onClick={openConnect}
            >
              {connected ? (
                <Check size={16} aria-hidden="true" />
              ) : (
                <KeyRound size={16} aria-hidden="true" />
              )}
              <span>{connected ? "Connected" : "Connect OpenRouter"}</span>
            </button>
            <Dialog.Trigger asChild>
              <button
                type="button"
                className="icon-button mobile-menu"
                aria-label={menuOpen ? "Close menu" : "Open menu"}
              >
                <span className="menu-line" aria-hidden="true" />
                <span className="menu-line" aria-hidden="true" />
              </button>
            </Dialog.Trigger>
          </div>
        </div>
      </header>
      <Dialog.Portal>
        <Dialog.Overlay className="mobile-menu-overlay" />
        <Dialog.Content
          className="mobile-menu-panel"
          onCloseAutoFocus={(event) => {
            if (connectAfterClose.current) {
              event.preventDefault();
              connectAfterClose.current = false;
              openConnect();
            }
          }}
        >
          <div className="mobile-menu-heading">
            <Link
              href="/"
              aria-label="knowai home"
              onClick={() => setMenuOpen(false)}
            >
              <Logo />
            </Link>
            <Dialog.Close asChild>
              <button
                type="button"
                className="icon-button mobile-menu is-open"
                aria-label="Close menu"
              >
                <span className="menu-line" aria-hidden="true" />
                <span className="menu-line" aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Title className="sr-only">Explore knowai</Dialog.Title>
          <Dialog.Description className="sr-only">
            Browse AI news, find a model, or try a comparison.
          </Dialog.Description>
          <nav className="mobile-menu-nav" aria-label="Mobile navigation">
            {navigation.map(([href, label], index) => (
              <Link
                key={href}
                href={href}
                className={pathname === href ? "active" : ""}
                aria-current={pathname === href ? "page" : undefined}
                onClick={() => setMenuOpen(false)}
              >
                <span className="mobile-nav-number" aria-hidden="true">
                  0{index + 1}
                </span>
                {label}
              </Link>
            ))}
          </nav>
          <button
            type="button"
            className={`button primary mobile-menu-connect ${connected ? "is-connected" : ""}`}
            onClick={() => {
              connectAfterClose.current = true;
              setMenuOpen(false);
            }}
          >
            {connected ? (
              <Check size={24} aria-hidden="true" />
            ) : (
              <KeyRound size={24} aria-hidden="true" />
            )}
            {connected ? "Manage OpenRouter connection" : "Connect OpenRouter"}
          </button>
          <p className="mobile-menu-note">
            Your own account. Your choice of model.
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Footer() {
  const pathname = usePathname();
  if (pathname === "/editor" || pathname.startsWith("/editor/")) return null;
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
        <a className="footer-rss" href="/feed.xml" type="application/rss+xml" aria-describedby="rss-help">Subscribe via RSS</a>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <a href="https://openrouter.ai" target="_blank" rel="noreferrer">
          Powered by OpenRouter <ExternalLink size={16} aria-hidden="true" />
        </a>
      </div>
      <p className="footer-fine">
        Independent perspectives. Original sources. Always curious.
        <br />
        <span id="rss-help">Add the RSS feed link to your reader. New stories appear after editorial review.</span>
      </p>
    </footer>
  );
}
