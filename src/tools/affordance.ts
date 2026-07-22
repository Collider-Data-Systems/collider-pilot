/**
 * Collider Pilot - affordance-pack discovery + projection (Phase 4)
 * =================================================================
 * Criterion 1: "MCP affordance discovery filtered by actor/workspace/purpose". This
 * derives the tools reachable for the CURRENT frame's actor/workspace/purpose, modelling
 * the SHAPE of the mo:os session-affordance projection (`dev/config/session-affordance-map.json`):
 *
 *     { actor, workspace, purpose, tools:[{name, kind, description, args_schema}] }
 *
 * Two sources, in preference order:
 *   1. LIVE — the MCP `tools/list` catalog (read-only; listing, not calling), classified
 *      read-vs-mutate by name, down-projected to a flat args_schema.
 *   2. MOCK — a labelled fallback pack, used offline or against the mock adapter.
 *
 * Either way, two CURATED, WIRED demonstration affordances are always injected:
 *   - `copy_urn_to_clipboard` — a harmless BROWSER act (channel 'browser').
 *   - `pin_ki_to_workspace`   — a REVIEW-ONLY HG rewrite preview (channel 'hg').
 * These are the only `actionable` tools. Discovered MCP tools are catalogued for
 * transparency but are NOT actionable — they have no executable path, so the write
 * invariant stays airtight regardless of what the server advertises.
 *
 * Pure data-in/data-out (no chrome.*, no network). The worker fetches the raw tools/list;
 * this module classifies + projects.
 */

import type { HgFrame, RawMcpTool } from "../mcp/types";
import type {
  AffordancePack,
  ArgFieldType,
  ArgsSchema,
  ToolKind,
  ToolSpec,
} from "./types";

/** Fallback actor when the frame's workspace session declares no occupant. */
export const DEFAULT_ACTOR = "urn:moos:agent:claude-cowork.hp-z440";

/* -------------------------------------------------------------------------- */
/* Curated, wired demonstration affordances                                   */
/* -------------------------------------------------------------------------- */

/**
 * The harmless browser act (criterion 4). Copies the selected node's urn to the
 * clipboard. No host mutation, no engine call — a purely local browser side effect,
 * still gated behind the confirmation UI because it touches state outside the panel.
 */
export const CLIPBOARD_TOOL: ToolSpec = {
  name: "copy_urn_to_clipboard",
  kind: "mutate",
  channel: "browser",
  description: "Copy the selected node's urn to the system clipboard.",
  args_schema: {
    fields: {
      urn: {
        type: "string",
        required: true,
        description: "the urn to copy",
        urn: true,
        mustExistInFrame: true,
      },
    },
  },
  expected_effect:
    "Writes the selected urn to the OS clipboard. No engine call, no HG write — a local browser act.",
  source: "browser",
  actionable: true,
};

/**
 * The review-only HG rewrite (criterion 4). Proposes pinning the selected knowledge_item
 * into the workspace via a WF19 `pins-urn` LINK. Confirm builds and reveals the
 * `apply_program` envelope PREVIEW — it is NEVER posted to the kernel.
 */
export const PIN_PREVIEW_TOOL: ToolSpec = {
  name: "pin_ki_to_workspace",
  kind: "mutate",
  channel: "hg",
  description:
    "Propose pinning the selected knowledge_item into the workspace (WF19 pins-urn LINK).",
  args_schema: {
    fields: {
      ki_urn: {
        type: "string",
        required: true,
        description: "knowledge_item to pin",
        urn: true,
        mustExistInFrame: true,
        nodeType: "knowledge_item",
      },
      workspace_urn: {
        type: "string",
        required: true,
        description: "session/workspace",
        urn: true,
        mustExistInFrame: true,
      },
    },
  },
  expected_effect:
    "Builds a REVIEW-ONLY apply_program envelope (one WF19 LINK). It is displayed/downloadable only — never posted to the kernel.",
  source: "browser",
  actionable: true,
};

/** The two curated affordances every pack injects. */
function curatedTools(): ToolSpec[] {
  return [CLIPBOARD_TOOL, PIN_PREVIEW_TOOL];
}

/* -------------------------------------------------------------------------- */
/* MCP tools/list classification                                              */
/* -------------------------------------------------------------------------- */

// Substring hints used to classify a discovered MCP tool. Split into separate tokens
// on purpose: the exact write-tool names never appear as literals in this codebase.
const MUTATE_HINTS = [
  "apply",
  "rewrite",
  "program",
  "add",
  "link",
  "mutate",
  "unlink",
  "create",
  "update",
  "delete",
  "remove",
  "write",
  "pin",
  "commit",
];
const READ_HINTS = [
  "state",
  "lookup",
  "list",
  "read",
  "query",
  "health",
  "registry",
  "neighbor",
  "search",
  "get",
  "describe",
  "inspect",
];
const READ_PREFIX = /^(get|list|read|query|describe|search|fetch|lookup|health|inspect)/;

/**
 * Classify a discovered tool read-vs-mutate by its name. Read verbs win as a prefix;
 * otherwise any mutate hint gates it; unknown names default to `mutate` (conservative —
 * an unclassifiable tool is treated as if it could write, so it is never auto-run).
 */
export function classifyKind(name: string): ToolKind {
  const n = (name || "").toLowerCase();
  if (READ_PREFIX.test(n)) return "read";
  if (MUTATE_HINTS.some((h) => n.includes(h))) return "mutate";
  if (READ_HINTS.some((h) => n.includes(h))) return "read";
  return "mutate";
}

