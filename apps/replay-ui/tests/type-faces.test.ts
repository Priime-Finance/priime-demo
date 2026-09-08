import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * THE TYPE GATE (founder, 2026-09-08: "there is a lot of different fonts
 * used ... use the design team to uniformise it and do not use too many
 * fonts like this. also not a big fan of the typescript font; you can use it
 * sporadically; but not as main").
 *
 * The app carries THREE faces and no more: Geist is the one sans and it
 * carries every word; Geist Mono is the one mono and it is used sporadically,
 * for the data register only; Fraunces italic is the one annotation voice.
 *
 * IBM Plex Mono (a second monospace, which printed the nav pill on every page
 * while Geist Mono printed the numbers below it) and Hanken Grotesk (a second
 * grotesque, which changed the hand under the reader between /build and
 * /vaults) are unloaded. `--font-inter` was never defined anywhere in the
 * repo, and chaining an undefined var() made the whole `--font-body`
 * declaration invalid at computed-value time, which dropped the entire vault
 * surface to the browser's default serif.
 *
 * This gate exists because two of the three inline font literals that had to
 * be fixed (VintageFooter, RackCanvas) had already routed PAST the token
 * layer once. A retired face does not come back through the tokens; it comes
 * back through an inline style or a comment that still names it as current.
 */

const APP = fileURLToPath(new URL("..", import.meta.url));
const ROOTS = ["app", "components", "lib"];
const EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".css", ".mjs", ".cjs"]);

/** Every string that must not appear in the app's own source, comments too. */
const RETIRED = ["IBM Plex Mono", "font-plex-mono", "Hanken Grotesk", "font-hanken", "font-inter"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXT.has(path.extname(entry))) out.push(full);
  }
  return out;
}

describe("one type system", () => {
  const files = ROOTS.flatMap((r) => walk(path.join(APP, r)));

  it("walks a non-trivial tree, so a passing gate means something", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  for (const needle of RETIRED) {
    it(`names ${needle} nowhere under app/, components/ or lib/`, () => {
      const hits: string[] = [];
      for (const f of files) {
        const src = readFileSync(f, "utf8");
        if (!src.includes(needle)) continue;
        for (const [i, line] of src.split("\n").entries()) {
          if (line.includes(needle)) hits.push(`${path.relative(APP, f)}:${String(i + 1)}`);
        }
      }
      expect(hits).toEqual([]);
    });
  }

  it("loads exactly Fraunces, Geist and Geist Mono from next/font/google", () => {
    const src = readFileSync(path.join(APP, "app/layout.tsx"), "utf8");
    expect(src).toContain('import { Fraunces, Geist, Geist_Mono } from "next/font/google";');
    // …and the three variables reach <html>, with nothing else beside them.
    expect(src).toContain("${geist.variable} ${geistMono.variable} ${fraunces.variable}");
    for (const v of ["--font-geist", "--font-geist-mono", "--font-fraunces"]) {
      expect(src).toContain(`variable: "${v}"`);
    }
  });

  it("resolves --font-display and --font-body through defined variables only", () => {
    const src = readFileSync(path.join(APP, "lib/design/tokens.css"), "utf8");
    for (const token of ["--font-display", "--font-body"]) {
      const line = src.split("\n").find((l) => l.trimStart().startsWith(`${token}:`));
      expect(line, `${token} is declared`).toBeDefined();
      // One var() only, and it is the face the root layout actually mounts.
      expect(line).toContain("var(--font-geist)");
      expect((line ?? "").match(/var\(/g) ?? []).toHaveLength(1);
    }
  });
});
