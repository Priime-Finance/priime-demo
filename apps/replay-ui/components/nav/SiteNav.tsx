"use client";
/* Tier-1 site nav: the priime.finance floating liquid-glass pill, ported to the
   loop app so loop.priime.finance carries the full-site navigation + brand +
   wallet. Wallet is a static, inert pill in this wallet-free demo. */
import { useEffect, useRef, useState } from "react";
import { useBuildHref } from "@/lib/host";

const SITE = "https://priime.finance";
/* In-app destinations that exist in THIS app. There is one vault, so "Vaults"
   points at the single vault page. */
const APP_LINKS = [{ t: "Vaults", href: "/vault" }];
/* Canonical landing set (identical order on priime.finance): Portfolio,
   Ecosystem, Stack, Risk management, Docs, Blog.

   This demo app serves the canvas, the vault and the replay console and
   nothing else, so these labels render as inert chrome rather than links: the
   nav keeps its shape and its rhythm, and no click lands on a 404. They become
   links again the day the pages behind them exist. */
const INERT = ["Portfolio", "Ecosystem", "Stack", "Risk management", "Docs", "Blog"];

// Standalone-kit fix: wallet-free build. The original used RainbowKit's
// ConnectButton.Custom render-prop (open connect/account/chain modals); there
// is no wallet gating anywhere in this POC, so this is a static, inert pill
// that preserves the nav's layout without any wagmi/RainbowKit dependency.
function NavWallet() {
  return (
    <button type="button" className="btn btn--orange" disabled>
      Connect wallet
    </button>
  );
}

export function SiteNav() {
  const [open, setOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  /* "/" on build.priime.finance, "/build" everywhere else. */
  const buildHref = useBuildHref();

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    let last = window.scrollY || 0;
    let ticking = false;
    const upd = () => {
      const y = window.scrollY || 0;
      if (y < 44) nav.classList.remove("nav--shrink");
      else if (y > last + 4) nav.classList.add("nav--shrink");
      else if (y < last - 4) nav.classList.remove("nav--shrink");
      last = y;
      ticking = false;
    };
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(upd);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    upd();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      {/* refraction filter for the glass (lensing at the edges) */}
      <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: "absolute", width: 0, height: 0 }}>
        <defs>
          <filter id="lgDistort" x="-30%" y="-30%" width="160%" height="160%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.009 0.016" numOctaves={2} seed={13} result="n" />
            <feGaussianBlur in="n" stdDeviation={2.4} result="nb" />
            <feDisplacementMap in="SourceGraphic" in2="nb" scale={22} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>

      <nav ref={navRef} className={`nav${open ? " nav-open" : ""}`}>
        <div className="wrap">
          <a className="brand" href={SITE} aria-label="Priime">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="brand-logo" src="/brand/priime-logo-lightbg.png" alt="Priime" />
          </a>

          <div className="nav-links">
            <a className="link link--create" href={buildHref}>
              Create vault
            </a>
            {APP_LINKS.map((l) => (
              <a key={l.href} className="link" href={l.href}>
                {l.t}
              </a>
            ))}
            {INERT.map((t) => (
              <span key={t} className="link link--inert" aria-disabled="true">
                {t}
              </span>
            ))}
            <NavWallet />
          </div>

          <button
            className="nav-burger"
            aria-label="Open menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <span /><span /><span />
          </button>

          <div className="nav-mobile">
            <a href={buildHref} onClick={() => setOpen(false)}>
              Create vault
            </a>
            {APP_LINKS.map((l) => (
              <a key={l.href} href={l.href} onClick={() => setOpen(false)}>
                {l.t}
              </a>
            ))}
            {INERT.map((t) => (
              <span key={t} className="link--inert" aria-disabled="true">
                {t}
              </span>
            ))}
            <div style={{ marginTop: 14 }}>
              <NavWallet />
            </div>
          </div>
        </div>
      </nav>
    </>
  );
}
