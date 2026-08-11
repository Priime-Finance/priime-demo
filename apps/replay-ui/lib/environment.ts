/**
 * Demo environment sidecar: typed view of `fixtures/environment.v1.json`.
 *
 * ============================ READ THIS FIRST ============================
 * This is **presentation fixture data. It is NOT part of the frozen v1
 * journal schema** and must never be treated as attested. The journal proves
 * one strike; the demo also wants to show the surrounding operator set
 * (on-chain registry entries) and the p2p mesh (`/p2p/status` peers) that the
 * journal deliberately does not carry.
 *
 * The live backend replaces this file wholesale: registry entries come from
 * the POA registry contract, peer status from each node's `/p2p/status`.
 * Until then, values here are placeholders — the registry contract address is
 * the zero address and is flagged `contract_address_is_placeholder`.
 *
 * The one honest link between fixture and journal is
 * `componentDigestMatches`: the fixture states which component build the
 * operator set is expected to be running, and the journal states which one it
 * actually ran. A mismatch is a real signal, so it is computed, not asserted.
 * ========================================================================
 */
import type { Journal } from "@priime-demo/journal-schema";

import environmentRaw from "@/fixtures/environment.v1.json";

/** One operator as the POA registry sees it. */
export interface OperatorRegistryEntry {
  /** Operator signing address; matches `Operator.id` in the journal. */
  id: string;
  /** Short display name ("node-1"). Fixture-only; the registry has no labels. */
  label: string;
  /** Quorum weight (1 each in the equal-weight demo). */
  weight: number;
  /** Block the operator was registered at. */
  registered_block: number;
}

/** The on-chain operator registry, as shown next to a strike. */
export interface OperatorRegistryFixture {
  /** Chain the registry contract lives on. */
  chain_id: number;
  /** Registry contract address. Placeholder until the real deploy. */
  contract_address: string;
  /** True while `contract_address` is a placeholder — do not deep-link it. */
  contract_address_is_placeholder: boolean;
  /** Registered operators, in registration order. */
  operators: OperatorRegistryEntry[];
}

/** One node's view of the mesh. */
export interface PeerStatusFixture {
  /** Operator signing address this node signs with. */
  operator_id: string;
  /** libp2p peer id. */
  peer_id: string;
  /** Peer ids this node currently has a connection to. */
  connected_peers: string[];
}

/** The p2p layer, as shown in the "3 nodes talking" panel. */
export interface P2pFixture {
  /** Discovery mechanism; mDNS on the demo LAN (spec M2). */
  discovery: "mdns";
  /** One entry per node. */
  nodes: PeerStatusFixture[];
}

/** Everything in the environment sidecar. */
export interface DemoEnvironment {
  /** Loud reminder that this file is fixture data, carried in the JSON itself. */
  _fixture: string;
  /** Fixture schema version, independent of the journal `schema_version`. */
  fixture_version: string;
  /** WAVS service id this environment describes. */
  service_id: string;
  /** Component digest the operator set is expected to be running. */
  expected_component_digest: string;
  /** Operator registry view. */
  registry: OperatorRegistryFixture;
  /** p2p mesh view. */
  p2p: P2pFixture;
}

/** The loaded environment fixture. Treat as immutable. */
export const demoEnvironment = environmentRaw as DemoEnvironment;

/**
 * Whether the component the journal recorded is the one this environment
 * expects the operator set to be running.
 *
 * A `false` here means the recipe (`component_digest` + `inputs_block` +
 * `vault`) does not match the registered build — surface it, do not hide it.
 *
 * @param journal the strike to check.
 * @param environment environment fixture; defaults to `demoEnvironment`.
 * @returns true when the digests are identical (case-insensitive hex).
 */
export function componentDigestMatches(
  journal: Journal,
  environment: DemoEnvironment = demoEnvironment,
): boolean {
  return (
    journal.component_digest.toLowerCase() ===
    environment.expected_component_digest.toLowerCase()
  );
}

/**
 * Look up an operator's registry entry.
 *
 * @param operatorId operator signing address (case-insensitive).
 * @param environment environment fixture; defaults to `demoEnvironment`.
 * @returns the entry, or `null` when the operator is not registered.
 */
export function registryEntryFor(
  operatorId: string,
  environment: DemoEnvironment = demoEnvironment,
): OperatorRegistryEntry | null {
  const wanted = operatorId.toLowerCase();
  return (
    environment.registry.operators.find((op) => op.id.toLowerCase() === wanted) ?? null
  );
}

/**
 * Look up an operator's p2p status.
 *
 * @param operatorId operator signing address (case-insensitive).
 * @param environment environment fixture; defaults to `demoEnvironment`.
 * @returns the node's peer status, or `null` when unknown.
 */
export function peerStatusFor(
  operatorId: string,
  environment: DemoEnvironment = demoEnvironment,
): PeerStatusFixture | null {
  const wanted = operatorId.toLowerCase();
  return (
    environment.p2p.nodes.find((node) => node.operator_id.toLowerCase() === wanted) ??
    null
  );
}
