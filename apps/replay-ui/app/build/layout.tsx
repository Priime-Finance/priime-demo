/**
 * Build-canvas layout: loads the landing hardware-module fonts exactly as
 * priime/site/index.html does (DESIGN_HWMOD_SPEC §1A) — Hanken Grotesk for
 * nameplates, IBM Plex Mono for data — plus Fraunces, the brand's
 * serif-italic annotation face (founder pass 2026-08-20).
 *
 * Self-hosted via next/font/google (same pattern as app/layout.tsx): the
 * faces are fetched at build time and served from this app's own origin, so
 * nothing here contacts fonts.googleapis.com or fonts.gstatic.com at
 * runtime and the demo renders correctly with no network. The weights and
 * axes match what the old <link> requested: Hanken Grotesk 400-800, IBM
 * Plex Mono 400-600, Fraunces variable with the opsz axis in both styles.
 *
 * next/font emits hashed family names, so the kit's tokens (--fs / --fm in
 * app/build/hm.css, --fser in app/build/build.css) point at these CSS
 * variables rather than naming the families literally. The wrapper is
 * display:contents so it carries the variables without adding a box.
 */

import { Fraunces, Hanken_Grotesk, IBM_Plex_Mono } from "next/font/google";

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-hanken",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
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

export default function BuildLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`${hanken.variable} ${plexMono.variable} ${fraunces.variable}`}
      style={{ display: "contents" }}
    >
      {children}
    </div>
  );
}
