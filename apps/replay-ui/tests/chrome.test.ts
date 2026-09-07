import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The chrome gate (docs/plans/LATEST_UI_PORT_SPEC.md C, WP1 acceptance),
 * pinned as a test so it survives the merge. These are the greps the spec
 * names, read off the files on disk: the nav and footer on every page are
 * the live ones, the fonts are the root layout's, the coming-soon register
 * has one CSS owner, and the retired demo chrome (inert nav spans, the
 * connect pill, the wagmi dialog rules, the orange icon) is gone.
 */

const APP = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string) => readFileSync(path.join(APP, rel), "utf8");

describe("root layout (1.1)", () => {
  const src = read("app/layout.tsx");
  it("owns the five next/font faces as variables on <html>", () => {
    for (const v of ["--font-geist", "--font-geist-mono", "--font-plex-mono", "--font-hanken", "--font-fraunces"]) {
      expect(src).toContain(`variable: "${v}"`);
    }
    expect(src).toContain("${hanken.variable} ${fraunces.variable}");
  });
  it("carries the PRETHEME script verbatim with its kill switch", () => {
    expect(src).toContain("/*pretheme-v5*/");
    expect(src).toContain('d.hasAttribute("data-theme-off")');
    expect(src).toContain("cookie -> localStorage -> matchMedia");
  });
  it("points the icon at /favicon.svg and never at a Google Fonts link", () => {
    expect(src).toContain('icons: { icon: "/favicon.svg" }');
    expect(src).not.toContain("fonts.googleapis.com/css");
    expect(src).not.toMatch(/<link\s/);
  });
  it("mounts the live shell and nothing hidden", () => {
    for (const s of ["<SiteNav />", "<VintageFooter />", "<DemoWalletSheet />", 'id="main-content"']) {
      expect(src).toContain(s);
    }
    expect(src).not.toMatch(/<Providers>|<AppTabs\s*\/>|from "@\/components\/chrome\/BareRoute"|from "@\/components\/Providers"|from "@\/components\/nav\/ProductTabs"/);
    expect(src).toContain("suppressHydrationWarning");
  });
  it("prints the viewport the pre-paint script re-stamps", () => {
    expect(src).toContain('themeColor: "#F5F2EB"');
    expect(src).toContain('colorScheme: "light dark"');
  });
});

describe("root redirect (1.2)", () => {
  it("sends / to the blank canvas", () => {
    expect(read("app/page.tsx")).toContain('redirect("/build?new=1")');
  });
});

