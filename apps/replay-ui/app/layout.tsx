import "./globals.css";

import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Priime — The Vault That Cannot Lie",
  description:
    "Replay UI for the verifiable-vault demo: NAV-strike journals replayed beautifully. Nothing simulated is deep-linked to an explorer.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The default register, not the system preference: the light chassis is a
  // stored presenter choice, which a static <meta> cannot track.
  themeColor: "#0B0B0B",
};

/**
 * Pre-paint register restore. Runs synchronously as the first thing in
 * <body>, before any console markup is parsed, so a presenter who chose the
 * light chassis never sees a black flash on reload. Absence of the attribute
 * is the dark register, which is why nothing is written for "dark".
 *
 * `?theme=light|dark` overrides the stored choice for one page load. It is a
 * headless-driving hook (screenshots of both registers), invisible to a
 * presenter, and it deliberately does not write to localStorage.
 *
 * Keep the storage key in sync with THEME_STORAGE_KEY in
 * components/ThemeToggle.tsx.
 */
const THEME_BOOT = `try{var q=new URLSearchParams(location.search).get("theme");var t=q==="light"||q==="dark"?q:localStorage.getItem("priime.replay-ui.theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        {children}
      </body>
    </html>
  );
}
