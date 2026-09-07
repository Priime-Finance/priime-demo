/* Ported from build.priime.finance eb6d33a (docs/plans/LATEST_UI_PORT_SPEC.md WP4). */
import type { Metadata } from "next";
import VaultDetail from "@/components/vaults/VaultDetail";
import { SEED_VAULTS } from "@/lib/vaults/seeds";

/* Seed vaults get their real name in the tab; user-published vaults live in
   localStorage only (the server cannot see them), so unknown slugs keep the
   generic title and VaultDetail renders its own not-found state client-side. */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const seed = SEED_VAULTS.find((v) => v.slug === slug);
  return {
    title: seed ? `${seed.name}, Priime` : "Vault, Priime",
    description: "All performance numbers are modeled. NAV and share value are attested off the journal.",
    robots: { index: false },
  };
}

export default async function VaultPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <VaultDetail slug={slug} />;
}
