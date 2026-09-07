/**
 * Vaults layout: the vault register styles and the verification board's
 * chrome. Fonts are the root layout's (Geist, Plex Mono, Hanken, Fraunces as
 * variables on <html>, docs/plans/LATEST_UI_PORT_SPEC.md A.3 #33), so this
 * layout imports CSS only and never a font link.
 */

import "./vaults.css";
import "./canvas.css";

export default function VaultsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
