/**
 * Flat config for the replay UI.
 *
 * Three layers, each one widening what the previous can see:
 *
 * 1. `next/core-web-vitals` + `next/typescript` — the framework's own rules
 *    (hooks, server/client boundaries, image and script usage). Pulled in
 *    through `FlatCompat` because eslint-config-next 15.4 still ships eslintrc
 *    files with no flat entry point.
 * 2. `typescript-eslint` *type-checked* presets. The type-aware rules are the
 *    reason to run a linter over TypeScript at all: floating promises, unsafe
 *    `any` flowing through a boundary and misused async handlers are invisible
 *    to a syntax-only pass, and `tsc` does not complain about any of them.
 * 3. Local adjustments, below, each with a reason.
 *
 * Type-aware linting needs a program per file, which `projectService` builds
 * from the nearest tsconfig. Plain `.mjs`/`.js` files (this one included) sit
 * outside that program, so the last block turns type-aware rules off for them
 * rather than pointing the parser at a project that does not contain them.
 */
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { FlatCompat } from "@eslint/eslintrc";
import tseslint from "typescript-eslint";

const rootDir = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: rootDir });

export default tseslint.config(
  {
    // Build output and generated files. `.next-verify` and `.next-ci` are the
    // alternate NEXT_DIST_DIRs used to build without stomping the dev server's
    // `.next/`, locally and in CI respectively.
    ignores: [".next/**", ".next-verify/**", ".next-ci/**", "next-env.d.ts"],
  },

  ...compat.extends("next/core-web-vitals", "next/typescript"),
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: rootDir },
    },
    rules: {
      // The codebase writes `foo === null` and `foo === undefined` on purpose:
      // `null` is "no explorer for this chain" / "no strike yet", which is a
      // rendered state, and `undefined` is "this prop was not passed". `??` is
      // used where the distinction genuinely does not matter. Collapsing the
      // two into `== null` would erase a distinction the render logic depends
      // on.
      eqeqeq: ["error", "always", { null: "always" }],

      // Unused names are an error, not a warning, with `_`-prefixed arguments
      // exempt: SVG render callbacks take `(_unused, index)` all over
      // `SystemCanvas`, where the value genuinely is not wanted.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // A floating promise in a component is a render that silently never
      // happens. Worth an error rather than the preset's default.
      "@typescript-eslint/no-floating-promises": "error",
    },
  },

  {
    // Tests may assert on `any` coming out of fixtures, and non-null assertions
    // on indexed fixture reads (`operators[0]!`) are the point of the fixture.
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },

  {
    // The files tsconfig.strict.json holds to `noUncheckedIndexedAccess`
    // (docs/plans/LATEST_UI_PORT_SPEC.md A.3 #38). The repo-wide program has
    // the flag off for the kit-verbatim canvas, so an indexed read's `!` looks
    // unnecessary here while the strict gate depends on it.
    files: [
      "tests/**/*.ts",
      "lib/journal.ts",
      "lib/source.ts",
      "lib/replay.ts",
      "lib/format.ts",
      "lib/vaults/attested.ts",
      "lib/vaults/requests.ts",
      "lib/vaults/pipeline.ts",
      "lib/vaults/rows.ts",
      "lib/demo-scope.ts",
      "lib/wallet.ts",
    ],
    rules: {
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
    },
  },

  {
    // Two type files copied verbatim from build.priime.finance and held
    // byte-identical to it (docs/plans/LATEST_UI_PORT_SPEC.md C.0.5), so the
    // stylistic preset yields to the source rather than the other way round.
    files: ["lib/strategy-factory/**/*.ts"],
    rules: { "@typescript-eslint/array-type": "off" },
  },

  {
    // Config and tooling files: outside the TS program, so type-aware rules
    // have nothing to read.
    files: ["**/*.mjs", "**/*.js", "**/*.cjs"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
