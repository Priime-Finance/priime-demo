import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Verification builds must never stomp the dev server's .next/. Set
  // NEXT_DIST_DIR (e.g. `.next-verify`) to build and serve from an isolated
  // directory while `pnpm dev` keeps running on port 3000.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // Ship a self-contained server bundle (`.next/standalone/`) so we can
  // rsync just that directory + `.next/static/` + `public/` to the box
  // and run `node server.js` without shipping full node_modules.
  output: 'standalone',
  // Monorepo root is two levels up (apps/replay-ui -> apps -> priime-demo);
  // needed so file tracing covers schema/ and sibling packages.
  outputFileTracingRoot: path.join(__dirname, '../..'),
  reactStrictMode: true,
  // @priime-demo/journal-schema and @priime-demo/loop-deploy ship raw TS
  // source (no build step, no exports -> compiled dist); transpile them
  // through Next's SWC pipeline.
  transpilePackages: ['@priime-demo/journal-schema', '@priime-demo/loop-deploy'],
  webpack(config) {
    // @wagmi/connectors' barrel statically imports Coinbase baseAccount and
    // x402 modules even though we only register `injected` in lib/wagmi.ts.
    // Aliasing the unresolvable deep paths to false lets webpack finish;
    // the code that would reach them is never invoked at runtime.
    config.resolve = config.resolve ?? {}
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      '@x402/core/client': false,
      '@x402/svm/exact/client': false,
      '@x402/evm': false,
    }
    return config
  },
  // The founder's wording is "the vault page"; the routes are /vaults and
  // /vaults/[slug] (spec A.3 #35). Old /vault/* links land with a 308.
  async redirects() {
    return [{ source: '/vault/:path*', destination: '/vaults/:path*', permanent: true }]
  },
}

export default nextConfig
