/**
 * Collider Pilot - OpenAI-compatible chat CORE (Phase 7, pure JS+JSDoc)
 * ====================================================================
 * The pure, I/O-light heart of the LLM seam, authored in JS+JSDoc exactly like
 * `transform.js` / `access.js` / `streamable-http-client.js` so `scripts/llm-smoke.mjs`
 * imports and exercises the REAL code, not a copy. The typed panel-facing wrapper lives in
 * `src/tools/llm-provider.ts` (the same TS-wrapper / JS-core split as
 * streamable-http-adapter.ts + streamable-http-client.js).
 *
 * Responsibilities (all pure except the single `postChatCompletions` fetch):
 *   1. ToolSpec[] -> OpenAI function-tool defs  (inverts affordance.ts normalizeType;
 *      `required[]` derived from the spec).
 *   2. Build the `{model, messages, tools, tool_choice:"auto"}` chat body.
 *   3. POST `{endpoint}/chat/completions` (injectable fetch for tests).
 *   4. Parse back a structured tool call — TWO shapes, both then handed to validateToolCall
 *      by the panel (the security gate):
 *        PRIMARY  : `choices[0].message.tool_calls` (structured OpenAI; e.g. llama3.1:8b).
 *        FALLBACK : `choices[0].message.content` that is CLEANLY a single JSON object/array
 *                   of `{name, arguments}` — a STRICT whole-string JSON.parse, rejecting any
 *                   surrounding prose or ``` fences (e.g. qwen2.5-coder:7b via Ollama). This
 *                   is NOT the deleted fenced-text/markdown parser — it is exact JSON, nothing
 *                   fuzzy, no regex extraction from prose.
 *   5. The cloud-egress access gate (checkCloudEgress) — ties to A3's access law.
 *
 * READ-ONLY: nothing here writes the HG. The only network call is the LLM chat read.
 *
 * @typedef {import("./types").ToolSpec} ToolSpec
 * @typedef {import("./types").ToolCall} ToolCall
 * @typedef {import("./types").ArgFieldType} ArgFieldType
 * @typedef {import("./model-providers").ModelProvider} ModelProvider
 * @typedef {import("../mcp/types").AccessResolution} AccessResolution
 */

import { effectiveMode } from "../mcp/access.js";

/* -------------------------------------------------------------------------- */
/* 1. ToolSpec -> OpenAI function-tool def                                    */
/* -------------------------------------------------------------------------- */

/**
 * Inverse of affordance.ts `normalizeType`: a flat ArgFieldType -> a JSON-Schema type
 * string. Our flat vocabulary is already a subset of JSON-Schema type names, so this is a
 * total, lossless map (we never had the integer distinction to lose).
 * @param {ArgFieldType | undefined} t
 * @returns {string}
 */
export function jsonSchemaType(t) {
  switch (t) {
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return "array";
    case "object":
      return "object";
    case "string":
    default:
      return "string";
  }
}

/**
 * Map ONE ToolSpec to an OpenAI function-tool def. `required[]` is derived from the spec's
 * per-field `required` flags. `additionalProperties:false` keeps hallucinated extra fields
 * out (validateToolCall also rejects them — belt and braces).
 * @param {ToolSpec} tool
 * @returns {{type:"function", function:{name:string, description:string, parameters:object}}}
 */
export function toOpenAiTool(tool) {
  const fields =
    (tool && tool.args_schema && tool.args_schema.fields) || /** @type {any} */ ({});
  /** @type {Record<string, {type:string, description?:string, items?:object}>} */
  const properties = {};
  /** @type {string[]} */
  const required = [];
  for (const key of Object.keys(fields)) {
    const spec = fields[key] || {};
    const jsType = jsonSchemaType(spec.type);
    /** @type {{type:string, description?:string, items?:object}} */
    const prop = { type: jsType };
    if (spec.description) prop.description = spec.description;
    if (jsType === "array") prop.items = {}; // permissive item schema
    properties[key] = prop;
    if (spec.required) required.push(key);
  }
  const description = [tool.description, tool.expected_effect]
    .filter(Boolean)
    .join(" — ");
  return {
    type: "function",
    function: {
      name: tool.name,
      description,
      parameters: {
        type: "object",
        properties,
        required,
        additionalProperties: false,
      },
    },
  };
}

/**
 * Map an array of ToolSpecs to OpenAI function-tool defs. The caller passes ONLY the
 * actionable tools, so the model can never name a tool that has no wired, gated path.
 * @param {ToolSpec[]} tools
 * @returns {object[]}
 */
export function toOpenAiTools(tools) {
  const arr = Array.isArray(tools) ? tools : [];
  return arr.map(toOpenAiTool);
}

