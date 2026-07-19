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
 */

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
  return {
    purpose: vf.purpose ?? DEFAULT_PURPOSE_URN,
    scope_urns:
      Array.isArray(vf.scope_urns) && vf.scope_urns.length > 0
        ? vf.scope_urns.slice()
        : [DEFAULT_SCOPE_URN],
    t: typeof vf.t === "number" ? vf.t : tDay,
    types:
      Array.isArray(vf.types) && vf.types.length > 0
        ? vf.types.slice()
        : DEFAULT_FRAME_TYPES.slice(),
    // whether the caller explicitly pinned t (drives conservative t-filtering below)
  };
}

/**
 * Client-side selection L_p over the full mapped frame:
 *   1. type filter (retain nodes whose type_id is in `types`; empty types = all types)
 *   2. scope: if any scope urn resolves, retain scope urns + their 1-hop relation
 *      neighbourhood; otherwise fall back to the whole type slice
 *   3. optional t bound: only when the caller PINNED t, drop nodes whose numeric `t_day`
 *      property exceeds t (a lightweight stand-in until the engine exposes fold-at-t)
 *   4. retain only relations whose BOTH endpoints survive
 *
 * @param {HgNode[]} nodes
 * @param {HgRelation[]} relations
 * @param {ViewFilter} viewFilter
 * @param {boolean} tPinned
 * @returns {{ nodes: HgNode[], relations: HgRelation[] }}
 */
export function applyViewFilter(nodes, relations, viewFilter, tPinned) {
  const typeSet = new Set(viewFilter.types);
  const allTypes = typeSet.size === 0;
  const nodeByUrn = new Map(nodes.map((n) => [n.urn, n]));

  const scope = viewFilter.scope_urns.filter((u) => nodeByUrn.has(u));

  /** @type {Set<string>} */
  let inScope;
  if (scope.length > 0) {
    inScope = new Set(scope);
    for (const r of relations) {
      if (scope.includes(r.source_urn)) inScope.add(r.target_urn);
      if (scope.includes(r.target_urn)) inScope.add(r.source_urn);
    }
  } else {
    // No resolvable scope anchor: fall back to the whole type slice.
    inScope = new Set(nodes.map((n) => n.urn));
  }

  const keptNodes = nodes.filter((n) => {
    if (!allTypes && !typeSet.has(n.type_id)) return false;
    if (!inScope.has(n.urn)) return false;
    if (tPinned) {
      const td = n.properties.t_day;
      if (typeof td === "number" && td > viewFilter.t) return false;
    }
    return true;
  });

  const keptUrns = new Set(keptNodes.map((n) => n.urn));
  const keptRelations = relations.filter(
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
  const { nodes, relations } = applyViewFilter(
    allNodes,
    allRelations,
    viewFilter,
    tPinned,
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
