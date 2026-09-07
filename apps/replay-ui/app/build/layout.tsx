/**
 * Build-canvas layout. The fonts the canvas reads (`--font-hanken`,
 * `--font-plex-mono`, `--font-fraunces`) are the root layout's next/font
 * variables on `<html>` (docs/plans/LATEST_UI_PORT_SPEC.md A.3 #33); nothing
 * is loaded here. The wrapper is `display:contents` so the route adds no box.
 */

export default function BuildLayout({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "contents" }}>{children}</div>;
}
