/**
 * Vault-surface layout: loads the three faces the same way the build canvas
 * does (app/build/layout.tsx) — Hanken Grotesk for display and chrome,
 * IBM Plex Mono for every number, Fraunces for the serif-italic kickers and
 * footnotes.
 *
 * Self-hosted via next/font/google: fetched at build time and served from
 * this app's own origin, so the vault surfaces never call out to Google
 * Fonts at runtime. Weights and axes match what the old <link> requested.
 *
 * next/font emits hashed family names, so vault.css points --vs / --vm /
 * --vser at these CSS variables instead of naming the families literally.
 * The wrapper is display:contents so it carries the variables to both the
 * /vault directory and /vault/[slug] without adding a box.
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

export default function VaultLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`${hanken.variable} ${plexMono.variable} ${fraunces.variable}`}
      style={{ display: "contents" }}
    >
      {children}
    </div>
  );
}
