// AssemblyScript mapping for PriimeVaultFactory.
//
// Every factory-deployed vault emits VaultCreated. We spawn a
// `PriimeVaultInstance` template so the same PriimeVault handlers run
// against the new vault address without a subgraph redeploy.

import { VaultCreated } from "../generated/PriimeVaultFactory/PriimeVaultFactory";
import { PriimeVaultInstance } from "../generated/templates";

export function handleVaultCreated(event: VaultCreated): void {
  PriimeVaultInstance.create(event.params.vault);
}
