/* Ported from build.priime.finance eb6d33a (docs/plans/LATEST_UI_PORT_SPEC.md WP4). */
import type { Metadata } from "next";
import LiveLoopDetail from "@/components/vaults/LiveLoopDetail";
import VaultDetail from "@/components/vaults/VaultDetail";
import { isLiveLoopSlug } from "@/lib/vaults/live-id";
import { SEED_VAULTS } from "@/lib/vaults/seeds";

/* Seed vaults get their real name in the tab; user-published vaults live in
   localStorage only (the server cannot see them), so unknown slugs keep the
   generic title and VaultDetail renders its own not-found state client-side.
   A DEPLOYED loop's name lives on loop-server, which this render could reach
   but deliberately does not: the page itself is a client fetch that degrades
   on a 502, and a metadata call that threw would 500 the whole route for the
   one failure mode the page is built to survive. The tab gets the register
   instead, and the <h1> carries the name once the payload lands. */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  if (isLiveLoopSlug(slug)) {
    return {
      title: "Deployed loop, Priime",
      description: "A loop deployed through loop-server. Every value is attested or a stored deploy field.",
      robots: { index: false },
    };
  }
  const seed = SEED_VAULTS.find((v) => v.slug === slug);
  return {
    title: seed ? `${seed.name}, Priime` : "Vault, Priime",
    description: "All performance numbers are modeled. NAV and share value are attested off the journal.",
    robots: { index: false },
  };
}

/**
 * THE BRANCH BETWEEN THE TWO REGISTERS, taken here rather than inside
 * `VaultDetail` (integration Lane C).
 *
 * `isLiveLoopSlug` is the one owner of the test (`lib/vaults/live-id.ts`);
 * this route only obeys it. Branching in the server component and returning
 * two DIFFERENT component types is deliberate: React remounts across a type
 * change, so navigating from `/vaults/verifiable-usde-loop` to
 * `/vaults/loop-a1b2c3d4` cannot leave one component's hooks holding the
 * other's state. An early return inside a single component would have made
 * the hook count depend on a prop.
 */
export default async function VaultPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (isLiveLoopSlug(slug)) return <LiveLoopDetail id={slug} />;
  return <VaultDetail slug={slug} />;
}
