/**
 * Collider Pilot - controlled-tools contract (Phase 4)
 * ====================================================
 * The typed shapes for the FIRST phase that mounts an apply capability. The safety
 * invariant is encoded in the type system, not just in comments:
 *
 *   - A tool is either `read` (may execute directly) or `mutate` (MUST pass the
 *     confirmation UI before anything happens).
 *   - A `mutate` tool declares a `channel` that fixes what Confirm is even ALLOWED to do:
 *        'browser'  -> execute a local browser act (e.g. clipboard write). No engine.
 *        'hg'       -> build a REVIEW-ONLY apply_program envelope PREVIEW and reveal it.
 *                      There is NO code path that POSTs it. The preview is an artifact.
 *   - Every act is a STRUCTURED `ToolCall {name, args}` validated against `args_schema`
 *     (a flat JSON-shape check) BEFORE the modal opens and again before Confirm resolves.
 *     Nothing is ever parsed out of free text / a fenced ```tool``` block.
 *
 * This module is pure types + the affordance-pack SHAPE. It has no I/O, no chrome.*,
 * no engine call. It models `dev/config/session-affordance-map.json` (per-session
 * skills/tools) without reading it: an affordance pack is the actor/workspace/purpose
 * projection of what tools are reachable.
 */

/** Read tools run directly; mutate tools are gated behind the confirmation UI. */
export type ToolKind = "read" | "mutate";

/**
 * How a tool's Confirm resolves. This is the load-bearing safety discriminator:
 *   - 'read'    : informational (executed via the existing read path, not the modal).
 *   - 'browser' : a local browser act — Confirm executes it in the panel (no HG write).
 *   - 'hg'      : an HG rewrite — Confirm ONLY builds/reveals the review-only preview.
 */
export type ToolChannel = "read" | "browser" | "hg";

/** A JSON scalar/shape kind for the lightweight args validator. */
export type ArgFieldType = "string" | "number" | "boolean" | "array" | "object";

export interface ArgFieldSpec {
  type: ArgFieldType;
  required?: boolean;
  description?: string;
  /**
   * SEMANTIC tag (t263, item 6): this string arg is a mo:os URN. The validator then
   * additionally checks the URN pattern — a live t263 eval caught Gemini proposing
   * `{urn:"t263"}`, which passed the flat type check and executed. A urn-typed arg
   * must look like `urn:<nid>:<...>`, never a bare word.
   */
  urn?: boolean;
  /**
   * For urn-tagged fields: the urn must additionally resolve in the CURRENT frame
   * (node urns ∪ the provenance anchors ∪ permitted workspaces). Enforced only when
   * the caller supplies a ToolCallContext — pure structural callers are unchanged.
   */
  mustExistInFrame?: boolean;
}

/** Flat args schema: field name -> shape. Deliberately simple (no nested JSON Schema). */
export interface ArgsSchema {
  fields: Record<string, ArgFieldSpec>;
}

/**
 * One tool the current actor/workspace/purpose can reach. `source` records provenance:
 * a live MCP `tools/list` descriptor, a browser affordance injected client-side, or a
 * mock-pack entry.
 */
export interface ToolSpec {
  name: string;
  kind: ToolKind;
  channel: ToolChannel;
  description: string;
  args_schema: ArgsSchema;
  /** Human sentence rendered in the confirmation UI as the "expected effect". */
  expected_effect: string;
  /** Where this affordance came from (for the UI badge + audit). */
  source: "browser" | "mcp" | "mock";
  /**
   * True only for the two curated, wired demonstration actions (clipboard + pin-preview).
   * Discovered MCP tools are catalogued but NOT actionable — no executable path exists
   * for them, which keeps the write invariant airtight.
   */
  actionable: boolean;
}

/**
 * The affordance pack: the actor/workspace/purpose projection of reachable tools.
 * Models the SHAPE of `dev/config/session-affordance-map.json`:
 *   { actor, workspace, purpose, tools:[{name, kind, description, args_schema}] }.
 */
export interface AffordancePack {
  actor: string;
  workspace: string;
  purpose: string;
  /** 'live' = derived from the MCP tools/list catalog; 'mock' = offline fallback pack. */
  source: "live" | "mock";
  /** Human label rendered next to the pack (e.g. "MOCK affordance pack"). */
  label: string;
  tools: ToolSpec[];
}

/**
 * A STRUCTURED tool call. This is the ONLY way an act is expressed — a typed object,
 * never a string parsed with a regex. `args` is validated against the tool's args_schema.
 */
export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

/** Result of validating a ToolCall against a ToolSpec's args_schema. */
export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * A fully-formed, validated intent awaiting the user's Confirm/Cancel. The confirmation
 * UI renders every field of this; nothing acts until Confirm resolves the tool's channel.
 */
export interface PendingAction {
  tool: ToolSpec;
  call: ToolCall;
  /** Human target (typically the subject urn) shown in the modal. */
  target: string;
  actor: string;
  workspace: string;
  purpose: string;
  validation: ValidationResult;
}
