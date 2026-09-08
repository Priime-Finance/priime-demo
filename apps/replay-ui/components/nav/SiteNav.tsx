"use client";
/* Tier-1 site nav: the priime.finance floating liquid-glass pill, ported to the
   loop app so loop.priime.finance carries the full-site navigation + brand.
   The product (Dashboard / Strategy / Deposit) navigation lives in the
   separate <ProductTabs> tier.

   Nav v2 (2026-08-21):
   - Portfolio is connected-only. SSR and the first client render never show
     it (mounted gate, same pattern as the portfolio funnel); after mount it
     appears iff wagmi reports a connection, entering once with a small
     reveal + underglow bloom (reduced-motion lands it instantly). The
     /portfolio ROUTE stays reachable directly, only the nav item is gated.
   - About is a dropdown (Stack, Risk management). Hover-intent on mouse
     (open on enter, ~150ms leave delay), click-toggle for touch, focus
     opens for keyboard, Esc closes and returns focus to the trigger. On
     mobile it flattens to a Fraunces-italic group label with the two links
     indented beneath.

   Nav v2.1 (founder addendum, same day): Create vault IS the CTA, the
   primary blue pill in the right-end slot where the connect pill used to sit
   (host-aware href kept). The connect pill left the nav entirely; the connect
   moment now lives inside the publish workflow (PublishFlow's Review card).
   The quiet Create-vault chip is gone from the links row. */

/* eslint-disable @typescript-eslint/no-floating-promises, @typescript-eslint/no-unnecessary-type-assertion --
 * Kit-verbatim file, ported from build.priime.finance eb6d33a. Two edits only:
 * the wallet hook import (wagmi -> @/lib/wallet) and the logo path; not
 * rewriting kit logic to satisfy lint, per the integration's own directive.
 * The banner names only the rules this file trips: ESLint 9 reports every
 * unused disable directive as a warning, and the gate allows one. */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useConnectModal, useDisconnect, shortAddress } from "@/lib/wallet";
import { useBuildHref } from "@/lib/host";

const SITE = "https://priime.finance";
const THEME_KEY = "priime_theme";

/* startViewTransition is not in the DOM lib this project builds against. */
type VTDocument = Document & {
  startViewTransition?: (cb: () => void) => { finished: Promise<void> };
};

/* The 14px ring with its right half filled. ONE shape, no icon swap: rotating
   a half-filled disc 180deg moves the fill to the other side, so the
   animation IS the state readout. The rotation is pure CSS keyed on
   [data-theme] (globals.css), which is what makes the RESTING state correct
   on the first painted frame with zero JS.

   A sun/moon pair was rejected: generic, and a pair has to cross-fade, which
   at 14px is mush. */
function ThemeGlyph({ mobile = false }: { mobile?: boolean }) {
  return (
    <svg
      className={mobile ? "theme-glyph theme-glyph--m" : "theme-glyph"}
      viewBox="0 0 14 14"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="7" cy="7" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <path d="M7 .75a6.25 6.25 0 0 1 0 12.5z" fill="currentColor" />
    </svg>
  );
}

const ABOUT_LINKS = [
  { t: "Stack", href: `${SITE}/stack` },
  { t: "Risk management", href: `${SITE}/risk` },
];
/* Tail of the canonical set, after Ecosystem + About. */
const TAIL_LINKS = [
  { t: "Docs", href: `${SITE}/docs` },
  { t: "Blog", href: `${SITE}/blog` },
];

