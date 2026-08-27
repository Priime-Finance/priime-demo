import type { Metadata } from "next";

import { VaultDirectory } from "@/components/vaults/VaultDirectory";

import "./vault.css";
import "./directory.css";

export const metadata: Metadata = {
  title: "Priime, vaults",
  description: "Every vault composed and published with Priime Build.",
};

/**
 * `/vault` — the Vaults directory. One card today (the desk's own vault, per
 * the demo spec); clicking it opens the vault's own page at `/vault/[slug]`,
 * where the operator canvas is the hero. The published envelope lives in
 * localStorage, so the card resolves client-side over the standing record.
 */
export default function VaultsDirectoryPage() {
  return (
    <div className="vlt">
      <VaultDirectory />
    </div>
  );
}
