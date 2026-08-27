import { redirect } from "next/navigation";

/**
 * Root now belongs to the Priime Build canvas kit's app/layout.tsx +
 * app/globals.css (see priime-build-ui-kit integration). The canvas itself
 * lives at /build (single-host POC — see the kit's own note on middleware.ts,
 * which is deleted here since there is only one host). The legacy replay
 * console is gone: the operator pipeline it used to show is now a panel on
 * /vault (`components/vaults/OperatorNodes.tsx`), replaying the same captures.
 */
export default function RootPage() {
  redirect("/build");
}
