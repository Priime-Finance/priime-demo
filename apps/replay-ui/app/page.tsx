import { redirect } from "next/navigation";

/**
 * The root is the canvas, and it always opens blank. `?new=1` is the same
 * flag the nav's Create vault key carries (lib/host.ts): without it the
 * canvas restores whatever composition the builder last left behind, and a
 * front door that hands you a half-built vault is answering a different
 * question. The canvas keeps the saved draft reachable through its own
 * resume affordance, so nothing is lost by opening fresh.
 */
export default function RootPage() {
  redirect("/build?new=1");
}
