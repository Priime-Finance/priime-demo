import type { Metadata } from "next";
import RackCanvas from "@/components/canvas/RackCanvas";
import "./hm.css";
import "./build.css";

export const metadata: Metadata = {
  title: "Priime Build, compose a vault",
  description: "Compose your own automated vault from verified modules.",
  robots: { index: false },
};

/**
 * /build → the recursive loop builder, blank.
 *
 * One workflow is live on this build (docs/plans/LATEST_UI_PORT_SPEC.md A.2),
 * so the canvas always opens on its own blank lane. `?new=1` is honoured by
 * the canvas itself (it declines to load a stored draft and offers it back).
 * `?template`, `?demo`, `?seed` and `?strategy` are the live site's deep links
 * into compositions this build lists as coming soon; they are read by nothing
 * here and open the same blank canvas.
 */
export default function BuildPage() {
  return <RackCanvas />;
}
