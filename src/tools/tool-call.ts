/**
 * Collider Pilot - structured ToolCall validator (Phase 4)
 * ========================================================
 * Criterion 2: "structured tool calls only". An act is a typed `ToolCall {name, args}`.
 * This module validates that object against a `ToolSpec.args_schema` with a small
 * JSON-shape check. There is NO text parsing anywhere: no regex over a model reply, no
 * fenced ```tool``` block reader — the legacy scaffold's ad-hoc parser was deleted in
 * Phase 0 and is never reintroduced.
 *
 * Pure functions, no I/O. The confirmation UI calls `validateToolCall` before opening
 * (so an ill-formed intent never reaches Confirm) and the resolver re-validates before
 * acting (so nothing executes on a stale/invalid call).
 */

import type {
  ArgFieldType,
  ArgsSchema,
  ToolCall,
  ToolSpec,
  ValidationResult,
} from "./types";
import type { HgFrame } from "../mcp/types";

/**
 * SEMANTIC URN VALIDATION (t263, item 6)
 * --------------------------------------
 * Live t263 finding: Gemini proposed `{urn:"t263"}` for copy_urn_to_clipboard — a bare
 * word, not a urn — and it passed the flat type check and executed. Args whose spec is
 * tagged `urn: true` are now additionally checked against the URN shape, and (when the
 * caller supplies a ToolCallContext and the spec says `mustExistInFrame`) against the
 * set of urns the current frame actually resolves. Strictly NARROWING: nothing that
 * failed before passes now, and callers without a context keep the exact old behavior.
 */

/** RFC-8141-ish shape: `urn:<nid>:<nss>` with a sane NID and a non-empty NSS. */
export const URN_PATTERN = /^urn:[a-z0-9][a-z0-9-]{0,31}:\S+$/i;

/** Frame-derived context for semantic checks. Optional everywhere (pure callers skip it). */
export interface ToolCallContext {
  knownUrns?: Set<string>;
  /** urn -> type_id for frame NODES (anchors absent) — drives ArgFieldSpec.nodeType. */
  nodeTypes?: Record<string, string>;
}

/**
 * The urns the current frame RESOLVES — everything the UI can legitimately show a user
 * and a user can therefore legitimately target (t263 review major: the first cut only
 * held node urns + 3 anchors, so copy acts on urns the panel itself DISPLAYS — relation
 * urns, urn-shaped property values like `occupant`/`owner_urn`, access principals —
 * were rejected, a regression vs the pre-semantic-gate behavior):
 *   - every node urn and every relation urn,
 *   - every urn-shaped property VALUE on a frame node (the inspector renders these),
 *   - the provenance anchors (workspace / purpose / engine),
 *   - the access fiber's principals + workspace sets (scope user/workstation,
 *     role_topology, permitted_workspaces, public_workspaces).
 */
export function collectFrameUrns(frame: HgFrame | null | undefined): Set<string> {
  const known = new Set<string>();
  if (!frame) return known;
  const consider = (v: unknown) => {
    if (typeof v === "string" && URN_PATTERN.test(v)) known.add(v);
  };
  for (const n of Array.isArray(frame.nodes) ? frame.nodes : []) {
    if (typeof n?.urn === "string") known.add(n.urn);
    const props = n?.properties ?? {};
    for (const k of Object.keys(props)) consider(props[k]);
  }
  for (const r of Array.isArray(frame.relations) ? frame.relations : []) {
    if (typeof r?.urn === "string") known.add(r.urn);
  }
  const prov = frame.provenance;
  for (const anchor of [prov?.workspace, prov?.purpose, prov?.engine]) {
    if (typeof anchor === "string" && anchor) known.add(anchor);
  }
  const access = prov?.access;
  consider(access?.scope?.user);
  consider(access?.scope?.workstation);
  for (const list of [
    access?.role_topology,
    access?.permitted_workspaces,
    access?.public_workspaces,
  ]) {
    for (const u of Array.isArray(list) ? list : []) consider(u);
  }
  return known;
}

