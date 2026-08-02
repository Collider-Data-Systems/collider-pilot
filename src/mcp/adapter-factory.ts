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
import { resolveSurfaceEngine } from "./surface-resolver.js";

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
 * Resolve the adapter config from `chrome.storage.local['pilot.access'].enforcement` (A3)
 * and — when the window carries a `?surface=` key (A16) — from the runtime
 * surface_key -> channel -> engine resolution, so a menno/lola/moos window reads ITS
 * engine instead of inheriting the build-time primary default.
 *
 * The surface resolution is best-effort: an unknown key, an engine-less room, or an
 * unreachable directory all degrade to the default engine (and, when an engine WAS named
 * but no local transport exists, the healthz kernel_urn comparison downstream renders the
 * honest mismatch warning). The enforcement read stays a NO-OP at the client-presentation
 * tier, as before. Safe outside an extension (returns {} / the surface part only).
 */
export async function resolveAdapterConfig(
  surfaceKey?: string,
): Promise<StreamableHttpAdapterConfig> {
  const config: StreamableHttpAdapterConfig = {};
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const got = await chrome.storage.local.get(STORAGE_ACCESS_KEY);
      const cfg = got?.[STORAGE_ACCESS_KEY] as { enforcement?: unknown } | undefined;
      if (cfg && cfg.enforcement != null) {
        config.enforcement = normalizeEnforcement(cfg.enforcement);
      }
    }
  } catch {
    // storage unavailable -> default (client-presentation) tier
  }
  if (surfaceKey) {
    try {
      const resolved = await resolveSurfaceEngine(surfaceKey);
      if (resolved) {
        // The EXPECTED engine identity always lands in the config — reachable or not —
        // so provenance states what this surface is SUPPOSED to read and the mismatch
        // warning can compare it against what the connected engine reports.
        config.engineUrn = resolved.engine_urn;
        if (resolved.reachable && resolved.engine_url && resolved.mcp_base_url) {
          config.engineUrl = resolved.engine_url;
          config.mcpBaseUrl = resolved.mcp_base_url;
        }
      }
    } catch {
      // resolution is best-effort — the default engine is always a working fallback
    }
  }
  return config;
}
