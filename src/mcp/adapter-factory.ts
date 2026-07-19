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

import type { AccessEnforcement, McpAdapter } from "./types";
import { MockMcpAdapter } from "./mock-adapter";
import {
  StreamableHttpMcpAdapter,
  type StreamableHttpAdapterConfig,
} from "./streamable-http-adapter";

export type AdapterMode = "mock" | "live";

const STORAGE_MODE_KEY = "pilot.adapterMode";
const STORAGE_ACCESS_KEY = "pilot.access";

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

function normalizeEnforcement(value: unknown): AccessEnforcement {
  return value === "server-authoritative" ? "server-authoritative" : "client-presentation";
}

/**
 * Resolve the adapter config from `chrome.storage.local['pilot.access'].enforcement` (A3).
 * Threads the tier posture into the adapter. NO-OP at the client-presentation tier — the
 * access set is computed in the pure transform after the read; this only pre-wires the seam
 * the future server-authoritative tier flips. Safe outside an extension (returns {}).
 */
export async function resolveAdapterConfig(): Promise<StreamableHttpAdapterConfig> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const got = await chrome.storage.local.get(STORAGE_ACCESS_KEY);
      const cfg = got?.[STORAGE_ACCESS_KEY] as { enforcement?: unknown } | undefined;
      if (cfg && cfg.enforcement != null) {
        return { enforcement: normalizeEnforcement(cfg.enforcement) };
      }
    }
  } catch {
    // storage unavailable -> default (client-presentation) tier
  }
  return {};
}
