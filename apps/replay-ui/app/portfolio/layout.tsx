/**
 * Portfolio layout: the same register as /vaults. Fonts are the root
 * layout's; this imports the stylesheet only.
 */

import "../vaults/vaults.css";

export default function PortfolioLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
