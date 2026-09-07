/**
 * The store's change event, as a LEAF so a reader that only needs to listen
 * (`requests.ts`, the strict-checked deposit seam) does not import the kit.
 * `store.ts` re-exports it under the same name; the value is the live one.
 */
export const VAULTS_EVENT = "priime:vaults-changed";
