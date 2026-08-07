/**
 * PeerPanel — the p2p mesh as the nodes see it: peer id per node and how many
 * peers each is connected to.
 *
 * This is fixture data until the live backend serves `/p2p/status`, and the
 * panel says so in its own small print. Honesty is the product: nothing here
 * may be presented as live.
 */
import { Badge } from "@/components/Badge";
import { Panel } from "@/components/Panel";

export interface PeerNodeView {
  /** Registry label, e.g. `"node-1"`. */
  label: string;
  /** Truncated libp2p peer id. */
  peerId: string;
  /** Full peer id, for the title attribute. */
  peerIdTitle: string;
  /** Connected-peer count line, e.g. `"2 peers"`. */
  connected: string;
}

export interface PeerPanelProps {
  /** Discovery mechanism label, e.g. `"mDNS"`. */
  discovery: string;
  /** One row per node. */
  nodes: readonly PeerNodeView[];
  /** The fixture disclaimer. */
  disclaimer: string;
}

/** The p2p rail panel. */
export function PeerPanel({
  discovery,
  nodes,
  disclaimer,
}: PeerPanelProps): React.JSX.Element {
  return (
    <Panel
      title="Peer mesh"
      index="// 03"
      tight
      actions={<Badge tone="ghost">{discovery}</Badge>}
      testId="peer-panel"
    >
      {nodes.map((node) => (
        <div className="node" key={node.label}>
          <div className="node__head">
            <span className="node__name">{node.label}</span>
            <span className="op__weight">{node.connected}</span>
          </div>
          <span className="node__peer" title={node.peerIdTitle}>
            {node.peerId}
          </span>
        </div>
      ))}
      <p className="smallprint" data-testid="peer-fixture-note">
        {disclaimer}
      </p>
    </Panel>
  );
}