/* -------------------------------------------------------------------------- */
/* 2. Chat body                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Build the system message: frames the model as a READ-ONLY proposer over an HG frame and
 * tells it that mutating acts are review-only and human-gated (never auto-applied).
 * @param {{actor?:string, workspace?:string, purpose?:string, selectedUrn?:string|null}} [ctx]
 * @returns {string}
 */
export function buildSystemPrompt(ctx) {
  const c = ctx || {};
  const lines = [
    "You are a READ-ONLY proposer inside Collider Pilot, a harness over a mo:os hypergraph frame.",
    "You never execute anything. Propose exactly ONE structured tool call from the tools provided; a human then reviews and gates it.",
    "Read tools run automatically; mutating acts (clipboard, HG rewrite) are shown as a review-only preview and are NEVER auto-applied.",
    "Only call one of the provided tools. Fill arguments from the frame context below. Do NOT invent urns — prefer the selected node urn.",
  ];
  if (c.actor) lines.push(`actor: ${c.actor}`);
  if (c.workspace) lines.push(`workspace: ${c.workspace}`);
  if (c.purpose) lines.push(`purpose: ${c.purpose}`);
  if (c.selectedUrn) lines.push(`selected node urn: ${c.selectedUrn}`);
  return lines.join("\n");
}

/**
 * Build the OpenAI-compatible request body: `{model, messages, tools, tool_choice:"auto"}`.
 * @param {{model:string, systemText?:string, userText:string, tools:ToolSpec[]}} input
 * @returns {{model:string, messages:object[], tools:object[], tool_choice:"auto"}}
 */
export function buildChatBody({ model, systemText, userText, tools }) {
  /** @type {object[]} */
  const messages = [];
  if (systemText) messages.push({ role: "system", content: systemText });
  messages.push({ role: "user", content: String(userText == null ? "" : userText) });
  return {
    model,
    messages,
    tools: toOpenAiTools(tools),
    tool_choice: "auto",
  };
}

/* -------------------------------------------------------------------------- */
/* 3. POST                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * POST `{endpoint}/chat/completions`. The ONLY network call in the LLM seam and the ONLY
 * new egress the pilot makes beyond the read-only MCP transport. Keyless (no Authorization
 * header) — Ollama needs none, and Gemini's key lives server-side in the kernel-proxy.
 * @param {{endpoint:string, body:object, fetchImpl?:typeof fetch, signal?:AbortSignal, headers?:Record<string,string>}} input
 * @returns {Promise<any>} the parsed JSON completion
 */
export async function postChatCompletions({ endpoint, body, fetchImpl, signal, headers }) {
  const doFetch = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!doFetch) throw new Error("no fetch implementation available");
  const base = String(endpoint || "").replace(/\/+$/, "");
  const url = `${base}/chat/completions`;
  const res = await doFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(headers || {}) },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      // ignore body read failure
    }
    throw new Error(
      `LLM endpoint ${res.status} ${res.statusText}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
    );
  }
  return await res.json();
}

/* -------------------------------------------------------------------------- */
/* 4. Parse (structured PRIMARY + strict-content-JSON FALLBACK)               */
/* -------------------------------------------------------------------------- */

/**
 * Coerce a tool-call `arguments` value (a JSON string per OpenAI, or already an object) into
 * a plain args object, or null if it is not a serialisable object.
 * @param {unknown} args
 * @returns {Record<string, unknown> | null}
 */
function coerceArgs(args) {
  let a = args;
  if (typeof a === "string") {
    const s = a.trim();
    if (s === "") return {};
    try {
      a = JSON.parse(s);
    } catch {
      return null;
    }
  }
  if (a === undefined || a === null) return {};
  if (typeof a !== "object" || Array.isArray(a)) return null;
  return /** @type {Record<string, unknown>} */ (a);
}

/**
 * PRIMARY: structured OpenAI `message.tool_calls`. Returns ToolCall[] or null if absent/empty.
 * A single malformed entry (bad arguments JSON) collapses the whole result to null so the
 * caller can surface an honest error rather than a partial call.
 * @param {any} message
 * @returns {ToolCall[] | null}
 */
export function structuredToolCalls(message) {
  const tcs = message && Array.isArray(message.tool_calls) ? message.tool_calls : null;
  if (!tcs || tcs.length === 0) return null;
  /** @type {ToolCall[]} */
  const calls = [];
  for (const tc of tcs) {
    const fn = tc && tc.function;
    if (!fn || typeof fn.name !== "string" || !fn.name) return null;
    const args = coerceArgs(fn.arguments);
    if (args === null) return null;
    calls.push({ name: fn.name, args });
  }
  return calls.length > 0 ? calls : null;
}

/**
 * FALLBACK: strict single-JSON extraction from `message.content`. The WHOLE trimmed content
 * must be exactly a JSON object (or array) of `{name, arguments}` — JSON.parse over the
 * entire string. Any surrounding prose or ``` fence makes JSON.parse fail and yields null.
 * This deliberately is NOT the deleted fenced-text parser: no regex, no fence stripping, no
 * "find the JSON in the text". Local models (e.g. qwen2.5-coder:7b) that emit the tool call
 * as bare content JSON are recovered here; everything else is rejected.
 * @param {unknown} content
 * @returns {ToolCall[] | null}
 */
export function strictContentToolCalls(content) {
  if (typeof content !== "string") return null;
  const trimmed = content.trim();
  if (!trimmed) return null;
  // Must open as a JSON object/array — a cheap pre-check before the authoritative parse.
  if (!(trimmed[0] === "{" || trimmed[0] === "[")) return null;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null; // surrounding prose / fences / trailing text -> reject
  }
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  /** @type {ToolCall[]} */
  const calls = [];
  for (const item of arr) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const name = item.name;
    if (typeof name !== "string" || !name) return null;
    // Accept `arguments` (the canonical key) or a tolerant `args` alias.
    const rawArgs = item.arguments !== undefined ? item.arguments : item.args;
    const args = coerceArgs(rawArgs);
    if (args === null) return null;
    calls.push({ name, args });
  }
  return calls.length > 0 ? calls : null;
}

