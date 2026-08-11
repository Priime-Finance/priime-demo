/**
 * The side rail: the two fixture-backed panels that describe the operator set
 * rather than the strike — who is registered, and who is talking to whom.
 *
 * Both carry the same fixture disclaimer, and both are the first things the
 * live backend replaces (`/p2p/status` and the POA registry contract).
 */
import { PeerPanel, type PeerNodeView } from "@/components/PeerPanel";
import { RegistryPanel, type RegistryOperatorView } from "@/components/RegistryPanel";
import { CHAIN_LABEL, FIXTURE_NOTE } from "@/lib/copy";
import { demoEnvironment } from "@/lib/environment";
import { truncateAddress } from "@/lib/format";

export interface StageRailProps {
  /** One row per node in the mesh. */
  peers: readonly PeerNodeView[];
  /** Registered operators, in registration order. */
  operators: readonly RegistryOperatorView[];
  /** Registry summary line, e.g. `"3 operators · total weight 3"`. */
  totals: string;
}

/** The peer-mesh + registry rail. */
export function StageRail({ peers, operators, totals }: StageRailProps): React.JSX.Element {
  return (
    <div className="stage__rail">
      <PeerPanel discovery="mDNS discovery" nodes={peers} disclaimer={FIXTURE_NOTE} />
      <RegistryPanel
        chainLabel={CHAIN_LABEL}
        contractAddress={truncateAddress(demoEnvironment.registry.contract_address)}
        contractAddressTitle={demoEnvironment.registry.contract_address}
        isPlaceholder={demoEnvironment.registry.contract_address_is_placeholder}
        operators={operators}
        totals={totals}
        disclaimer={FIXTURE_NOTE}
      />
    </div>
  );
}
