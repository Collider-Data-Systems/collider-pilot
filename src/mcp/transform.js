/**
 * Collider Pilot - pure fold -> HgFrame transform (Phase 2, SHARED)
 * =================================================================
 * The single, side-effect-free heart of the live read path. Given the RAW fold that
 * the mo:os engine returns from the `graph_state` MCP tool (plus a `/healthz` reading),
 * it produces a typed `HgFrame`:
 *
 *   - unwraps the wrapped property bags   properties[k] = {value, mutability, ...} -> value
 *   - maps engine nodes     -> HgNode      {urn, type_id, label, properties}
 *   - maps engine relations -> HgRelation  {urn, type_id(=WFxx), label(=port kind), src, tgt}
 *   - applies the client-side `view_filter` selection L_p (types + scope neighbourhood + t)
 *   - builds the provenance header from /healthz + the view_filter + engine config
 *
 * This module has NO network, NO DOM, NO chrome.* — it is plain data-in/data-out so the
 * exact same code runs in the MV3 service worker (via StreamableHttpMcpAdapter) and in
 * `scripts/live-smoke.mjs` under Node. The smoke test therefore exercises the real
 * transform, not a copy.
 *
 * It is authored in JS + JSDoc (not .ts) precisely so Node can import it directly with
 * no build step while `tsc` still type-resolves it for the TypeScript adapter.
 *
 * READ-ONLY: nothing here emits or references a rewrite. No ADD/LINK/MUTATE/UNLINK.
 *
 * @typedef {import("./types").HgFrame} HgFrame
 * @typedef {import("./types").HgNode} HgNode
 * @typedef {import("./types").HgRelation} HgRelation
 * @typedef {import("./types").HgProperties} HgProperties
 * @typedef {import("./types").HgPropertyValue} HgPropertyValue
 * @typedef {import("./types").ViewFilter} ViewFilter
 * @typedef {import("./types").FrameRequest} FrameRequest
 * @typedef {import("./types").FrameProvenance} FrameProvenance
 * @typedef {import("./types").AccessScope} AccessScope
 * @typedef {import("./types").AccessResolution} AccessResolution
 */

import { resolveAccess, accessKeepSet } from "./access.js";

/**
 * A single wrapped property value as the engine serialises it.
 * @typedef {{ value: unknown, mutability?: string, authority_scope?: string, stratum_origin?: number }} WrappedProperty
 */
/**
 * A node as `graph_state` returns it (properties still wrapped; created_at/version at top level).
 * @typedef {{ urn: string, type_id: string, properties?: Record<string, WrappedProperty>, created_at?: string, version?: number }} RawNode
 */
/**
 * A relation as `graph_state` returns it.
 * @typedef {{ urn: string, rewrite_category?: string, src_urn: string, src_port?: string, tgt_urn: string, tgt_port?: string, created_at?: string }} RawRelation
 */
/**
 * The parsed fold: nodes and relations keyed by urn.
 * @typedef {{ nodes: Record<string, RawNode>, relations: Record<string, RawRelation> }} RawFold
 */
/**
 * The `/healthz` reading used to stamp provenance.
 * @typedef {{ log_len?: number, max_log_seq?: number, t_day?: number, ontology_version?: string, status?: string }} Healthz
 */

/** Canonical engine identity/endpoints (defaults; overridable by the adapter). */
export const DEFAULT_ENGINE_URN = "urn:moos:kernel:hp-z440.primary";
export const DEFAULT_MCP_BASE_URL = "http://localhost:8080";
export const DEFAULT_ENGINE_URL = "http://localhost:8000";

/** Node types the default frame retains (matches the Phase 1 mock's shape). */
export const DEFAULT_FRAME_TYPES = [
  "knowledge_item",
  "derivation",
  "purpose",
  "session",
];

/** Default selection anchors — the live Cowork seat, so the UI stays continuous with Phase 1. */
export const DEFAULT_SCOPE_URN = "urn:moos:session:sam.z440-cowork-workspace";
export const DEFAULT_PURPOSE_URN = "urn:moos:purpose:sam.cowork-workspace-curation";

