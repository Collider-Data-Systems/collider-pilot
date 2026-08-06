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
 * Transport is deliberately NOT parsed from the hint alone: the port maps through
 * explicit tables (localhost + the fleet's tailnet addresses — the same addresses the
 * tracked topology routes on; host_permissions cover both since t278). Candidates are
 * probed in preference order and the first engine that SELF-reports the expected
 * kernel_urn is kept, so the same build reads a Z440 twin over localhost on the Z440
 * seat and over the tailnet from hp-laptop / hpprodesk. A surface whose engine verifies
 * on no candidate resolves its IDENTITY but not a transport — the adapter then keeps
 * the default engine and the mismatch warning states honestly that the window is not
 * reading the engine its label names.
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
 *   transport_candidates?: Array<{ engineUrl: string, mcpBaseUrl: string }>,
 * }} SurfaceEngineResolution
 */

/**
 * Documented launcher key shape (worker.ts SURFACE_ROOM uses the same pattern —
 * case-SENSITIVE, every launcher key is lowercase).
 */
export const SURFACE_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * The workstation whose engines this build historically preferred on localhost. Kept as
 * the localhost-FIRST candidate host (the Z440 seat keeps reading its own twins over
 * localhost, byte-for-byte as before); every other fleet host prefers its tailnet
 * address. Verification — not this constant — decides what is actually read (see
 * `resolveSurfaceEngine`).
 */
export const SEAT_WORKSTATION_HOST = "hp-z440";

/**
 * REST port -> MCP port. The twins do NOT follow the primary's :8080 MCP convention
 * (they answer MCP on :9001-:9003), so the mapping is a table, not arithmetic. Mirrors
 * the tracked federation topology; becomes HG data the day the channel schema grows a
 * resolvable engine pointer.
 * @type {Record<number, number>}
 */
export const REST_TO_MCP_PORT = {
  8000: 8080,
  8001: 9001,
  8002: 9002,
  8003: 9003,
};

/**
 * Fleet workstations -> tailnet address (the federation's own substrate — the same
 * addresses the tracked topology file routes on). This is what makes every engine
 * addressable from every seat: a `?surface=` window on hpprodesk can read a Z440 twin,
 * and the docked panel can default to any fleet engine (goal t278: all workspaces on
 * all engines, from any box; the A3 access posture — not the transport — decides what
 * a user may SEE).
 * @type {Record<string, string>}
 */
export const FLEET_WORKSTATION_HOSTS = {
  "hp-z440": "100.82.243.13",
  "hp-laptop": "100.106.220.58",
  hpprodesk: "100.87.28.95",
};

/** @typedef {{ engineUrl: string, mcpBaseUrl: string }} EngineTransport */

/** Build the localhost transport pair for a mapped REST port, or null. */
function localhostTransport(port) {
  const mcpPort = REST_TO_MCP_PORT[port];
  if (!mcpPort) return null;
  return {
    engineUrl: `http://localhost:${port}`,
    mcpBaseUrl: `http://localhost:${mcpPort}`,
  };
}

/** Build the tailnet transport pair for a fleet host + mapped REST port, or null. */
function tailnetTransport(host, port) {
  const ip = FLEET_WORKSTATION_HOSTS[host];
  const mcpPort = REST_TO_MCP_PORT[port];
  if (!ip || !mcpPort) return null;
  return {
    engineUrl: `http://${ip}:${port}`,
    mcpBaseUrl: `http://${ip}:${mcpPort}`,
  };
}

/**
 * Ordered transport candidates for an engine hint: the PREFERRED transport first
 * (localhost for the historical localhost seat, tailnet for every other fleet host),
 * then the alternative. `resolveSurfaceEngine` probes them in order and keeps the first
 * one whose engine SELF-reports the expected kernel_urn — so the order is a preference,
 * never an authority.
 * @param {{ host: string, port: number }} hint
 * @returns {EngineTransport[]}
 */
export function transportCandidates(hint) {
  const local = localhostTransport(hint.port);
  const tail = tailnetTransport(hint.host, hint.port);
  const ordered =
    hint.host === SEAT_WORKSTATION_HOST ? [local, tail] : [tail, local];
  return ordered.filter(Boolean);
}

/**
 * Back-compat view of the localhost pairs (previous consumers imported this table).
 * @type {Record<number, EngineTransport>}
 */
export const LOCAL_ENGINE_TRANSPORTS = Object.fromEntries(
  Object.keys(REST_TO_MCP_PORT).map((p) => [p, localhostTransport(Number(p))]),
);

/**
 * The fleet engine directory for pickers (Settings "engine" section): every engine the
 * tracked topology names, with its tailnet transport. Static mirror of the topology
 * file, same status as the port table above.
 * @type {Array<{ engineUrn: string, label: string, engineUrl: string, mcpBaseUrl: string }>}
 */
