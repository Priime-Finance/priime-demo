import type { Metadata } from "next";

import { VaultAsset } from "@/components/vaults/VaultAsset";

import "../vault.css";
import "../canvas.css";

export const metadata: Metadata = {
  title: "Priime, the vault",
  description: "Vault overview, automations, performance, parameters and activity.",
};

/**
 * `/vault/[slug]` — one vault's own page, where the canvas's publish flow
 * lands. The operator canvas is the hero; the subpage segments sit under it
 * as tabs. There is exactly one vault in the demo, so the slug is checked
 * client-side against the resolved record (the published envelope lives in
 * localStorage and the server cannot see it); a stray slug renders a quiet
 * not-found state with a way back to the directory.
 */
export default async function VaultDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <div className="vlt">
      <VaultAsset slug={slug} />
    </div>
  );
}