const MAX_LABEL_LEN = 60;

/**
 * Coerce a possibly-nested property value down to a JSON scalar (HgProperties is
 * scalar-only for storage round-trips). Objects/arrays are stringified, not dropped.
 * @param {unknown} v
 * @returns {HgPropertyValue}
 */
function toScalar(v) {
  if (v === null || v === undefined) return null;
  const t = typeof v;
  if (t === "string" || t === "number" || t === "boolean") {
    return /** @type {HgPropertyValue} */ (v);
  }
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * Unwrap `{value, mutability, ...}` bags to a flat scalar HgProperties, then enrich with
 * the top-level `created_at` / `version` the engine keeps outside the property bag.
 * @param {RawNode} raw
 * @returns {HgProperties}
 */
export function unwrapProperties(raw) {
  /** @type {HgProperties} */
  const out = {};
  const props = raw.properties || {};
  for (const k of Object.keys(props)) {
    const bag = props[k];
    out[k] = toScalar(bag ? bag.value : undefined);
  }
  if (raw.created_at != null && out.created_at == null) {
    out.created_at = String(raw.created_at);
  }
  if (raw.version != null && out.version == null) {
    out.version = typeof raw.version === "number" ? raw.version : String(raw.version);
  }
  return out;
}

/**
 * Short human label for the graph: prefer a human property, else the last urn segment.
 * @param {RawNode} raw
 * @returns {string}
 */
export function labelForNode(raw) {
  const props = raw.properties || {};
  /** @param {string} k */
  const pick = (k) => {
    const bag = props[k];
    const v = bag ? bag.value : undefined;
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const human = pick("label") || pick("title") || pick("name");
  const chosen = human || raw.urn.split(":").pop() || raw.urn;
  return chosen.length > MAX_LABEL_LEN
    ? chosen.slice(0, MAX_LABEL_LEN - 1) + "…"
    : chosen;
}

/**
 * Map a raw engine node to the typed frame node.
 * @param {RawNode} raw
 * @returns {HgNode}
 */
export function mapNode(raw) {
  return {
    urn: raw.urn,
    type_id: raw.type_id,
    label: labelForNode(raw),
    properties: unwrapProperties(raw),
  };
}

/**
 * Map a raw engine relation to the typed frame relation.
 * `type_id` carries the rewrite_category (WFxx); `label` is the relation kind (the port).
 * @param {RawRelation} raw
 * @returns {HgRelation}
 */
export function mapRelation(raw) {
  return {
    urn: raw.urn,
    type_id: raw.rewrite_category || "WF00",
    label: raw.src_port || raw.tgt_port || raw.rewrite_category || "relation",
    source_urn: raw.src_urn,
    target_urn: raw.tgt_urn,
    properties: {
      src_port: raw.src_port ?? null,
      tgt_port: raw.tgt_port ?? null,
      created_at: raw.created_at ?? null,
    },
  };
}

/**
 * Parse the JSON-RPC `tools/call` result for `graph_state` into a RawFold.
 * The engine wraps the fold as stringified JSON inside result.content[0].text.
 * @param {unknown} rpcResult - the full `{jsonrpc,id,result:{content:[...]}}` object
 * @returns {RawFold}
 */
export function parseGraphStateResult(rpcResult) {
  const r = /** @type {any} */ (rpcResult);
  if (r && r.error) {
    throw new Error(`graph_state RPC error: ${r.error.message ?? JSON.stringify(r.error)}`);
  }
  const text = r?.result?.content?.[0]?.text;
  if (typeof text !== "string") {
    throw new Error("graph_state result missing content[0].text");
  }
  const fold = JSON.parse(text);
  return {
    nodes: fold.nodes ?? {},
    relations: fold.relations ?? {},
  };
}

/**
 * Parse the JSON-RPC `tools/call` result for `node_lookup` into a mapped HgNode.
 * @param {unknown} rpcResult
 * @returns {HgNode}
 */
export function parseNodeLookupResult(rpcResult) {
  const r = /** @type {any} */ (rpcResult);
  if (r && r.error) {
    throw new Error(`node_lookup RPC error: ${r.error.message ?? JSON.stringify(r.error)}`);
  }
  const text = r?.result?.content?.[0]?.text;
  if (typeof text !== "string") {
    throw new Error("node_lookup result missing content[0].text");
  }
  return mapNode(JSON.parse(text));
}

/**
 * Resolve the effective ViewFilter from defaults + an optional FrameRequest, stamping
 * the fold time `t` from /healthz when the caller did not pin one.
 * @param {FrameRequest | undefined} request
 * @param {Healthz} healthz
 * @returns {ViewFilter}
 */
export function resolveViewFilter(request, healthz) {
  const vf = (request && request.view_filter) || {};
  const tDay = typeof healthz.t_day === "number" ? healthz.t_day : 0;
  // t264: `types: ["*"]` is the ALL-TYPES sentinel (the "everything" lens). An empty
  // typeSet already means "all" in applyViewFilter; the sentinel exists because an
  // EMPTY types array falls back to the default slice for backward compatibility.
  const rawTypes =
    Array.isArray(vf.types) && vf.types.length > 0
      ? vf.types.slice()
      : DEFAULT_FRAME_TYPES.slice();
  const types = rawTypes.includes("*") ? [] : rawTypes;
  return {
    purpose: vf.purpose ?? DEFAULT_PURPOSE_URN,
    // SEAT-GROUNDED (de-hardcoded): the DEFAULT scope is now EMPTY — nothing is pinned to a
    // literal seat urn. Empty scope_urns ⇒ applyViewFilter narrows by nothing, so the frame shows
    // ALL permitted-workspace nodes (the access gate is the only narrowing). The previous default
    // pinned `sam.z440-cowork-workspace`, which — being outside the under-resolved permitted set —
    // dropped Sam's own workspace node out of the view. The scope SELECTOR (GraphControls) sets
    // scope_urns=[seat] to focus one seat on demand; [] (this default) means "All permitted".
    scope_urns:
      Array.isArray(vf.scope_urns) && vf.scope_urns.length > 0
        ? vf.scope_urns.slice()
        : [],
    t: typeof vf.t === "number" ? vf.t : tDay,
    types,
    // access rides inside view_filter. Carried through verbatim: the identity was already
    // worker-injected upstream (src/worker.ts). undefined ⇒ no access gate (backward-compatible).
    access: vf.access,
    // t264 slice controls (all optional, all backward-compatible):
    // ports: relation port names retained ([] = all); scope_hops: BFS depth from the
    // scope urns (clamped 1..4); lens: provenance echo of the preset name, never law.
    ports: Array.isArray(vf.ports) ? vf.ports.slice() : [],
    scope_hops: Math.min(4, Math.max(1, typeof vf.scope_hops === "number" ? Math.floor(vf.scope_hops) : 1)),
    ...(typeof vf.lens === "string" && vf.lens ? { lens: vf.lens } : {}),
  };
}

/**
 * Client-side selection L_p over the full mapped frame:
 *   1. type filter (retain nodes whose type_id is in `types`; empty types = all types)
 *   2. scope: if any scope urn resolves, retain scope urns + their 1-hop relation
 *      neighbourhood; otherwise fall back to the whole type slice
 *   3. optional t bound: only when the caller PINNED t, drop nodes whose numeric `t_day`
 *      property exceeds t (a lightweight stand-in until the engine exposes fold-at-t).
 *      MEASURED CAVEAT (t264): on the live Z440 fold only 7 of 288 nodes carry a numeric
 *      `t_day` at all, so this bound can only ever remove those - t=200 drops nothing,
 *      t=1 drops 7. It is NOT a fold-at-t projection and must not be presented as one.
 *      The kernel DOES expose a real one, `GET /fold?to=<log_seq>` (replay log[0..seq]),
 *      but that axis is log SEQUENCE, not t_day, and the MCP read path this adapter uses
 *      (`graph_state`) has no equivalent parameter - wiring it is a separate feature.
 *   4. retain only relations whose BOTH endpoints survive
 *
 * The ACCESS GATE (A3) is composed AFTER the type/scope/t selection: when `accessKeep` is
 * provided, a node additionally survives only if its urn is in that keep-set (computed once
 * by access.js over the FULL fold). `accessKeep === null/undefined` ⇒ no access scope ⇒ the
 * gate is a no-op (fully backward-compatible). Relations survive iff BOTH endpoints do.
 *
 * @param {HgNode[]} nodes
 * @param {HgRelation[]} relations
 * @param {ViewFilter} viewFilter
 * @param {boolean} tPinned
 * @param {Set<string>} [accessKeep] - access keep-set over the full fold, or undefined for no gate
 * @returns {{ nodes: HgNode[], relations: HgRelation[] }}
 */
export function applyViewFilter(nodes, relations, viewFilter, tPinned, accessKeep) {
  const typeSet = new Set(viewFilter.types);
  const allTypes = typeSet.size === 0;
  const nodeByUrn = new Map(nodes.map((n) => [n.urn, n]));

  // t264 ports filter: which RELATIONS render (by port label; [] = all). Scope
  // expansion below walks only these — what you expand along is what you see.
  const portList = Array.isArray(viewFilter.ports) ? viewFilter.ports : [];
  const portSet = new Set(portList);
  const allPorts = portSet.size === 0;
  const visibleRelations = allPorts
    ? relations
    : relations.filter((r) => portSet.has(r.label));

  const scope = viewFilter.scope_urns.filter((u) => nodeByUrn.has(u));

  /** @type {Set<string>} */
  let inScope;
  if (scope.length > 0) {
    // t264: N-hop BFS neighborhood (was fixed 1-hop). Each hop adds the endpoints of
    // every visible relation touching the current frontier.
    const hops = Math.min(4, Math.max(1, typeof viewFilter.scope_hops === "number" ? viewFilter.scope_hops : 1));
    inScope = new Set(scope);
    let frontier = new Set(scope);
    for (let hop = 0; hop < hops && frontier.size > 0; hop++) {
      /** @type {Set<string>} */
      const next = new Set();
      for (const r of visibleRelations) {
        if (frontier.has(r.source_urn) && !inScope.has(r.target_urn)) next.add(r.target_urn);
        if (frontier.has(r.target_urn) && !inScope.has(r.source_urn)) next.add(r.source_urn);
      }
      for (const u of next) inScope.add(u);
      frontier = next;
    }
  } else {
    // No resolvable scope anchor: fall back to the whole type slice.
    inScope = new Set(nodes.map((n) => n.urn));
  }

  const keptNodes = nodes.filter((n) => {
    if (!allTypes && !typeSet.has(n.type_id)) return false;
    if (!inScope.has(n.urn)) return false;
    if (accessKeep && !accessKeep.has(n.urn)) return false; // access gate (composed last)
    if (tPinned) {
      const td = n.properties.t_day;
      if (typeof td === "number" && td > viewFilter.t) return false;
    }
    return true;
  });

  const keptUrns = new Set(keptNodes.map((n) => n.urn));
  const keptRelations = visibleRelations.filter(
    (r) => keptUrns.has(r.source_urn) && keptUrns.has(r.target_urn),
  );

  return { nodes: keptNodes, relations: keptRelations };
}

/**
 * @typedef {Object} SelectFrameOptions
 * @property {Healthz} healthz            - a /healthz reading (log_len, t_day, ontology_version)
 * @property {FrameRequest} [request]     - the caller's view_filter selection
 * @property {string} [engine]            - engine urn (default hp-z440.primary)
 * @property {string} [engineEndpoint]    - human display of the read endpoints
 * @property {string} [foldedAt]          - ISO timestamp; defaults to now
 * @property {AccessResolution} [serverAccess] - a server-computed resolution to trust+echo
 *                                               (future A2); when present the local
 *                                               resolveAccess call is skipped.
 */

/**
 * The end-to-end transform: RAW fold + healthz -> a selected, provenance-stamped HgFrame.
 * This is the function the adapter and the smoke script both call.
 * @param {RawFold} fold
 * @param {SelectFrameOptions} opts
 * @returns {HgFrame}
 */
export function selectFrame(fold, opts) {
  const healthz = opts.healthz || {};
  const engine = opts.engine || DEFAULT_ENGINE_URN;
  const engineEndpoint =
    opts.engineEndpoint ||
    `${DEFAULT_ENGINE_URL} (HTTP) · ${DEFAULT_MCP_BASE_URL} (MCP)`;
  const foldedAt = opts.foldedAt || new Date().toISOString();

  const allNodes = Object.values(fold.nodes || {}).map(mapNode);
  const allRelations = Object.values(fold.relations || {}).map(mapRelation);

  const viewFilter = resolveViewFilter(opts.request, healthz);
  const tPinned = Boolean(
    opts.request && opts.request.view_filter && typeof opts.request.view_filter.t === "number",
  );

  // ACCESS (A3): resolve the permitted-workspace fiber ONCE over the FULL raw fold, BEFORE
  // applyViewFilter narrows types/scope. If a server resolution is already present (future
  // A2), trust+echo it and skip the local call. No access scope ⇒ no gate (backward-compatible).
  /** @type {AccessResolution | undefined} */
  let accessResolution;
  /** @type {Set<string> | undefined} */
  let accessKeep;
  if (opts.serverAccess) {
    accessResolution = opts.serverAccess;
    accessKeep = accessKeepSet(fold, accessResolution);
  } else if (viewFilter.access) {
    accessResolution = resolveAccess(fold, viewFilter.access);
    accessKeep = accessKeepSet(fold, accessResolution);
  }

  const { nodes, relations } = applyViewFilter(
    allNodes,
    allRelations,
    viewFilter,
    tPinned,
    accessKeep,
  );

  // workspace = first in-scope node that is a session; else first scope urn.
  const sessionScope = viewFilter.scope_urns.find(
    (u) => fold.nodes?.[u]?.type_id === "session",
  );
  const workspace = sessionScope || viewFilter.scope_urns[0] || DEFAULT_SCOPE_URN;

  const logSeq =
    typeof healthz.log_len === "number"
      ? healthz.log_len
      : typeof healthz.max_log_seq === "number"
        ? healthz.max_log_seq
        : 0;

  /** @type {FrameProvenance} */
  const provenance = {
    engine,
    engine_endpoint: engineEndpoint,
    log_seq: logSeq,
    t_day: typeof healthz.t_day === "number" ? healthz.t_day : 0,
    workspace,
    purpose: viewFilter.purpose,
    view_filter: viewFilter,
    folded_at: foldedAt,
    ontology_version: healthz.ontology_version || "unknown",
    mock: false,
    // Stamp the derived access fiber (or leave undefined when no access scope was requested).
    ...(accessResolution ? { access: accessResolution } : {}),
  };

  return { provenance, nodes, relations };
}

/**
 * Compact summary of a frame for logs / the smoke test (pure).
 * @param {HgFrame} frame
 * @returns {{ nodeCount: number, relationCount: number, nodesByType: Record<string, number> }}
 */
export function summarizeFrame(frame) {
  /** @type {Record<string, number>} */
  const nodesByType = {};
  for (const n of frame.nodes) {
    nodesByType[n.type_id] = (nodesByType[n.type_id] || 0) + 1;
  }
  return {
    nodeCount: frame.nodes.length,
    relationCount: frame.relations.length,
    nodesByType,
  };
}
