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
 *   5. no unknown extra fields slipped in (surfaced as an error, not silently accepted).
 *
 * @returns { ok, errors } — ok iff errors is empty.
 */
export function validateToolCall(call: ToolCall, tool: ToolSpec): ValidationResult {
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
