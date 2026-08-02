/**
 * Collider Pilot - surface_key -> channel -> engine resolution (A16, SHARED)
 * ==========================================================================
 * The t266 batch minted one `urn:moos:channel:virtual-desktop.<surface_key>` node per
 * generated Z440 window. This module is that batch's first CONSUMER: given the
 * `?surface=<key>` the launcher put in the panel's own URL, it resolves WHICH engine the
 * window should read — at RUNTIME, from the channel node — instead of every window
 * inheriting the build-time primary default (the wrong-fold defect: desktops labelled
 * menno/lola/moos rendering hp-z440.primary data).
 *
 * Resolution chain:  surface_key -> channel node (directory read) -> engine hint -> config.
 *
 *   1. The channel node is read from the DIRECTORY engine (the build-time default primary),
 *      via the read-only REST `GET /state/nodes/{urn}`. The primary fold is where the t266
 *      channels live; it acts as the directory.
 *   2. The channel carries no resolvable engine pointer yet — only its `display_name`
 *      (e.g. "Z440 desktop 2: my-tiny-data-collider.hp-z440.menno :8001"). The engine HINT
 *      (host, kernel leaf, REST port) is parsed from it. The hint is just a hint:
 *   3. The AUTHORITY is the target engine's own `/healthz` `kernel_urn` (the A6 surface,
 *      live fleet-wide since t274). The adapter reads it on every frame; the transform
 *      stamps it as `provenance.engine_reported`, and the panel renders a MISMATCH warning
 *      whenever the surface's expected engine differs from what the connected engine
 *      reports. A hint gone stale therefore degrades to a VISIBLE warning, never to
 *      silently-wrong data.
 *
 * Transport is deliberately NOT parsed from the hint alone: only engines local to THIS
 * seat's workstation (hp-z440) are reachable from the extension (host_permissions are
 * localhost-only), so the port maps through an explicit local table. A surface whose
 * channel names another workstation's engine (hp-laptop / hpprodesk desktops) resolves its
 * IDENTITY but not a transport — the adapter then keeps the default engine and the
 * mismatch warning states honestly that the window is not reading the engine its label
 * names.
 *
 * Shared JS + JSDoc (same discipline as transform.js): no DOM, no chrome.*; the network
 * read is INJECTED, so Node (scripts/live-smoke.mjs) exercises the identical code.
 *
 * READ-ONLY: the only endpoint ever named is `GET /state/nodes/{urn}`. No rewrite exists
 * here.
 */

import { DEFAULT_ENGINE_URL } from "./transform.js";

/**
 * @typedef {{
 *   surface: string,
 *   channel_urn: string,
 *   engine_urn: string,
 *   engine_url: string | null,
 *   mcp_base_url: string | null,
 *   reachable: boolean,
 * }} SurfaceEngineResolution
 */

/**
 * Documented launcher key shape (worker.ts SURFACE_ROOM uses the same pattern —
 * case-SENSITIVE, every launcher key is lowercase).
 */
export const SURFACE_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The workstation this seat runs on: only ITS engines are localhost-reachable. */
export const SEAT_WORKSTATION_HOST = "hp-z440";

/**
 * REST port -> endpoints for the engines local to this workstation. The twins do NOT
 * follow the primary's :8080 MCP convention (they answer MCP on :9001-:9003), so the
 * mapping is a table, not arithmetic. Mirrors the tracked federation topology; becomes
 * HG data the day the channel schema grows a resolvable engine pointer.
 * @type {Record<number, { engineUrl: string, mcpBaseUrl: string }>}
 */
export const LOCAL_ENGINE_TRANSPORTS = {
  8000: { engineUrl: "http://localhost:8000", mcpBaseUrl: "http://localhost:8080" },
  8001: { engineUrl: "http://localhost:8001", mcpBaseUrl: "http://localhost:9001" },
  8002: { engineUrl: "http://localhost:8002", mcpBaseUrl: "http://localhost:9002" },
  8003: { engineUrl: "http://localhost:8003", mcpBaseUrl: "http://localhost:9003" },
};

