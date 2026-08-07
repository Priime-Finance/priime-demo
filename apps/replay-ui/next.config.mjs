import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Verification builds must never stomp the dev server's .next/. Set
  // NEXT_DIST_DIR (e.g. `.next-verify`) to build and serve from an isolated
  // directory while `pnpm dev` keeps running on port 3000.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // Monorepo root is two levels up (apps/replay-ui -> apps -> priime-demo);
  // needed so file tracing covers schema/ and sibling packages.
  outputFileTracingRoot: path.join(__dirname, '../..'),
  reactStrictMode: true,
  // @priime-demo/journal-schema ships raw TS source (no build step, no
  // `exports` -> compiled dist) — transpile it through Next's SWC pipeline
  // rather than requiring consumers to prebuild it.
  transpilePackages: ['@priime-demo/journal-schema'],
}

export default nextConfig
