import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// MV3 extension build.
//
// Two independent entry points:
//   - sidepanel.html  -> the extension-owned side-panel React app (the "seat").
//   - src/worker.ts   -> the MV3 service worker (module worker).
//
// Inputs are relative to the project root (Vite resolves them against `root`).
//
// The service worker is emitted at a STABLE, unhashed path (dist/worker.js) so the
// manifest can reference it directly. Everything the side panel needs (React,
// Cytoscape, the mock MCP adapter) is hashed under dist/assets/. Static files in
// public/ (manifest.json, icons/) are copied verbatim to dist/ by Vite.
//
// The worker only imports worker-only modules (the mock adapter + type-only
// interfaces), so Rollup inlines them into worker.js with no shared runtime chunk.
export default defineConfig({
  // Relative base so the emitted sidepanel.html references ./assets/* — resolves
  // correctly under chrome-extension://<id>/ when loaded unpacked.
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "esnext",
    sourcemap: true,
    rollupOptions: {
      input: {
        sidepanel: "sidepanel.html",
        preview: "preview.html",
        worker: "src/worker.ts",
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "worker" ? "worker.js" : "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
        format: "es",
      },
    },
  },
});