describe("globals.css (1.3)", () => {
  const css = read("app/globals.css");
  it("keeps the demo's @theme block and the tokens import", () => {
    expect(css).toContain('@import "../lib/design/tokens.css"');
    expect(css).toContain("@theme {");
  });
  it("drops the retired demo chrome", () => {
    expect(css).not.toMatch(/data-rk|Monument|link--inert|link--create/);
  });
  it("carries the live pill, the About card, the Portfolio reveal and HELIOS dark", () => {
    expect(css).toMatch(/\.nav \.link\{font-family:var\(--font-plex-mono\),"IBM Plex Mono"[^}]*font-size:12\.5px/);
    expect(css).toContain(".nav-about-card{");
    expect(css).toContain("@keyframes navPortfolioBloom");
    expect(css).toContain(':root[data-theme="dark"] .nav .wrap{');
    expect(css).toContain("::view-transition-new(theme-glyph)");
  });
  it("keeps the CTA blue in the nav's own Plex Mono register", () => {
    expect(css).toMatch(/\.btn--orange,\.nav \.btn--orange\{ background:#2B5CFF !important/);
  });
  it("remaps every literal family name to a root-layout variable", () => {
    const literalFraunces = css.split("\n").filter((l) => l.includes("'Fraunces'") && !l.includes("var(--font-fraunces)"));
    expect(literalFraunces).toEqual([]);
    expect(css).not.toContain("fonts.googleapis");
    expect(css).not.toContain('--mono:"Geist Mono"');
  });
  it("masks the dark wordmark with the demo's logo path", () => {
    expect(css).not.toContain("url(/priime-logo.png)");
    expect(css).toContain("mask:url(/brand/priime-logo-lightbg.png) no-repeat center/contain");
  });
  it("has no letterspaced uppercase left in the page register", () => {
    expect(css).not.toContain("text-transform:uppercase");
  });
  it("declares the coming-soon register once, as the spec's block", () => {
    expect(css.match(/^\.soon-tag\{/gm)).toHaveLength(1);
    expect(css).toContain("[data-soon]>:not(.soon-tag):not([data-soon-help]){opacity:.62}");
    expect(css).toContain("[data-soon] [data-soon-press]{pointer-events:none}");
    expect(css).toContain(".vx-card[data-soon]:hover .vx-ds-line{animation:none}");
    expect(css.trimEnd().endsWith(".vx-card[data-soon]:hover .vx-ds-line{animation:none}")).toBe(true);
  });
  it("keeps the footer seam without the wallet-kit wrapper", () => {
    expect(css).toContain("body{display:flex;flex-direction:column;min-height:100dvh}");
    expect(css).toContain("body>footer{margin-top:auto}");
    expect(css).toContain("body>main{max-width:min(80rem,100%)}");
  });
});

describe("SiteNav (1.4)", () => {
  const src = read("components/nav/SiteNav.tsx");
  it("reads the mock wallet, not wagmi", () => {
    expect(src).toContain('import { useAccount } from "@/lib/wallet"');
    expect(src).not.toMatch(/from "wagmi"/);
    expect(src).toContain("const showPortfolio = mounted && isConnected");
  });
  it("links the live destinations and the blue Create vault CTA", () => {
    for (const s of ['href="/vaults"', 'href="/portfolio"', "`${SITE}/ecosystem`", "`${SITE}/stack`", "`${SITE}/risk`", "`${SITE}/docs`", "`${SITE}/blog`"]) {
      expect(src).toContain(s);
    }
    expect(src).toContain('const SITE = "https://priime.finance"');
    expect(src).toContain('className="btn btn--orange" href={buildHref}');
    expect(src).toContain("Create vault");
  });
  it("never prints a connect pill in the nav", () => {
    expect(src).not.toContain("Connect wallet");
  });
  it("uses the demo's logo path and writes the host cookie", () => {
    expect(src).toContain('src="/brand/priime-logo-lightbg.png"');
    expect(src).toContain("document.cookie = `${THEME_KEY}=${next};Path=/;Max-Age=31536000;SameSite=Lax`");
  });
  it("has no em dash", () => {
    expect(src).not.toContain("—");
  });
});

describe("VintageFooter (1.5)", () => {
  it("is the live footer with the demo's logo path", () => {
    expect(read("components/footer/VintageFooter.tsx")).toContain('src="/brand/priime-logo-darkbg.png"');
  });
});

describe("DemoWalletSheet (1.6)", () => {
  const src = read("components/wallet/DemoWalletSheet.tsx");
  it("listens for the open event and connects through the one owner", () => {
    expect(src).toContain("WALLET_OPEN_EVENT");
    expect(src).toContain("WALLET_CLOSE_EVENT");
    expect(src).toContain("connectDemoWallet()");
  });
  it("prints the two sanctioned strings and the two keys only", () => {
    expect(src).toContain("Demo wallet");
    expect(src).toContain("Client state only. Nothing is signed.");
    expect(src).toContain(">\n            Connect\n");
    expect(src).toContain(">\n            Not now\n");
    expect(src).not.toMatch(/<input|<select|0x[0-9a-f]{4}/i);
  });
});

describe("icon (1.7)", () => {
  it("has no orange app icon; /favicon.svg is the tab icon", () => {
    expect(existsSync(path.join(APP, "app/icon.svg"))).toBe(false);
    const favicon = read("public/favicon.svg");
    expect(favicon).not.toMatch(/F5481F/i);
  });
});
