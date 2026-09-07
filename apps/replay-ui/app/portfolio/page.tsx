/* Ported from build.priime.finance eb6d33a (docs/plans/LATEST_UI_PORT_SPEC.md WP4). */
import type { Metadata } from "next";
import PortfolioView from "@/components/vaults/PortfolioView";

export const metadata: Metadata = {
  title: "Portfolio, Priime",
  description: "All performance numbers are modeled. NAV and share value are attested off the journal.",
  robots: { index: false },
};

export default function PortfolioPage() {
  return <PortfolioView />;
}
