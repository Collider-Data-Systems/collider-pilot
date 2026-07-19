/**
 * Collider Pilot - adapter factory + runtime mode switch (Phase 2)
 * ================================================================
 * One place that decides which `McpAdapter` the seat talks to:
 *
 *   'mock' -> MockMcpAdapter          (fixed fixture, no I/O; Phase 1 behaviour)
 *   'live' -> StreamableHttpMcpAdapter (live read from the Z440 engine; Phase 2)
 *
 * The EXTENSION defaults to 'live' (this is the live-read phase). The default is a
 * build-time constant, overridable two ways without a rebuild:
 *   - build time:  VITE_PILOT_ADAPTER_MODE=mock npm run build
 *   - run time:    chrome.storage.local['pilot.adapterMode'] = 'mock' (checked on start)
 *
 * Phase 1's `preview.html` stays hard-wired to the MOCK adapter (a served page cannot
 * bypass CORS to reach localhost); `preview-live.html` uses the LIVE adapter and only
 * renders data in a CORS-exempt context (a loaded extension). See README.
 */

import type { McpAdapter } from "./types";
import { MockMcpAdapter } from "./mock-adapter";
import {
  StreamableHttpMcpAdapter,
  type StreamableHttpAdapterConfig,
} from "./streamable-http-adapter";

export type AdapterMode = "mock" | "live";

const STORAGE_MODE_KEY = "pilot.adapterMode";

function normalizeMode(value: unknown): AdapterMode | null {
  return value === "mock" || value === "live" ? value : null;
}

/**
 * Build-time default. Reads `VITE_PILOT_ADAPTER_MODE` if present, else defaults the
 * extension to 'live' (Phase 2). Vite statically replaces `import.meta.env.*`.
 */
export const DEFAULT_ADAPTER_MODE: AdapterMode =
  normalizeMode(import.meta.env?.VITE_PILOT_ADAPTER_MODE) ?? "live";

/** Instantiate the adapter for an explicit mode. */
export function createAdapter(
  mode: AdapterMode,
  config?: StreamableHttpAdapterConfig,
): McpAdapter {
  return mode === "mock"
    ? new MockMcpAdapter()
    : new StreamableHttpMcpAdapter(config);
}

/**
 * Resolve the effective mode: a `chrome.storage.local` override if present, else the
 * build-time default. Safe to call outside an extension (returns the default).
 */
export async function resolveAdapterMode(): Promise<AdapterMode> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const got = await chrome.storage.local.get(STORAGE_MODE_KEY);
      const override = normalizeMode(got?.[STORAGE_MODE_KEY]);
      if (override) return override;
    }
  } catch {
    // storage unavailable -> fall back to the build-time default
  }
  return DEFAULT_ADAPTER_MODE;
}
