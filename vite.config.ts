import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * BUILD STAMP. The loaded extension is a COPY of dist/, so "is the panel running the code
 * I just changed?" is a real question — it cost us a stale-dist misdiagnosis in t263 and
 * another guess in t264. The stamp is injected here and rendered in the posture strip's
 * audit drawer, so the answer is legible from the panel itself (and from a screenshot).
 * Best-effort: a missing git or a dirty tree still produces a usable stamp.
 */
function buildStamp(): string {
  const git = (args: string) => {
    try {
      return execSync(`git ${args}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return "";
    }
  };
  const sha = git("rev-parse --short HEAD") || "nogit";
  const dirty = git("status --porcelain") ? "+dirty" : "";
  const when = new Date().toISOString().slice(0, 16).replace("T", " ");
  return `${sha}${dirty} · ${when}Z`;
}

// MV3 extension build.
//
// Entry points:
//   - sidepanel.html      -> the extension-owned side-panel React app (the "seat").
//   - src/worker.ts       -> the MV3 service worker (module worker).
//   - preview.html        -> dev/CI harness on the MOCK adapter (Phase 1).
//   - preview-live.html   -> dev/CI harness on the LIVE StreamableHttpMcpAdapter (Phase 2).
//   - pip-preview.html    -> dev/CI harness rendering the Document PiP content view (Phase 3).
//   - pip.html            -> SHIPPED extension page: the chrome.windows popup PiP mirror
//                            (side-panel fallback when Document PiP is unavailable).
//   - selftest.html       -> SHIPPED dev page: in-extension integration self-test. It is the
//                            only surface that can exercise the worker seam, the real
//                            chrome.storage access trust seam, and the live view_filter axes,
//                            because the served harnesses fake all three. Read-only.
//
// The preview* entries are dev harnesses (not part of the loaded extension), built here
// only so CI type-checks + bundles them. `pip.html`, by contrast, IS a loaded extension
// page (opened via chrome.windows.create with chrome.runtime.getURL). Inputs are relative
// to the project root.
//
// The service worker is emitted at a STABLE, unhashed path (dist/worker.js) so the
// manifest can reference it directly. Everything the side panel needs (React,
// Cytoscape, the mock MCP adapter) is hashed under dist/assets/. Static files in
// public/ (manifest.json, icons/) are copied verbatim to dist/ by Vite.
//
// The worker only imports worker-only modules (the mock adapter + type-only
// interfaces), so Rollup inlines them into worker.js with no shared runtime chunk.
export default defineConfig({
  define: {
    __PILOT_BUILD__: JSON.stringify(buildStamp()),
  },
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
        "preview-live": "preview-live.html",
        "pip-preview": "pip-preview.html",
        pip: "pip.html",
        selftest: "selftest.html",
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
