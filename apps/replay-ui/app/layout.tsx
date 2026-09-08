import type { Metadata, Viewport } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import { SiteNav } from "@/components/nav/SiteNav";
import { VintageFooter } from "@/components/footer/VintageFooter";
import { Providers } from "@/components/Providers";
import { WalletSheet } from "@/components/wallet/WalletSheet";
import "./globals.css";

/* ────────────────────────────────────────────────────────────────────────────
   FONTS: THE ROOT LAYOUT OWNS EVERY FACE (docs/plans/LATEST_UI_PORT_SPEC.md
   A.3 #33). Three next/font faces, self-hosted at build time, exposed as CSS
   variables on <html>. Route layouts import CSS only; every literal family
   name in the ported CSS is remapped to one of these variables, so nothing on
   the property contacts fonts.googleapis.com at runtime (the network
   dependency PR #12 removed stays removed).

   Three faces, one job each. Geist is the app's only sans and it carries
   every word: body, heads, labels, chips, controls, the nav pill, the build
   canvas chrome. Geist Mono is the only mono and it is used sporadically,
   for the data register alone: figures with their units, hashes, addresses,
   block numbers, timestamps, the market pair, the plate's printed ink.
   Fraunces stays italic, small, and never grows past annotation: the kicker
   above a head, the summary under a title, the footnote under a table.

   Do not add a fourth face here. A second sans or a second mono is a
   distinction the product does not make and every reader feels; a grep gate
   in tests/type-faces.test.ts fails the build if one returns, including
   through an inline style.
   ──────────────────────────────────────────────────────────────────────────── */
const geist = Geist({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-geist",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-geist-mono",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: "variable",
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--font-fraunces",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Priime, vaults composed and verifiable.",
  description:
    "One vault, a USDe/USDC leveraged loop on Morpho Blue. Three independent operators re-execute its NAV and a quorum attests it on chain: the vault that cannot lie about its NAV.",
  metadataBase: new URL("https://loop.priime.finance"),
  icons: { icon: "/favicon.svg" },
};

/* Explicit viewport for mobile rendering. Without it Next falls back to a
   default that excludes `viewportFit: cover` and can mis-handle iOS Safari
   notch and dynamic-island insets. Pinning the initial scale and
   width=device-width also prevents the rare zoomed-out first paint on Android
   Chrome when page content is wider than expected. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  /* HELIOS: the light ground is #F5F2EB. A single value rather than a
     prefers-color-scheme pair on purpose: dark is resolved by the pre-paint
     script below, not by the OS media query alone, so an OS-keyed pair would
     tint the browser chrome navy for a dark-OS visitor who is sitting in
     light. The script re-stamps it instead. */
  themeColor: "#F5F2EB",
  /* Tells the browser this document has both registers, so it stops painting
     a white canvas, white scrollbars and light form controls in the window
     between navigation and CSS. That window opens before any script exists,
     so no amount of JS closes it. The `color-scheme` CSS property on :root
     (tokens.css) is what actually picks the register. */
  colorScheme: "light dark",
};

/* ────────────────────────────────────────────────────────────────────────────
   THE PRE-PAINT SCRIPT (pretheme-v5), verbatim from build.priime.finance.
   ----------------------------------------------------------------------------
   Byte-for-byte the resolution order that priime.finance ships, so a visitor
   crossing from the static site to build. or loop. cannot see the ground
   change:  cookie -> localStorage -> matchMedia.  Never the reverse; the
   cookie is the cross-origin carrier (Domain=.priime.finance, readable by all
   three hosts) and it must win.

   INLINE, NON-ASYNC, NON-DEFER, NON-MODULE, AND IN THE HEAD. Blocking means
   the parser stops, runs this, and only then reaches the stylesheets. No
   paint can occur first because no stylesheet has been parsed. A useEffect
   runs AFTER paint and the page flashes: that is the whole reason this is
   not a useEffect.

   `data-theme-auto` marks "resolved from the OS, not chosen", which is what
   lets the live matchMedia listener keep re-theming a visitor who never
   picked, and stop the moment they do.

   KILL SWITCH WITHOUT A REDEPLOY: the script bails if <html> carries
   data-theme-off.
   ──────────────────────────────────────────────────────────────────────────── */
const PRETHEME = `/*pretheme-v5*/!function(){try{var d=document.documentElement;if(d.hasAttribute("data-theme-off"))return;var m=document.cookie.match(/(?:^|;\\s*)priime_theme=(light|dark)/),t=m&&m[1];if(!t){try{t=localStorage.getItem("priime_theme")}catch(e){}}if(t!=="light"&&t!=="dark"){t=window.matchMedia&&matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";d.setAttribute("data-theme-auto","")}else{d.removeAttribute("data-theme-auto")}d.setAttribute("data-theme",t);var c=function(){var n=document.querySelector('meta[name="theme-color"]');if(n){n.setAttribute("content",t==="dark"?"#04060F":"#F5F2EB")}};if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",c)}else{c()}}catch(e){}}()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${geistMono.variable} ${fraunces.variable}`}
      /* The script above stamps data-theme on <html> before React hydrates,
         so the server markup and the client DOM legitimately differ by that
         one attribute. Theme is NOT React state: it is an attribute written
         imperatively, never threaded through a provider and never used as a
         key. Keying on it would remount the subtree and replay every entrance
         animation in the app at once on a preference change. */
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: PRETHEME }} />
      </head>
      <body>
        {/* Wagmi + react-query, wrapping the whole shell so `useAccount` is
            readable from the nav, the canvas and the vault page alike. The
            mock this build shipped with is gone; `lib/wallet.ts` is now the
            adapter over the real thing. Still no AppTabs strip (hidden by
            ruling) and no BareRoute (there is no bare route here, so the
            content column is unconditional). The main class string is the
            live one. */}
        <Providers>
          {/* Skip-link for keyboard and screen-reader users to bypass the
              global nav and land directly on page content. WCAG 2.4.1. */}
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-[var(--radius)] focus:bg-stone-925 focus:border focus:border-[var(--color-honey-400)] focus:px-3 focus:py-2 focus:text-sm focus:text-stone-100"
          >
            Skip to content
          </a>
          <SiteNav />
          <main id="main-content" className="mx-auto max-w-7xl px-6 sm:px-10 lg:px-16 xl:px-20 pt-8 pb-24 space-y-8">
            {children}
          </main>
          <VintageFooter />
          {/* Mounted once, for every route: the Review card and the
              portfolio's Connect key both open it through useConnectModal(). */}
          <WalletSheet />
        </Providers>
      </body>
    </html>
  );
}
