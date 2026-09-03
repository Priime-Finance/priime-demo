"use client";

/**
 * Host awareness (build.priime.finance graduation, 2026-08-21). On the build
 * host the canvas IS the root, so create-vault links should read as "/";
 * everywhere else they stay "/build" (which the build host also serves
 * directly, so the pre-hydration href is never wrong, just longer).
 */

import { useEffect, useState } from "react";

const BUILD_HOST = "build.priime.finance";

/** Href for the vault-builder canvas: "/" on build.priime.finance, "/build"
 *  everywhere else. SSR and first paint render "/build" (correct on every
 *  host), then the effect trims it to "/" on the build host. */
export function useBuildHref(): string {
  const [href, setHref] = useState("/build");
  useEffect(() => {
    if (window.location.hostname === BUILD_HOST) setHref("/");
  }, []);
  return href;
}
