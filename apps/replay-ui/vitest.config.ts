import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const appDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Engine tests only: pure functions, node environment, no DOM, no next.
 * Aliases mirror tsconfig.json `paths` so tests import exactly what the app
 * imports (including the repo-root schema/ samples).
 */
export default defineConfig({
  resolve: {
    alias: {
      "@schema": path.join(appDir, "../../schema"),
      "@": appDir,
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
