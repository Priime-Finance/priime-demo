/**
 * THE ONE OWNER of how a live loop is addressed on the vault page.
 *
 * A vault page is `/vaults/[slug]`, and that slug now names one of three
 * things: a seed vault (`lib/vaults/seeds.ts`), a record the composer
 * published into localStorage (`lib/vaults/store.ts`), or a loop the
 * loop-server actually deployed on chain.
 *
 * The third needs no prefix. loop-server mints its ids as
 * `loop-<8 hex>` (`packages/loop-deploy/src/deployer.ts`, from
 * `crypto.randomUUID().slice(0, 8)`), which is already slug-shaped and
 * already distinct from every seed slug in the build. So a live loop is
 * reachable at `/vaults/loop-a1b2c3d4` with no translation layer, exactly
 * the way the composer's `candidateId` needs none between the canvas and
 * the market catalog.
 *
 * This module is the seam between two lanes and deliberately holds nothing
 * else: `PublishFlow` writes the destination (`liveLoopHref`) and
 * `VaultDetail` reads it (`isLiveLoopSlug`). Neither spells the pattern
 * itself, so the two cannot drift apart.
 */

/**
 * loop-server's id shape. Anchored on both ends: a seed slug that merely
 * contains the word "loop" (`verifiable-usde-loop`) must not match.
 */
const LIVE_LOOP_ID = /^loop-[0-9a-f]{8}$/;

/** True when `/vaults/[slug]` should resolve against loop-server, not the store. */
export function isLiveLoopSlug(slug: string): boolean {
  return LIVE_LOOP_ID.test(slug);
}

/** Where a real publish sends the builder once loop-server returns an id. */
export function liveLoopHref(loopId: string): string {
  return `/vaults/${loopId}`;
}
