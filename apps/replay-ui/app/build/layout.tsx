/**
 * Build-canvas layout: loads the landing hardware-module fonts exactly as
 * priime/site/index.html does (DESIGN_HWMOD_SPEC §1A) — Hanken Grotesk for
 * nameplates, IBM Plex Mono for data — plus Fraunces, the brand's
 * serif-italic annotation face (founder pass 2026-08-20). React hoists the
 * link tags into <head>; `precedence` keeps the stylesheet deduped.
 */

export default function BuildLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        rel="stylesheet"
        precedence="default"
        href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&family=Fraunces:ital,opsz,wght@0,9..144,400..600;1,9..144,400..600&display=swap"
      />
      {children}
    </>
  );
}
