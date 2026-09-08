import type { Metadata } from "next";

import { LiveVaultDetail } from "@/components/vaults/LiveVaultDetail";

import "../../vault.css";
import "../../canvas.css";

export const metadata: Metadata = {
  title: "Priime, live loop",
  description: "Live loop deployed through the loop server: attested strikes from the running WAVS pipeline.",
};

/**
 * `/vault/live/[id]` — one live loop's page, driven off the loop server.
 * Deliberately separate from `/vault/[slug]` (the hero surface), so the
 * canvas-shaped hero card keeps its captured-journal narrative and the live
 * loops render alongside without needing a design pass.
 */
export default async function LiveVaultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="vlt">
      <LiveVaultDetail id={id} />
    </div>
  );
}