export const FLEET_ENGINES = [
  { host: "hp-z440", leaf: "primary", port: 8000, label: "Z440 primary" },
  { host: "hp-z440", leaf: "menno", port: 8001, label: "Z440 twin menno" },
  { host: "hp-z440", leaf: "lola", port: 8002, label: "Z440 twin lola" },
  { host: "hp-z440", leaf: "moos", port: 8003, label: "Z440 twin moos" },
  { host: "hp-laptop", leaf: "primary", port: 8000, label: "Laptop primary" },
  { host: "hpprodesk", leaf: "primary", port: 8000, label: "ProDesk primary" },
].map((e) => ({
  engineUrn: `urn:moos:kernel:${e.host}.${e.leaf}`,
  label: e.label,
  ...tailnetTransport(e.host, e.port),
}));

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
  const candidates = transportCandidates(hint);
  const preferred = candidates[0];
  return {
    surface: surfaceKey,
    channel_urn: channelUrn,
    engine_urn: hint.engineUrn,
    engine_url: preferred ? preferred.engineUrl : null,
    mcp_base_url: preferred ? preferred.mcpBaseUrl : null,
    reachable: Boolean(preferred),
    transport_candidates: candidates,
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
 * The canonical channel directory: the Z440 primary fold, where the t266 channel batch
 * lives. A seat whose OWN default engine has no channel nodes (laptop, hpprodesk — their
 * sovereign folds are not the directory) falls back to reading the directory here, so a
 * `?surface=` window resolves fleet-wide instead of only on the Z440 seat.
 */
export const CANONICAL_DIRECTORY_URL = `http://${FLEET_WORKSTATION_HOSTS["hp-z440"]}:8000`;

/**
 * Probe one transport candidate: does the engine at `engineUrl` SELF-report the expected
 * kernel_urn? (The A6 /healthz surface — the same authority the mismatch warning reads.)
 * @param {string} engineUrl
 * @param {string} expectedUrn
 * @returns {Promise<boolean>}
 */
async function probeTransport(engineUrl, expectedUrn) {
  try {
    const res = await fetch(`${engineUrl.replace(/\/$/, "")}/healthz`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false;
    const health = await res.json();
    return health?.kernel_urn === expectedUrn;
  } catch {
    return false;
  }
}

/**
 * Full runtime resolution: surface key -> channel node (directory read) -> engine ->
 * VERIFIED transport. Candidates are probed in preference order and the first engine
 * that self-reports the expected kernel_urn wins — so the same build resolves a Z440
 * twin over localhost on the Z440 seat and over the tailnet from any other seat. When
 * no candidate verifies (engine down, tailnet down) the resolution keeps the engine
 * IDENTITY but no transport (reachable: false) — the adapter stays on the default
 * engine and the mismatch warning states it honestly, exactly as before.
 *
 * Returns null when the key is invalid, no candidate channel exists (on any directory),
 * or the room names no engine — all of which mean "keep the default engine".
 * @param {string} surfaceKey
 * @param {{
 *   directoryUrl?: string,
 *   readNode?: (urn: string) => Promise<any | null>,
 *   probe?: (engineUrl: string, expectedUrn: string) => Promise<boolean>,
 * }} [opts]
 * @returns {Promise<SurfaceEngineResolution | null>}
 */
export async function resolveSurfaceEngine(surfaceKey, opts) {
  const probe = opts?.probe ?? probeTransport;
  // Directory candidates: the configured/default engine first (unchanged behavior on the
  // Z440 seat), then the canonical Z440 directory for every other seat.
  const primary = (opts?.directoryUrl || DEFAULT_ENGINE_URL).replace(/\/$/, "");
  const directories = [...new Set([primary, CANONICAL_DIRECTORY_URL])];
  const readNode =
    opts?.readNode ??
    (async (urn) => {
      for (const dir of directories) {
        const node = await readDirectoryNode(urn, dir);
        if (node) return node;
      }
      return null;
    });
  for (const channelUrn of channelUrnCandidates(surfaceKey)) {
    const rawNode = await readNode(channelUrn);
    if (!rawNode) continue;
    const resolution = resolutionFromChannelNode(surfaceKey, channelUrn, rawNode);
    if (!resolution) {
      return null; // the channel EXISTS but names no engine — an engine-less room, not a miss
    }
    // Verify candidates in preference order; first self-reporting engine wins.
    for (const t of resolution.transport_candidates ?? []) {
      if (await probe(t.engineUrl, resolution.engine_urn)) {
        return {
          ...resolution,
          engine_url: t.engineUrl,
          mcp_base_url: t.mcpBaseUrl,
          reachable: true,
        };
      }
    }
    // No candidate verified: identity resolved, no transport — the honest-mismatch path.
    return { ...resolution, engine_url: null, mcp_base_url: null, reachable: false };
  }
  return null;
}