/**
 * Parse a completion into recovered tool call(s) + provenance of which path recovered them.
 * PRIMARY structured, else FALLBACK strict-content-JSON, else none (assistant text only).
 * The caller (llm-provider / the panel) then runs validateToolCall on the result — that is
 * the security gate; this function only shapes, it never trusts.
 * @param {any} json - the parsed chat/completions response
 * @returns {{ok:boolean, toolCalls:ToolCall[], content:string|null, source:"structured"|"content-json"|"none", error?:string}}
 */
export function parseCompletion(json) {
  const choice = json && Array.isArray(json.choices) ? json.choices[0] : null;
  const message = choice ? choice.message : null;
  if (!message) {
    return {
      ok: false,
      toolCalls: [],
      content: null,
      source: "none",
      error: "no choices[0].message in the LLM response",
    };
  }
  const content = typeof message.content === "string" ? message.content : null;

  const structured = structuredToolCalls(message);
  if (structured) return { ok: true, toolCalls: structured, content, source: "structured" };

  const fromContent = strictContentToolCalls(message.content);
  if (fromContent)
    return { ok: true, toolCalls: fromContent, content, source: "content-json" };

  // The model chose not to call a tool (or emitted un-parseable prose). Not an error — the
  // panel surfaces the assistant text; validateToolCall never runs on a non-call.
  return { ok: true, toolCalls: [], content, source: "none" };
}

/* -------------------------------------------------------------------------- */
/* 5. Cloud-egress access gate (ties to A3 access.js)                         */
/* -------------------------------------------------------------------------- */

/**
 * The sovereignty gate: may we send a prompt to THIS provider under THIS access resolution?
 * "The access-law gates what a cloud model sees."
 *   - on-box local provider (Ollama :11434)      -> ALWAYS allowed (no cloud egress).
 *   - cloud provider that is disabled (pending)   -> BLOCK (never call the unbuilt proxy).
 *   - cloud provider + anon posture               -> BLOCK ("cloud provider disabled for this
 *                                                    access posture"). effectiveMode() is the
 *                                                    REAL A3 law (src/mcp/access.js): a
 *                                                    mode:"identified" not backed by trusted
 *                                                    storage collapses to anon (fail-closed).
 *   - cloud provider + identity-backed identified -> allow (via the kernel-proxy).
 * @param {ModelProvider} provider
 * @param {AccessResolution | null | undefined} access - frame.provenance.access
 * @returns {{allowed:boolean, reason:string}}
 */
export function checkCloudEgress(provider, access) {
  if (!provider || provider.cloud !== true) {
    return { allowed: true, reason: "on-box local provider — no cloud egress" };
  }
  if (provider.enabled === false) {
    return {
      allowed: false,
      reason: `${provider.label || "cloud provider"} is not yet available (pending kernel-proxy)`,
    };
  }
  const mode = effectiveMode(access && access.scope);
  if (mode === "anon") {
    return {
      allowed: false,
      reason: "cloud provider disabled for this access posture (anon / not identity-backed)",
    };
  }
  return { allowed: true, reason: "identified posture — cloud egress permitted (via kernel-proxy)" };
}