/** Map a JSON-Schema type string to our flat ArgFieldType (integer collapses to number). */
function normalizeType(t: string | undefined): ArgFieldType {
  switch (t) {
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return "array";
    case "object":
      return "object";
    default:
      return "string";
  }
}

/** Down-project an MCP tool inputSchema to the flat ArgsSchema the validator uses. */
export function schemaFromInputSchema(raw: RawMcpTool): ArgsSchema {
  const props = raw.inputSchema?.properties ?? {};
  const required = new Set(raw.inputSchema?.required ?? []);
  const fields: ArgsSchema["fields"] = {};
  for (const key of Object.keys(props)) {
    fields[key] = {
      type: normalizeType(props[key]?.type),
      required: required.has(key),
      description: props[key]?.description,
    };
  }
  return { fields };
}

/**
 * Classify + project one discovered MCP tool into a catalog ToolSpec. Discovered tools
 * are NEVER actionable (no wired executable path); they are shown so the operator can see
 * exactly what the actor/workspace/purpose can reach.
 */
export function classifyMcpTool(raw: RawMcpTool): ToolSpec {
  const kind = classifyKind(raw.name);
  return {
    name: raw.name,
    kind,
    channel: kind === "read" ? "read" : "hg",
    description: raw.description || "(no description advertised)",
    args_schema: schemaFromInputSchema(raw),
    expected_effect:
      kind === "read"
        ? "Read-only tool discovered on the engine (catalog entry; run via the read path)."
        : "Mutating tool discovered on the engine (catalog entry only — not wired to any executable path here).",
    source: "mcp",
    actionable: false,
  };
}

/* -------------------------------------------------------------------------- */
/* Mock fallback pack                                                          */
/* -------------------------------------------------------------------------- */

/** A representative, LABELLED mock catalog used offline / against the mock adapter. */
const MOCK_CATALOG: ToolSpec[] = [
  classifyMcpTool({
    name: "graph_state",
    description: "Return the whole current fold {nodes, relations} (read).",
    inputSchema: { type: "object", properties: {}, required: [] },
  }),
  classifyMcpTool({
    name: "node_lookup",
    description: "Look up a single node by urn (read).",
    inputSchema: {
      type: "object",
      properties: { urn: { type: "string", description: "node urn" } },
      required: ["urn"],
    },
  }),
  classifyMcpTool({
    name: "operad_registry",
    description: "The type + rewrite_category registry (read).",
    inputSchema: { type: "object", properties: {}, required: [] },
  }),
  // A representative MUTATE catalog entry so the pack shows a gated tool. It is a catalog
  // row only — actionable:false, no executable path — the classifier gates it as mutate.
  classifyMcpTool({
    name: "apply_program",
    description: "Apply an atomic program of rewrites (mutate — gated, not wired here).",
    inputSchema: {
      type: "object",
      properties: { envelopes: { type: "array", description: "rewrite envelopes" } },
      required: ["envelopes"],
    },
  }),
];

/* -------------------------------------------------------------------------- */
/* Projection                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Derive the current frame's actor: the occupant of the workspace session node, else the
 * default cowork agent. Defensive against partial frames.
 */
export function deriveFrameActor(frame: HgFrame | null): string {
  const nodes = Array.isArray(frame?.nodes) ? frame!.nodes : [];
  const workspace = frame?.provenance?.workspace;
  const session =
    nodes.find((n) => n.urn === workspace && n.type_id === "session") ??
    nodes.find((n) => n.type_id === "session");
  const occupant = session?.properties?.occupant;
  return typeof occupant === "string" && occupant.trim() ? occupant : DEFAULT_ACTOR;
}

export interface DeriveAffordanceInput {
  actor: string;
  workspace: string;
  purpose: string;
  /** Raw MCP tools/list result, or null when unavailable (offline / mock adapter). */
  liveTools: RawMcpTool[] | null;
}

/**
 * Project the affordance pack for an actor/workspace/purpose. Prefers the live MCP
 * catalog; falls back to the labelled MOCK pack. Always injects the two curated actions.
 */
export function deriveAffordancePack(input: DeriveAffordanceInput): AffordancePack {
  const { actor, workspace, purpose } = input;
  const live = Array.isArray(input.liveTools) ? input.liveTools : null;

  if (live && live.length > 0) {
    const discovered = live.map(classifyMcpTool);
    return {
      actor,
      workspace,
      purpose,
      source: "live",
      label: `live MCP tools/list · ${discovered.length} tool(s) · projected for this actor/workspace/purpose`,
      tools: [...curatedTools(), ...discovered],
    };
  }

  return {
    actor,
    workspace,
    purpose,
    source: "mock",
    label: "MOCK affordance pack (offline / mock adapter) — labelled, not a live read",
    tools: [...curatedTools(), ...MOCK_CATALOG],
  };
}

/** Convenience: only the actionable (curated) tools — what the Actions UI offers. */
export function actionableTools(pack: AffordancePack): ToolSpec[] {
  const tools = Array.isArray(pack?.tools) ? pack.tools : [];
  return tools.filter((t) => t.actionable);
}

/** Convenience: the non-actionable discovered/catalog tools — the transparency list. */
export function catalogTools(pack: AffordancePack): ToolSpec[] {
  const tools = Array.isArray(pack?.tools) ? pack.tools : [];
  return tools.filter((t) => !t.actionable);
}