/**
 * Channel urns to try for a surface key, most specific first. The launcher's tracked keys
 * are already channel-exact (`z440-menno`), but the bare twin form (`menno`) is accepted
 * as an alias so a hand-launched `?surface=menno` window still resolves.
 * @param {string} surfaceKey
 * @returns {string[]}
 */
export function channelUrnCandidates(surfaceKey) {
  const key = String(surfaceKey || "").trim();
  if (!SURFACE_KEY_PATTERN.test(key)) return [];
  const candidates = [`urn:moos:channel:virtual-desktop.${key}`];
  if (!key.startsWith("z440-")) {
    candidates.push(`urn:moos:channel:virtual-desktop.z440-${key}`);
  }
  return candidates;
}

/**
 * Parse the engine HINT out of a channel display_name. The recognised shape is the tracked
 * manifest's "... <host>.<kernel-leaf> :<port>" tail (lowercase, as every kernel urn is);
 * a room with no engine (the manifold/collective desktops) simply parses to null.
 * @param {unknown} displayName
 * @returns {{ host: string, leaf: string, port: number, engineUrn: string } | null}
 */
export function parseEngineHint(displayName) {
  if (typeof displayName !== "string") return null;
  const m = displayName.match(/([a-z0-9][a-z0-9-]*)\.([a-z0-9][a-z0-9-]*)\s*:(\d{2,5})(?!\d)/);
  if (!m) return null;
  const host = m[1];
  const leaf = m[2];
  const port = Number(m[3]);
  return { host, leaf, port, engineUrn: `urn:moos:kernel:${host}.${leaf}` };
}

/**
 * Pure step: raw wrapped channel node -> resolution (or null when the room names no
 * engine). Split from the network read so the smoke harness can drive it with fixtures.
 * @param {string} surfaceKey
 * @param {string} channelUrn
 * @param {{ properties?: Record<string, { value?: unknown }> } | null | undefined} rawNode
 * @returns {SurfaceEngineResolution | null}
 */
export function resolutionFromChannelNode(surfaceKey, channelUrn, rawNode) {
  const displayName = rawNode?.properties?.display_name?.value;
  const hint = parseEngineHint(displayName);
  if (!hint) return null;
  const transport =
    hint.host === SEAT_WORKSTATION_HOST ? LOCAL_ENGINE_TRANSPORTS[hint.port] : undefined;
  return {
    surface: surfaceKey,
    channel_urn: channelUrn,
    engine_urn: hint.engineUrn,
    engine_url: transport ? transport.engineUrl : null,
    mcp_base_url: transport ? transport.mcpBaseUrl : null,
    reachable: Boolean(transport),
  };
}

/**
 * Read one raw node from the directory engine, or null on any failure (absent node,
 * engine down, timeout). Best-effort by design: a failed directory read must degrade to
 * the default engine, never to a dead window.
 * @param {string} urn
 * @param {string} [directoryUrl]
 * @returns {Promise<any | null>}
 */
async function readDirectoryNode(urn, directoryUrl) {
  const base = (directoryUrl || DEFAULT_ENGINE_URL).replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/state/nodes/${encodeURIComponent(urn)}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const parsed = await res.json();
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Full runtime resolution: surface key -> channel node (directory read) -> engine.
 * Returns null when the key is invalid, no candidate channel exists, the room names no
 * engine, or the directory is unreachable — all of which mean "keep the default engine".
 * @param {string} surfaceKey
 * @param {{ directoryUrl?: string, readNode?: (urn: string) => Promise<any | null> }} [opts]
 * @returns {Promise<SurfaceEngineResolution | null>}
 */
export async function resolveSurfaceEngine(surfaceKey, opts) {
  const readNode =
    opts?.readNode ?? ((urn) => readDirectoryNode(urn, opts?.directoryUrl));
  for (const channelUrn of channelUrnCandidates(surfaceKey)) {
    const rawNode = await readNode(channelUrn);
    if (!rawNode) continue;
    const resolution = resolutionFromChannelNode(surfaceKey, channelUrn, rawNode);
    if (resolution) return resolution;
    return null; // the channel EXISTS but names no engine — an engine-less room, not a miss
  }
  return null;
}
