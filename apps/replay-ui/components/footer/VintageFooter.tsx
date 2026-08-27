/**
 * VintageFooter — the canonical Priime footer.
 *
 * Blue-black band (the landing's gradient) with the Priime logo, the brand
 * tagline, a copyright line with legal links back to the main site, and the
 * risk-disclaimer paragraph. Kept as the `VintageFooter` export so the root
 * layout import is unchanged.
 */

import type { CSSProperties } from "react";

const LEGAL = [
  { href: "https://priime.finance/terms", label: "Terms" },
  { href: "https://priime.finance/privacy", label: "Privacy" },
  { href: "https://priime.finance/disclaimers", label: "Disclaimers" },
];

const LINK_STYLE: CSSProperties = {
  color: "inherit",
  textDecoration: "none",
  marginLeft: 16,
  borderBottom: "1px solid rgba(255,255,255,.25)",
  paddingBottom: 1,
};

export function VintageFooter() {
  return (
    <footer
      style={{
        background: "linear-gradient(180deg,#04071C 0%,#020310 30%,#030517 100%)",
        color: "rgba(245,242,235,.55)",
        padding: "56px 32px",
        borderTop: "3px solid transparent",
        borderImage: "linear-gradient(180deg,#1B2FEE 0%,#2B5CFF 45%,#56A8FF 100%) 1",
      }}
    >
      <div
        style={{
          maxWidth: 1320,
          margin: "0 auto",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: 20,
        }}
      >
        {/* LEFT — logo + tagline */}
        <div>
          <a href="https://priime.finance" style={{ display: "block" }}>
            <img
              src="/brand/priime-logo-darkbg.png"
              alt="Priime"
              style={{ height: 30, width: "auto", display: "block" }}
            />
          </a>
          <div
            style={{
              fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
              fontSize: 12,
              marginTop: 11,
              color: "#8B94C4",
            }}
          >
            DeFi. Automated and verifiable.
          </div>
        </div>

        {/* RIGHT — copyright + legal links */}
        <div
          style={{
            fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
            fontSize: 11,
            letterSpacing: "0.03em",
            color: "rgba(245,242,235,.55)",
          }}
        >
          © 2026 Priime · Built on verifiable compute
          {LEGAL.map((l) => (
            <a key={l.href} href={l.href} style={LINK_STYLE}>
              {l.label}
            </a>
          ))}
        </div>

        {/* FULL WIDTH — risk disclaimer */}
        <div
          style={{
            flexBasis: "100%",
            fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
            fontSize: 10.5,
            lineHeight: 1.7,
            color: "rgba(255,255,255,.38)",
            marginTop: 14,
            maxWidth: 880,
          }}
        >
          This website describes non-custodial software. It is a marketing
          communication, not financial, investment, or legal advice, and not an
          offer of any security or financial product. Using on-chain protocols
          carries risk, including the risk of total loss. Outcomes depend on
          market conditions and on user and partner decisions.
        </div>
      </div>
    </footer>
  );
}
