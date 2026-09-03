import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SiteNav } from "@/components/nav/SiteNav";
import { VintageFooter } from "@/components/footer/VintageFooter";
import "./globals.css";

// Font system mirrors Linear's (linear.app). Linear pairs Inter Variable
// for everything sans (body + display + UI) with Berkeley Mono for
// monospace. Berkeley Mono is a paid commercial license we can't
// redistribute, so we substitute Geist Mono — a free geometric monospace
// that hits the same visual register.
// Priime uses Geist (sans) + Geist Mono. Inter itself is not loaded: it never
// rendered (Geist always resolves ahead of it), so it was dead preloads.
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

export const metadata: Metadata = {
  title: "Priime, vaults composed and verifiable.",
  description:
    "One vault, a USDe/USDC leveraged loop on Morpho Blue. Three independent operators re-execute its NAV and a quorum attests it on chain: the vault that cannot lie about its NAV.",
  metadataBase: new URL("https://loop.priime.finance"),
};

// Phase I (2026-05-12) — explicit viewport for mobile rendering. Without
// this Next.js falls back to its default which excludes `viewportFit: cover`
// and can mis-handle iOS Safari notch / dynamic-island insets. Pinning the
// initial scale + width-device-width also prevents the rare zoomed-out
// first paint on Android Chrome when the page content is wider than
// expected (was a real risk before the dashboard table overflow fixes).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f4f3f1",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        {/* A11y fix 2026-05-01: skip-link for keyboard / screen-reader users
            to bypass the global Nav and land directly on page content.
            WCAG 2.4.1 Bypass Blocks. */}
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
      </body>
    </html>
  );
}
