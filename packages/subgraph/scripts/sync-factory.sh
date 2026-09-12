#!/usr/bin/env bash
# Copy the factory address deploy/vault-service.sh wrote out into networks.json,
# so `pnpm deploy` picks up whatever the latest mainnet factory deploy landed.
set -euo pipefail

HERE=$(cd "$(dirname "$0")/.." && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
FACTORY_JSON="${FACTORY_JSON:-$ROOT/deploy/.mainnet/factory.json}"
NETWORKS_JSON="${NETWORKS_JSON:-$HERE/networks.json}"

[ -f "$FACTORY_JSON" ] || { echo "no factory.json at $FACTORY_JSON (run deploy/vault-service.sh first)"; exit 1; }
FACTORY=$(jq -r .factory "$FACTORY_JSON")
BLOCK=$(jq -r '.start_block // empty' "$FACTORY_JSON")

TMP=$(mktemp)
jq --arg factory "$FACTORY" \
   --argjson block "${BLOCK:-null}" \
   '(.base.PriimeVaultFactory.address = $factory)
    | (if $block != null then .base.PriimeVaultFactory.startBlock = $block else . end)' \
   "$NETWORKS_JSON" > "$TMP"
mv "$TMP" "$NETWORKS_JSON"
echo "networks.json: PriimeVaultFactory.address = $FACTORY"
