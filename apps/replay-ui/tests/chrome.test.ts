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
  /* THREE faces, not five (founder, 2026-09-08). IBM Plex Mono was the app's
     SECOND monospace and Hanken Grotesk its SECOND grotesque; neither carried
     a distinction the product makes. The full gate lives in
     tests/type-faces.test.ts; this one holds the root layout to its own
     contract of owning every face as a variable on <html>. */
  it("owns the three next/font faces as variables on <html>", () => {
    for (const v of ["--font-geist", "--font-geist-mono", "--font-fraunces"]) {
      expect(src).toContain(`variable: "${v}"`);
    }
    expect(src).toContain("${geist.variable} ${geistMono.variable} ${fraunces.variable}");
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
  it("mounts the live shell, wallet stack included", () => {
    /* <Providers> was forbidden here while lib/wallet.ts was a mock. The
       wallet is real now, so the assertion inverts: wagmi + react-query wrap
       the whole shell, and the sheet the connect hook opens is mounted once
       inside it. AppTabs and BareRoute stay out, as before. */
    for (const s of ["<Providers>", "<SiteNav />", "<VintageFooter />", "<WalletSheet />", 'id="main-content"']) {
      expect(src).toContain(s);
    }
    expect(src).toContain('from "@/components/Providers"');
    expect(src).not.toMatch(/<AppTabs\s*\/>|from "@\/components\/chrome\/BareRoute"|from "@\/components\/nav\/ProductTabs"/);
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
    /* The pill keeps the landing's 12.5px metric; the FACE is the app's one
       sans, because the pill's links are words and a monospaced pill on
       every page is the mono working "as main". */
    expect(css).toMatch(/\.nav \.link\{font-family:var\(--font-body\);font-size:12\.5px/);
    expect(css).toContain(".nav-about-card{");
    expect(css).toContain("@keyframes navPortfolioBloom");
    expect(css).toContain(':root[data-theme="dark"] .nav .wrap{');
    expect(css).toContain("::view-transition-new(theme-glyph)");
  });
  it("keeps the CTA blue, at the landing's metrics, in the app's one sans", () => {
    expect(css).toMatch(/\.btn--orange,\.nav \.btn--orange\{ background:#2B5CFF !important/);
    expect(css).toMatch(/\.nav \.btn--orange\{ font-family:var\(--font-body\) !important;\n\s*font-size:12\.5px !important/);
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
  it("reads the wallet through the seam, never wagmi directly", () => {
    /* lib/wallet.ts is the adapter over wagmi now rather than a mock, but the
       invariant it was written to protect is the same and still worth a gate:
       every consumer goes through the one seam, so swapping the wallet
       library again touches exactly one file. */
    expect(src).toContain('from "@/lib/wallet"');
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
  it("carries the wallet slot, and never the Review card's words", () => {
    /* The mock build had no connect pill, because a key that connects
       nothing is a lie. The wallet is real now and Antoni reserved this slot
       for it (PR #15: "the nav slot is SiteNav's right cluster"), so the pill
       is here: Connect when disconnected, the address when connected, which
       is also the only way to see which key is about to become the vault's
       exit key, and the only way to drop it.

       "Connect wallet" stays out. That phrasing belongs to the Review card's
       key morph, which is the commitment moment; the nav's is a utility. One
       wording per moment. */
    expect(src).toContain("nav-wallet");
    expect(src).toContain("shortAddress(address)");
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

describe("WalletSheet (1.6)", () => {
  const src = read("components/wallet/WalletSheet.tsx");
  it("listens on the seam's events and connects through wagmi", () => {
    expect(src).toContain("WALLET_OPEN_EVENT");
    expect(src).toContain("WALLET_CLOSE_EVENT");
    expect(src).toContain("useConnect");
    expect(src).toContain("connect({ connector: c }");
  });
  it("keeps no wallet state of its own", () => {
    /* The mock this replaced wrote a localStorage flag and announced it.
       Connected state is wagmi's now, read through useAccount, so a second
       source of truth here would be a session the rest of the app cannot
       see. */
    expect(src).not.toMatch(/localStorage|connectDemoWallet|WALLET_KEY/);
  });
  it("stays a picker: no address, no fields", () => {
    expect(src).toContain("Connect a wallet");
    expect(src).toContain("Nothing else is signed.");
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

/* ══ THE ROUTER LANE'S CHROME (router lane plan WP-1, design items 1-7) ═════
   Source-level pins, in this file's own idiom: the register these surfaces
   print has one owner each, and the greps below are what stops a second copy
   of a figure or of a retired claim from landing beside it. */

describe("the demo row's two rates are typed inputs, and the row says so (G3)", () => {
  const src = read("lib/demo/market.ts");
  it("carries the two named constants and reads no measured series", () => {
    /* The substitution is reverted (item 8a): the row is the pair captured
       before the router, the measured series stays in `router-history.ts`, and
       the two answer different questions under different labels. This module
       must not reach for the capture at all, or the two frames weld again. */
    expect(src).toContain("const DEMO_COLLATERAL_YIELD_APY = 0.044;");
    expect(src).toContain("const DEMO_BORROW_APY_MARGINAL = 0.035;");
    expect(src).toContain("collateralYieldApy: DEMO_COLLATERAL_YIELD_APY");
    expect(src).toContain("borrowApyMarginal: DEMO_BORROW_APY_MARGINAL");
    expect(src).not.toContain('from "@/lib/canvas/router-history"');
    expect(src).not.toContain("routerLastAlignedDay()");
  });
});

describe("the router is not advertised as a yield follower (item 2)", () => {
  it("prints the measured claim on the plate key and on both summaries", () => {
    const plate = read("components/canvas/OrchestratorPlate.tsx");
    /* `Best lane` (item 9): two words on a key with room for two. The claim is
       the same measured one, a protection ratchet rather than a follower. */
    expect(plate).toContain("Best lane");
    expect(plate).not.toMatch(/^\s+Follow yield$/m);
    const rack = read("components/canvas/RackCanvas.tsx");
    expect(rack).not.toContain("following modeled yield");
    expect(rack.match(/router moving the whole book to the better lane on the 48-hour rule/g)).toHaveLength(2);
  });
});

describe("one control, one name (item 3)", () => {
  it("spells the add-a-lane key identically on the rack and in the dock", () => {
    const rack = read("components/canvas/RackCanvas.tsx");
    const dock = read("components/canvas/dock/ComposePanel.tsx");
    expect(rack).not.toContain("＋ Add a loop");
    expect(rack.match(/＋ Add a lane/g)).toHaveLength(2);
    expect(dock.match(/＋ Add a lane/g)).toHaveLength(2);
    expect(rack).toContain("addLaneAndDiscover");
    expect(rack).not.toContain("addLoopAndDiscover");
  });
});

describe("the shelf count is never typed at a call site (item 6)", () => {
  it("appears only inside its own derivation", () => {
    for (const rel of [
      "components/canvas/GhostSlot.tsx",
      "components/canvas/dock/ComposePanel.tsx",
      "components/canvas/RackCanvas.tsx",
      "lib/canvas/shelf-count.ts",
    ]) {
      expect(read(rel)).not.toContain("3 modules, 2 strategies");
    }
  });
});

describe("the allocation rows read in the dock (item 7)", () => {
  const css = read("app/build/build.css");
  it("de-uppercases the dock rows and leaves both grounds' colours alone", () => {
    expect(css).toContain(".dock-scroll .rk-orchrow{text-transform:none;letter-spacing:.02em}");
    /* NO COLOUR IN THE DOCK-SCOPED RULE, measured: `.dock-allocs` is a
       mode-constant dark card (#0d0d0d at :869, #0A0E2A at :1528, neither
       behind a media query), so the shipped #a5a5a0 / #e9e9e6 read 7.64:1 and
       15.2:1 there and `--bc-body` would read 2.47:1. */
    const dockScoped = css.split("\n").filter((l) => l.startsWith(".dock-scroll .rk-orchrow"));
    expect(dockScoped).toHaveLength(1);
    for (const l of dockScoped) expect(l).not.toContain("color:");
    // the mode-constant plate rules are untouched
    expect(css).toContain(".rk-orchrow b{color:#e9e9e6;font-weight:600;font-size:9.5px}");
    expect(css).toContain("background:#0d0d0d");
    expect(css).toContain(".dock-allocs{background:#0A0E2A;border-color:#1B2350}");
  });
  it("carries the router wave's motion with its reduced-motion substitution", () => {
    expect(css).toContain("@keyframes rkmulti{from{transform:scale(1.12);opacity:.72}to{transform:none;opacity:1}}");
    expect(css).toContain(".rk-rack--multi .rk-lane{animation:none}");
    expect(css).toContain(".rk-addlane:active,.cpz-addlane:active{transform:none}");
    // no `both` / `forwards` fill on the new beat: nothing rests hidden
    expect(css).not.toMatch(/rkmulti [^;}]*\b(both|forwards)\b/);
  });
  it("folds the de-uppercase register into the two declarations that own it", () => {
    expect(css).not.toMatch(/^\.rk-addlane\{text-transform:none/m);
    expect(css).not.toMatch(/^\.rt-modeled\{text-transform:none;letter-spacing:\.02em\}$/m);
    expect(css.match(/\.rk-addlane\{[^}]*text-transform:none/g)).toHaveLength(1);
    expect(css).toContain("width:calc(100% - 36px)");
  });
  it("seats the router column by top border and gives the plate no invented code", () => {
    expect(css).toContain(".rk-orchcol{flex:0 0 auto;display:flex;flex-direction:column;justify-content:flex-start;padding:10px 26px 40px 8px}");
    expect(read("components/canvas/OrchestratorPlate.tsx")).not.toContain('<span className="n">OR</span>');
  });
});