/** urn -> type_id for the frame's NODES only (anchors are not nodes and stay absent). */
export function collectFrameNodeTypes(
  frame: HgFrame | null | undefined,
): Record<string, string> {
  const types: Record<string, string> = {};
  if (!frame) return types;
  for (const n of Array.isArray(frame.nodes) ? frame.nodes : []) {
    if (typeof n?.urn === "string" && typeof n?.type_id === "string") {
      types[n.urn] = n.type_id;
    }
  }
  return types;
}

/** Runtime kind of a value, in the vocabulary of ArgFieldType. */
function kindOf(value: unknown): ArgFieldType | "null" | "undefined" {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "array";
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean" || t === "object") {
    return t as ArgFieldType;
  }
  // functions / symbols / bigint are never valid args in a serialisable ToolCall
  return "object";
}

/**
 * Validate a structured ToolCall against a tool's args_schema. Checks, in order:
 *   1. the call names the tool it claims to (name match),
 *   2. `args` is a plain object,
 *   3. every `required` field is present and non-null,
 *   4. every provided field whose schema is known matches the declared type,
 *   5. no unknown extra fields slipped in (surfaced as an error, not silently accepted),
 *   6. every urn-tagged string field matches the URN shape, and — when a context with
 *      knownUrns is supplied and the spec demands it — resolves in the current frame.
 *
 * @returns { ok, errors } — ok iff errors is empty.
 */
export function validateToolCall(
  call: ToolCall,
  tool: ToolSpec,
  context?: ToolCallContext,
): ValidationResult {
  const errors: string[] = [];

  if (!call || typeof call !== "object") {
    return { ok: false, errors: ["tool call is not an object"] };
  }
  if (call.name !== tool.name) {
    errors.push(`name mismatch: call "${call.name}" != tool "${tool.name}"`);
  }
  const args = call.args;
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return { ok: false, errors: [...errors, "args is not a plain object"] };
  }

  const schema: ArgsSchema = tool.args_schema ?? { fields: {} };
  const fields = schema.fields ?? {};

  for (const key of Object.keys(fields)) {
    const spec = fields[key];
    const present = Object.prototype.hasOwnProperty.call(args, key);
    const value = (args as Record<string, unknown>)[key];
    if (spec.required && (!present || value === null || value === undefined)) {
      errors.push(`missing required arg "${key}" (${spec.type})`);
      continue;
    }
    if (present && value !== null && value !== undefined) {
      const k = kindOf(value);
      if (k !== spec.type) {
        errors.push(`arg "${key}" must be ${spec.type}, got ${k}`);
        continue;
      }
      // Semantic URN checks (t263, item 6) — only for well-typed string fields.
      if (spec.urn && typeof value === "string") {
        if (!URN_PATTERN.test(value)) {
          errors.push(`arg "${key}" is not a urn (got "${value}") — expected urn:<nid>:<...>`);
        } else if (
          spec.mustExistInFrame &&
          context?.knownUrns &&
          !context.knownUrns.has(value)
        ) {
          errors.push(`arg "${key}" does not resolve in the current frame ("${value}")`);
        } else if (spec.nodeType && context?.nodeTypes) {
          // Copilot #18 catch: the urn resolves, but must resolve to a NODE of the
          // declared type — a wrong-typed node (or a non-node anchor) is not a valid
          // target for this arg.
          const resolvedType = context.nodeTypes[value];
          if (resolvedType !== spec.nodeType) {
            errors.push(
              `arg "${key}" must resolve to a ${spec.nodeType} node (got ${resolvedType ?? "a non-node urn"})`,
            );
          }
        }
      }
    }
  }

  for (const key of Object.keys(args as Record<string, unknown>)) {
    if (!Object.prototype.hasOwnProperty.call(fields, key)) {
      errors.push(`unknown arg "${key}" not in args_schema`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Convenience: build a structured ToolCall (typed, never parsed from text). */
export function makeToolCall(
  name: string,
  args: Record<string, unknown>,
): ToolCall {
  return { name, args };
}
