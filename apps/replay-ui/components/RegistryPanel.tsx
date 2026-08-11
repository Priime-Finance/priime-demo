/**
 * RegistryPanel — the on-chain operator registry: who is registered, at what
 * weight, and where the registry contract lives.
 *
 * Fixture data until the live backend reads the POA registry contract, and the
 * panel says so. The contract address is a placeholder in the fixture, so it is
 * flagged and never deep-linked.
 */
import { Badge } from "@/components/Badge";
import { DataList, type DataRow } from "@/components/DataList";
import { Panel } from "@/components/Panel";

export interface RegistryOperatorView {
  /** Registry label, e.g. `"node-1"`. */
  label: string;
  /** Truncated signing address. */
  address: string;
  /** Full signing address. */
  addressTitle: string;
  /** Weight line, e.g. `"Weight 1"`. */
  weight: string;
}

export interface RegistryPanelProps {
  /** Chain line, e.g. `"Base · chain 8453"`. */
  chainLabel: string;
  /** Truncated registry contract address. */
  contractAddress: string;
  /** Full registry contract address. */
  contractAddressTitle: string;
  /** True while the address is the fixture placeholder. */
  isPlaceholder: boolean;
  /** Registered operators, in registration order. */
  operators: readonly RegistryOperatorView[];
  /** Total weight line, e.g. `"3 operators · total weight 3"`. */
  totals: string;
  /** The fixture disclaimer. */
  disclaimer: string;
}

/** The registry rail panel. */
export function RegistryPanel({
  chainLabel,
  contractAddress,
  contractAddressTitle,
  isPlaceholder,
  operators,
  totals,
  disclaimer,
}: RegistryPanelProps): React.JSX.Element {
  const rows: readonly DataRow[] = [
    { key: "chain", label: "Chain", value: chainLabel },
    {
      key: "contract",
      label: "Registry",
      value: contractAddress,
      title: contractAddressTitle,
    },
    ...operators.map((operator): DataRow => ({
      key: operator.label,
      label: `${operator.label} · ${operator.weight}`,
      value: operator.address,
      title: operator.addressTitle,
    })),
    { key: "totals", label: "Set", value: totals },
  ];

  return (
    <Panel
      title="Operator registry"
      index="// 04"
      tight
      actions={
        isPlaceholder ? <Badge tone="warn">Placeholder</Badge> : <Badge tone="ok">On chain</Badge>
      }
      testId="registry-panel"
    >
      <DataList rows={rows} testId="registry" />
      <p className="smallprint" data-testid="registry-fixture-note">
        {disclaimer}
      </p>
    </Panel>
  );
}
