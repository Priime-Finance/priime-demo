/**
 * priime-build-ui-kit integration: app/globals.css opens with
 * `@import "tailwindcss";` (Tailwind v4's CSS-first import). The kit's own
 * source project has Tailwind configured; this app didn't, so it's added
 * here as a build dependency — the kit's layout.tsx also leans on Tailwind
 * utilities (sr-only skip-link, the max-w-7xl content wrapper) beyond what a
 * hand-rolled CSS stub could reasonably cover.
 */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
