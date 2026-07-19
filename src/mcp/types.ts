/**
 * Collider Pilot - HG frame + MCP adapter contract
 * =================================================
 * Typed shape of a purpose-selected, timestamped HG **frame** projected from an
 * engine, plus the adapter boundary the side panel talks to.
 *
 * A frame is NOT a second graph. It is the selected read of the folded log at a
 * time `t`, per #158:  frame_{p,t} = L_p( fold(log[0..t]) ).
 *
 * PHASE 2 SEAM  — REALISED
 * ------------------------
 * `McpAdapter` is the single seam where the real transport plugs in. Phase 1 shipped
 * `MockMcpAdapter` (fixed fixture, no I/O). Phase 2 adds `StreamableHttpMcpAdapter`
 * (src/mcp/streamable-http-adapter.ts) that speaks MCP Streamable HTTP to the Z440
 * primary engine (:8080 MCP), sets an `Origin` posture, and exposes read-only tools
 * (health / selected frame / node / relation neighborhood). No method signature in this
 * file changed for that swap — only `FrameProvenance.mock` was widened from the literal
 * `true` to `boolean` so a live (non-mock) frame can state `mock: false`. The adapter is
 * selected at runtime by src/mcp/adapter-factory.ts ('mock' | 'live'). Read-only only:
 * no ADD/LINK/MUTATE/UNLINK path exists anywhere in this phase.
 */

/** Node property bag. Kept to JSON-serializable scalars for storage round-trips. */
export type HgPropertyValue = string | number | boolean | null;
export interface HgProperties {
  [key: string]: HgPropertyValue;
}

/**
 * A node in the projected frame. `urn` is the STABLE semantic id and is used
 * verbatim as the Cytoscape node id — never a synthetic/hashed id.
 */
export interface HgNode {
  urn: string;
  type_id: string; // ontology type, e.g. "knowledge_item" | "derivation" | "purpose" | "session"
  label: string; // short human label for the graph
  properties: HgProperties;
}

/**
 * A binary connection between two nodes.
 *
 * TRANSLATION DISCIPLINE (#158): the mo:os vocabulary calls these **relations**.
 * Cytoscape's internal API calls them "edges"; that word stays inside the renderer
 * and never surfaces in the UI. `type_id` carries the rewrite_category (WF01..WF21)
 * or relation kind; `label` is the human relation name shown to the user.
 */
export interface HgRelation {
  urn: string; // stable relation id (used as Cytoscape edge id)
  type_id: string; // rewrite_category / relation kind, e.g. "WF12"
  label: string; // human relation label, e.g. "provides-kb"
  source_urn: string; // source node urn
  target_urn: string; // target node urn
  properties?: HgProperties;
}

/** The purpose/scope/time selection that produced this frame (L_p). */
export interface ViewFilter {
  purpose: string; // purpose urn the frame is colored by
  scope_urns: string[]; // scope pins the selection was bounded to
  t: number; // selection time (t_day / log index)
  types: string[]; // node type_ids retained by the filter
}

/**
 * Provenance header Steinberger requires: every frame states exactly which engine,
 * log position, workspace/session, purpose, and view_filter it came from.
 */
export interface FrameProvenance {
  engine: string; // source engine urn, e.g. "urn:moos:kernel:hp-z440.primary"
  engine_endpoint: string; // human display of the read endpoint
  log_seq: number; // append-only log sequence the fold was taken at
  t_day: number; // MOOS T-day
  workspace: string; // session/workspace urn
  purpose: string; // purpose urn
  view_filter: ViewFilter; // the L_p selection
  folded_at: string; // ISO timestamp the frame was computed
  ontology_version: string; // engine runtime ontology version
  /**
   * Whether this frame is fixture data rather than a live engine read.
   * `true`  → MockMcpAdapter fixture (Phase 1).
   * `false` → StreamableHttpMcpAdapter live read (Phase 2).
   * The provenance header renders a MOCK or LIVE badge off this flag.
   */
  mock: boolean;
}

/** A projected frame: provenance + the selected nodes and relations. */
export interface HgFrame {
  provenance: FrameProvenance;
  nodes: HgNode[];
  relations: HgRelation[];
}

/** Read request. Phase 1 ignores the filter (fixture is fixed); Phase 2 honors it. */
export interface FrameRequest {
  view_filter?: Partial<ViewFilter>;
}

/**
 * The read-only boundary the side panel calls. Phase 1: one method, mock-backed.
 * Phase 2 grows read-only tools behind the same interface (health, node lookup,
 * relation neighborhood, session context) without changing this signature's shape.
 */
export interface McpAdapter {
  getFrame(request?: FrameRequest): Promise<HgFrame>;
}

/**
 * A tool as the MCP `tools/list` discovery method returns it. Phase 4 reads this list
 * READ-ONLY (listing is not calling) to derive the actor/workspace/purpose affordance
 * pack. `inputSchema` is a JSON-Schema-ish object; we down-project it to a flat
 * `ArgsSchema` for the structured-call validator.
 */
export interface RawMcpTool {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, { type?: string; description?: string }>;
    required?: string[];
  };
}

/**
 * The read-only tool-discovery seam. `StreamableHttpMcpAdapter` implements it (via the
 * MCP `tools/list` method); the mock adapter does NOT (so the worker falls back to the
 * mock affordance pack). Discovery only — never a `tools/call`, never an apply.
 */
export interface ToolDiscoveryAdapter {
  listTools(): Promise<RawMcpTool[]>;
}

/** Worker <-> side-panel message envelope (typed, discriminated, request-scoped). */
export type PilotRequest =
  | { type: "GET_FRAME"; request?: FrameRequest }
  | { type: "LIST_TOOLS" };
export type PilotResponse =
  | { type: "FRAME"; frame: HgFrame }
  | { type: "TOOLS"; tools: RawMcpTool[] }
  | { type: "ERROR"; error: string };
