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
import { cfAccessHeadersFor, isCloudHost, loadCfAccess } from "../state/cf-access";
import { MockMcpAdapter } from "./mock-adapter";
import {
  StreamableHttpMcpAdapter,
  type StreamableHttpAdapterConfig,
} from "./streamable-http-adapter";
import { resolveSurfaceEngine } from "./surface-resolver.js";
import { isKernelUrn, normalizeBaseUrl } from "./transform.js";

export type AdapterMode = "mock" | "live";

const STORAGE_MODE_KEY = "pilot.adapterMode";
const STORAGE_ACCESS_KEY = "pilot.access";
export const STORAGE_ENGINE_KEY = "pilot.engine";

/**
 * The stored default-engine override (Settings "engine" section, t278): which fleet
 * engine surfaceless windows (the docked panel, the pop-out, the PiP) read instead of
 * the build-time localhost default. READ-ONLY like everything here — it changes which
 * engine is read, never what can be written (nothing can). A `?surface=` window's own
 * resolution still wins over this default.
 *
 * t337: the pair need not be a fleet engine — Settings "custom engine" stores any http(s)
 * REST + MCP pair here, with `engineUrn` as an OPTIONAL label. Without the label the
 * frame is stamped with what the engine itself reports, or as an unidentified engine.
 */
export interface PilotEngineConfig {
  engineUrl?: string;
  mcpBaseUrl?: string;
  engineUrn?: string;
}

/**
 * The stored shape, or null when the value is not an actionable override. Exported (t337)
 * so the Settings custom-engine inputs are validated by the SAME rule storage is read
 * with — the form cannot offer to save something this would then drop. t342: URLs and the
 * urn label go through transform.js `normalizeBaseUrl` / `isKernelUrn`.
 */
export function normalizeEngineConfig(value: unknown): PilotEngineConfig | null {
  if (!value || typeof value !== "object") return null;
  const cfg = value as Record<string, unknown>;
  const out: PilotEngineConfig = {};
  const engineUrl = normalizeBaseUrl(cfg.engineUrl);
  const mcpBaseUrl = normalizeBaseUrl(cfg.mcpBaseUrl);
  if (engineUrl) out.engineUrl = engineUrl;
  if (mcpBaseUrl) out.mcpBaseUrl = mcpBaseUrl;
  if (isKernelUrn(cfg.engineUrn)) out.engineUrn = cfg.engineUrn as string;
  // An override without BOTH transports is not actionable — treat as unset.
  return out.engineUrl && out.mcpBaseUrl ? out : null;
}

/** Read the stored default-engine override, or null (= the build-time localhost default). */
export async function loadPilotEngine(): Promise<PilotEngineConfig | null> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const got = await chrome.storage.local.get(STORAGE_ENGINE_KEY);
      return normalizeEngineConfig(got?.[STORAGE_ENGINE_KEY]);
    }
  } catch {
    // storage unavailable (served harness) -> no override
  }
  return null;
}

/**
 * Write (or, with null, clear) the default-engine override. The worker's
 * storage.onChanged listener drops its adapter memo so the next GET_FRAME rebuilds
 * against the new default.
 */
export async function savePilotEngine(cfg: PilotEngineConfig | null): Promise<void> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      // Store the NORMALIZED object, not the caller's — so storage always matches the
      // shape loadPilotEngine/resolveAdapterConfig consume (no extra fields, no invalid
      // urn riding along). Copilot PR #41 review catch.
      const normalized = cfg ? normalizeEngineConfig(cfg) : null;
      if (normalized) {
        await chrome.storage.local.set({ [STORAGE_ENGINE_KEY]: normalized });
      } else {
        await chrome.storage.local.remove(STORAGE_ENGINE_KEY);
      }
    }
  } catch {
    // storage unavailable (served harness) -> no-op
  }
}

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
      const got = await chrome.storage.local.get([STORAGE_ACCESS_KEY, STORAGE_ENGINE_KEY]);
      const cfg = got?.[STORAGE_ACCESS_KEY] as { enforcement?: unknown } | undefined;
      if (cfg && cfg.enforcement != null) {
        config.enforcement = normalizeEnforcement(cfg.enforcement);
      }
      // The stored default-engine override (t278). Applied BEFORE surface resolution so
      // a ?surface= window's own verified engine still wins below.
      const engine = normalizeEngineConfig(got?.[STORAGE_ENGINE_KEY]);
      if (engine) {
        config.engineUrl = engine.engineUrl;
        config.mcpBaseUrl = engine.mcpBaseUrl;
        if (engine.engineUrn) config.engineUrn = engine.engineUrn;
      }
    }
  } catch {
    // storage unavailable -> default (client-presentation) tier
  }
  if (surfaceKey) {
    try {
      const resolved = await resolveSurfaceEngine(surfaceKey, {
        directoryUrl: config.engineUrl,
      });
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

  // Cloudflare Access: attach the service token IFF this engine is reached through the
  // tunnel. cfAccessHeadersFor() returns {} for localhost/Tailscale, so a LAN engine is
  // byte-identical to before and the credential never leaves the machine for a host that
  // is not behind Access. Single injection point — every caller resolves through here.
  //
  // t337: the adapter sends these headers to BOTH endpoints, and a Settings "custom engine"
  // pair can name two different hosts (a fleet pair never did). The pair is therefore
  // attached only when the MCP host is behind Access as well; a mixed pair gets none, and
  // its tunnel-side read fails at the edge instead of the secret reaching the other host.
  try {
    const cf = await loadCfAccess();
    const headers = cfAccessHeadersFor(config.engineUrl ?? "", cf);
    if (Object.keys(headers).length > 0 && isCloudHost(config.mcpBaseUrl ?? "")) {
      config.accessHeaders = headers;
    }
  } catch {
    // no token / no storage -> unauthenticated, exactly as before
  }

  return config;
}
