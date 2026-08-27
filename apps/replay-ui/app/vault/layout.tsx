/**
 * Vault-surface layout: loads the three faces the same way the build canvas
 * does (app/build/layout.tsx) — Hanken Grotesk for display and chrome,
 * IBM Plex Mono for every number, Fraunces for the serif-italic kickers and
 * footnotes. React hoists the link tags into <head>; `precedence` keeps the
 * stylesheet deduped with the canvas's copy.
 */

export default function VaultLayout({ children }: { children: React.ReactNode }) {
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