export function SiteNav() {
  const [open, setOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  /* "/" on build.priime.finance, "/build" everywhere else. */
  const buildHref = useBuildHref();

  /* DL-10: the active tab is DERIVED FROM THE URL, never from a click.
     `usePathname` re-resolves on every navigation the router sees, popstate
     included, and a full-load or bfcache Back lands on a document whose own
     pathname is already right, so backing out of /vaults can never leave the
     Vaults tab lit on the canvas. Only the two in-app destinations can be
     current; the external priime.finance links never light. Both hosts render
     the canvas at a path this matcher ignores ("/build" server-side, "/" in
     the browser on build.priime.finance), so SSR and hydration agree there. */
  const pathname = usePathname();
  const here = (href: string) =>
    pathname === href || pathname?.startsWith(`${href}/`) === true;

  /* Connected-only Portfolio: hidden during SSR + first client render, then
     revealed post-mount when wagmi says connected (hydration-safe). */
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { disconnect } = useDisconnect();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const showPortfolio = mounted && isConnected;

  /* About dropdown: hover-intent (mouse only), click-toggle, focus-within,
     Esc-to-close with focus return. */
  const [aboutOpen, setAboutOpen] = useState(false);
  const aboutRef = useRef<HTMLDivElement>(null);
  const aboutTriggerRef = useRef<HTMLButtonElement>(null);
  const aboutCloseTimer = useRef<number | null>(null);
  const cancelAboutClose = useCallback(() => {
    if (aboutCloseTimer.current !== null) {
      window.clearTimeout(aboutCloseTimer.current);
      aboutCloseTimer.current = null;
    }
  }, []);
  const openAbout = useCallback(() => {
    cancelAboutClose();
    setAboutOpen(true);
  }, [cancelAboutClose]);
  const scheduleAboutClose = useCallback(() => {
    cancelAboutClose();
    aboutCloseTimer.current = window.setTimeout(() => {
      aboutCloseTimer.current = null;
      setAboutOpen(false);
    }, 150);
  }, [cancelAboutClose]);
  useEffect(() => cancelAboutClose, [cancelAboutClose]);

  /* ── APPEARANCE ────────────────────────────────────────────────────────
     THEME DOES NOT LIVE IN REACT. It is a data-theme attribute on <html>,
     stamped before paint by the inline script in app/layout.tsx and written
     imperatively here. React never re-renders on it and must never key on it:
     keying would remount the subtree and replay every entrance animation in
     the app at once, which is a full-page cascade fired by a preference
     change and will read as a bug because it is one.

     THREE STATES IN THE MODEL, TWO POSITIONS IN THE CONTROL. light / dark /
     system. System is a state you can BE in, never a state you click INTO
     from the pill: the first click writes an explicit preference opposite to
     whatever is currently RESOLVED, and from then on the OS is ignored. That
     avoids the three-click cycle trap where pressing twice lands the user in
     a third state they did not ask for and cannot name. The path back to
     system is a footer preference line, not this control. */
  const themeStatusRef = useRef<HTMLSpanElement>(null);

  /* aria-label names the DESTINATION, not the current state, and is rewritten
     on every flip. Written imperatively rather than rendered from state, so
     the server can emit the light-default label without a hydration mismatch
     and without React owning the theme. `aria-pressed` is deliberately
     ABSENT: it asserts a binary on/off of one named thing, and a control
     reporting "not pressed" while the resolved appearance is dark-via-OS is
     actively misleading. No `title` either: a native tooltip on a nav
     control is chrome noise that fires on every accidental hover. */
  const syncThemeLabel = useCallback(() => {
    const resolved =
      document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    const destination = resolved === "dark" ? "light" : "dark";
    const label = `Switch to ${destination} appearance`;
    document
      .querySelectorAll("[data-theme-toggle]")
      .forEach((b) => b.setAttribute("aria-label", label));
  }, []);

  const applyTheme = useCallback(
    (next: "light" | "dark", source: string) => {
      const root = document.documentElement;
      const apply = () => {
        root.setAttribute("data-theme", next);
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute("content", next === "dark" ? "#04060F" : "#F5F2EB");
        syncThemeLabel();
        /* The live region is a SEPARATE node from the button, because the
           button holds focus at the moment of the flip and mutating the label
           of a focused element already announces; a live region on the same
           node double-announces. */
        if (themeStatusRef.current) {
          themeStatusRef.current.textContent =
            (next === "dark" ? "Dark" : "Light") + " appearance";
        }
        document.dispatchEvent(
          new CustomEvent("priime:themechange", { detail: { theme: next, source } }),
        );
      };

      /* ONE GPU-composited crossfade, 180ms, feature-checked, with a plain
         fallback. No CSS colour transition on the ground: backdrop-filter is
         used heavily here and a colour transition forces every blur layer to
         re-sample per frame.
         The reduced-motion query is read LIVE at click time and never cached,
         because a user who changes that setting mid-session has usually just
         been made uncomfortable by something.
         The busy guard is not optional: mashing the toggle otherwise queues
         crossfades and the page appears to lag behind the clicks. */
      const w = window as Window & { __pThemeBusy?: number };
      const doc = document as VTDocument;
      const reduce =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce || typeof doc.startViewTransition !== "function" || w.__pThemeBusy) {
        apply();
        return;
      }
      w.__pThemeBusy = 1;
      doc.startViewTransition(apply).finished.finally(() => {
        w.__pThemeBusy = 0;
      });
    },
    [syncThemeLabel],
  );

  const toggleTheme = useCallback(() => {
    const root = document.documentElement;
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    /* Cookie on the PARENT domain so priime.finance, build. and loop. share
       one preference. NOT HttpOnly: the pre-paint script has to read it
       synchronously. The host-only duplicate is what keeps localhost and
       preview deploys working, where the .priime.finance domain will not
       match. localStorage is a same-origin MIRROR only, read as a fallback
       when cookies are blocked. */
    try {
      document.cookie = `${THEME_KEY}=${next};Domain=.priime.finance;Path=/;Max-Age=31536000;SameSite=Lax;Secure`;
      document.cookie = `${THEME_KEY}=${next};Path=/;Max-Age=31536000;SameSite=Lax`;
    } catch {
      /* cookies blocked, localStorage below still carries the preference */
    }
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* storage blocked, the cookie above still carries the preference */
    }
    root.removeAttribute("data-theme-auto");
    applyTheme(next, "pill");
  }, [applyTheme]);

  useEffect(() => {
    syncThemeLabel();
    /* Anyone still in system mode re-themes LIVE, without a reload. The
       data-theme-auto marker is what distinguishes "resolved from the OS"
       from "chosen", so this stops the moment a preference is written. */
    if (typeof window.matchMedia !== "function") return;
    const q = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => {
      if (!document.documentElement.hasAttribute("data-theme-auto")) return;
      applyTheme(e.matches ? "dark" : "light", "system");
    };
    q.addEventListener("change", onChange);
    return () => q.removeEventListener("change", onChange);
  }, [applyTheme, syncThemeLabel]);

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
            <Link
              className={`link${here("/vaults") ? " active" : ""}`}
              aria-current={here("/vaults") ? "page" : undefined}
              href="/vaults"
            >
              Vaults
            </Link>
            {showPortfolio && (
              <Link
                className={`link link--reveal${here("/portfolio") ? " active" : ""}`}
                aria-current={here("/portfolio") ? "page" : undefined}
                href="/portfolio"
              >
                Portfolio
              </Link>
            )}
            <a className="link" href={`${SITE}/ecosystem`}>
              Ecosystem
            </a>
            <div
              ref={aboutRef}
              className={`nav-about${aboutOpen ? " open" : ""}`}
              onPointerEnter={(e) => {
                if (e.pointerType === "mouse") openAbout();
              }}
              onPointerLeave={(e) => {
                if (e.pointerType === "mouse") scheduleAboutClose();
              }}
              onFocus={openAbout}
              onBlur={(e) => {
                if (!aboutRef.current?.contains(e.relatedTarget as Node | null)) {
                  cancelAboutClose();
                  setAboutOpen(false);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape" && aboutOpen) {
                  e.stopPropagation();
                  cancelAboutClose();
                  setAboutOpen(false);
                  aboutTriggerRef.current?.focus();
                }
              }}
            >
              <button
                ref={aboutTriggerRef}
                type="button"
                className="link nav-about-trigger"
                aria-haspopup="menu"
                aria-expanded={aboutOpen}
                onClick={() => {
                  cancelAboutClose();
                  setAboutOpen((v) => !v);
                }}
              >
                About
                <svg className="nav-about-caret" width="9" height="6" viewBox="0 0 9 6" aria-hidden="true" focusable="false">
                  <path d="M1 1l3.5 3.5L8 1" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {/* Wrapper = positioning + a transparent 8px hover apron
                  (padding-top) spanning the card's FULL width, flush against
                  the container's bottom edge. The pointer therefore never
                  leaves the .nav-about subtree between trigger and card, on
                  any diagonal: hover continuity is structural, not
                  timer-dependent. The card inside carries the visuals. */}
              <div className="nav-about-menu">
                <div className="nav-about-card" role="menu" aria-label="About">
                  {ABOUT_LINKS.map((l) => (
                    <a key={l.href} role="menuitem" href={l.href}>
                      {l.t}
                    </a>
                  ))}
                </div>
              </div>
            </div>
            {TAIL_LINKS.map((l) => (
              <a key={l.href} className="link" href={l.href}>
                {l.t}
              </a>
            ))}
            {/* Last item in the links row, immediately before the CTA. The
                server renders the light-default label; syncThemeLabel()
                corrects it on mount for a dark-resolved visitor. */}
            <button
              type="button"
              className="theme-toggle"
              data-theme-toggle
              aria-label="Switch to dark appearance"
              onClick={toggleTheme}
            >
              <ThemeGlyph />
            </button>
            {/* The wallet slot Antoni reserved for the live connect key
                (PR #15: "the nav slot is SiteNav's right cluster"). Hidden
                until mounted for the same reason Portfolio is: the server
                render cannot know the wallet and a pill that pops from
                Connect to an address on hydration reads as a glitch. */}
            {mounted ? (
              isConnected && address !== undefined ? (
                <button
                  type="button"
                  className="nav-wallet nav-wallet--on"
                  onClick={() => disconnect()}
                  title="Disconnect"
                >
                  {shortAddress(address)}
                </button>
              ) : (
                <button type="button" className="nav-wallet" onClick={openConnectModal}>
                  Connect
                </button>
              )
            ) : null}
            <a className="btn btn--orange" href={buildHref}>
              Create vault
            </a>
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
            <Link href="/vaults" aria-current={here("/vaults") ? "page" : undefined} onClick={() => setOpen(false)}>
              Vaults
            </Link>
            {showPortfolio && (
              <Link href="/portfolio" aria-current={here("/portfolio") ? "page" : undefined} onClick={() => setOpen(false)}>
                Portfolio
              </Link>
            )}
            <a href={`${SITE}/ecosystem`} onClick={() => setOpen(false)}>
              Ecosystem
            </a>
            <div className="nav-mobile-group">
              <span className="nav-mobile-kicker" aria-hidden="true">
                About
              </span>
              {ABOUT_LINKS.map((l) => (
                <a key={l.href} className="nav-mobile-sub" href={l.href} onClick={() => setOpen(false)}>
                  {l.t}
                </a>
              ))}
            </div>
            {TAIL_LINKS.map((l) => (
              <a key={l.href} href={l.href} onClick={() => setOpen(false)}>
                {l.t}
              </a>
            ))}
            {/* The mobile copy carries a LABEL and the resolved state word.
                Icon-only is defensible in a dense desktop pill; in a
                full-width sheet with labelled rows above it, an unlabelled
                glyph is an orphan. It also takes its OWN
                view-transition-name (theme-glyph-m, via .theme-glyph--m):
                both copies are rendered at every width, and a duplicate name
                among rendered elements aborts the view transition silently,
                turning the flip into an instant cut with no warning. */}
            <button
              type="button"
              className="nvm-theme"
              data-theme-toggle
              aria-label="Switch to dark appearance"
              onClick={toggleTheme}
            >
              <span>Appearance</span>
              <span className="nvm-theme-v">
                <ThemeGlyph mobile />
                <b className="tw tw-l">Light</b>
                <b className="tw tw-d">Dark</b>
              </span>
            </button>
            <div style={{ marginTop: 14 }}>
              <a className="btn btn--orange" href={buildHref} onClick={() => setOpen(false)}>
                Create vault
              </a>
            </div>
          </div>
        </div>
        {/* Outside .wrap on purpose. Inside .nav-links it would sit in a
            display:none container under 900px, and a live region inside
            display:none is never announced, which would make the MOBILE
            toggle the silent one. */}
        <span ref={themeStatusRef} className="theme-status" role="status" aria-live="polite" />
      </nav>
    </>
  );
}
