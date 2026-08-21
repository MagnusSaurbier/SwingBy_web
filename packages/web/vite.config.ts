// Build config for the @swingby/web workspace.
//
// Kept deliberately plain: no plugins, no framework preset. The UI layer is plain TypeScript +
// DOM (see main.ts's framework-choice comment) — a plugin belongs here only if that ever changes
// (e.g. an `@sveltejs/vite-plugin-svelte`). Everything else — router, canvas, WebAudio — is plain
// TS/DOM and needs no build-time transform beyond esbuild's default TS/ESM handling.
//
// SPA behaviour: `appType` defaults to "spa", which makes both `vite` (dev) and `vite preview`
// serve index.html for any unmatched path — that's what makes deep links like `/play/builtin-07`
// work on a cold load in dev. In production on Vercel, the equivalent fallback is the rewrite in
// ../../vercel.json; the two must keep agreeing.
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    sourcemap: true,
    // Matches the tsconfig `target` so nothing gets downleveled twice.
    target: "es2022",
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
});
