"use client";

/**
 * Host awareness (build.priime.finance graduation, 2026-08-21). On the build
 * host the canvas IS the root, so create-vault links should read as "/";
 * everywhere else they stay "/build" (which the build host also serves
 * directly, so the pre-hydration href is never wrong, just longer).
 */

import { useEffect, useState } from "react";

export const BUILD_HOST = "build.priime.finance";

/**
 * Href for the vault-builder canvas: "/" on build.priime.finance, "/build"
 * everywhere else. SSR and first paint render "/build" (correct on every
 * host), then the effect trims it to "/" on the build host.
 *
 * `?new=1` — CREATE VAULT ALWAYS OPENS A BLANK CANVAS (founder, 2026-08-22:
 * "when i click on create vault i m still on a preloaded canvas"). Without it
 * the CTA reopens whatever composition the builder last left behind, because
 * the canvas restores a saved draft on mount. A control labelled "Create
 * vault" that hands you a half-built one is answering a different question.
 *
 * This is safe to do ONLY because it ships with a resume affordance: the
 * canvas peeks at the stored draft, declines to load it, and offers it back
 * as a key. Without that the draft would be unreachable from the only CTA
 * that reaches the builder, which is data loss dressed as a fix.
 */
export function useBuildHref(): string {
  const [href, setHref] = useState("/build?new=1");
  useEffect(() => {
    if (window.location.hostname === BUILD_HOST) setHref("/?new=1");
  }, []);
  return href;
}
