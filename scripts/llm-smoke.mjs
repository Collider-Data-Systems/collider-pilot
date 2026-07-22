/**
 * Collider Pilot - LLM seam smoke test (Phase 7)
 * ==============================================
 * Headless proof of the model-provider seam. It imports the SAME pure core the extension
 * uses — `src/tools/llm-openai.js` — so it exercises the REAL mapping / body / parse / egress
 * logic, not a copy (the transform.js / access.js precedent).
 *
 * It asserts, in order:
 *   A. ToolSpec[] -> OpenAI function-tool defs  (required[] derived; params mapped).
 *   B. chat body shape  {model, messages, tools, tool_choice:"auto"}.
 *   C. parse — BOTH recovery paths + strict rejection:
 *        - structured `tool_calls`            -> recovered (source "structured")
 *        - bare content JSON {name,arguments} -> recovered (source "content-json")
 *        - ```json fenced / prose content     -> REJECTED (no tool call; source "none")
 *   D. cloud-egress access gate  (on-box allowed · cloud+anon blocked · cloud+identified
 *        allowed · cloud+disabled blocked).
 *   E. LIVE (best-effort): POST the mapped tools to Ollama and assert a well-formed tool_call
 *        comes back via EITHER path, then validated against its tool. If Ollama is unreachable
 *        or the model is not pulled, this is SKIPPED with a clear "live-model assertion pending"
 *        note — the shape+parse assertions (A–D) still gate the run.
 *
 * The mini-validate here stands in for the REAL `validateToolCall` (src/tools/tool-call.ts,
 * TS), which is exercised end-to-end in the browser-pane flow test. READ-ONLY: the only
 * network call is the LLM chat read; no HG write, no apply, no POST beyond chat/completions.
 *
 * Run:  node scripts/llm-smoke.mjs
 * Env:  PILOT_OLLAMA_URL (default http://localhost:11434/v1)  PILOT_MODEL (default llama3.1:8b)
 */

import {
  toOpenAiTools,
  toOpenAiTool,
  buildChatBody,
  parseCompletion,
  checkCloudEgress,
  postChatCompletions,
} from "../src/tools/llm-openai.js";

/** Tiny assert — prints and exits non-zero on failure so this is a real gate. */
let PASS = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error(`\nFAIL: ${msg}`);
    process.exit(1);
  }
  PASS += 1;
  console.log(`  ok  ${msg}`);
}

/* ---- Sample actionable ToolSpecs (mirror src/tools/affordance.ts shapes, INCLUDING the
 *      t263 semantic urn tags — keep in sync so this gate can catch a regression of the
 *      urn shape / exists-in-frame / node-type checks) ------------------------------------ */
const CLIPBOARD_TOOL = {
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
  expected_effect: "Writes the selected urn to the OS clipboard. No engine call, no HG write.",
  source: "browser",
  actionable: true,
};
const PIN_PREVIEW_TOOL = {
  name: "pin_ki_to_workspace",
  kind: "mutate",
  channel: "hg",
  description: "Propose pinning the selected knowledge_item into the workspace.",
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
  expected_effect: "Builds a REVIEW-ONLY apply_program envelope. Never posted to the kernel.",
  source: "browser",
  actionable: true,
};
const ACTIONABLE = [CLIPBOARD_TOOL, PIN_PREVIEW_TOOL];

/** Mirror of src/tools/tool-call.ts URN_PATTERN — keep in sync (asserted in section F). */
const URN_PATTERN = /^urn:[a-z0-9][a-z0-9-]{0,31}:\S+$/i;

/** Runtime kind in the ArgFieldType vocabulary (mirror of tool-call.ts kindOf). */
function kindOf(v) {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (Array.isArray(v)) return "array";
  const t = typeof v;
  return t === "string" || t === "number" || t === "boolean" || t === "object" ? t : "object";
}

/**
 * Mini validate — allowlist + required + declared arg TYPES + the t263 SEMANTIC urn
 * checks (shape, optional exists-in-frame, optional node type). A stand-in mirror of the
 * real validateToolCall (src/tools/tool-call.ts is TS and cannot be imported here without
 * a build step); the real one is exercised end-to-end in the browser-pane flow test. The
 * mirror exists so THIS headless gate goes red if the type or semantic checks regress
 * (Copilot #19 catch: the mirror originally skipped the type check).
 */
function miniValidate(call, tools, ctx) {
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) return { ok: false, why: `"${call.name}" not in allowlist` };
  const fields = tool.args_schema.fields || {};
  for (const k of Object.keys(fields)) {
    const spec = fields[k];
    const v = call.args[k];
    if (spec.required && (v === undefined || v === null)) {
      return { ok: false, why: `missing required "${k}"` };
    }
    if (v === undefined || v === null) continue;
    const kind = kindOf(v);
    if (kind !== spec.type) {
      return { ok: false, why: `"${k}" must be ${spec.type}, got ${kind}` };
    }
    if (spec.urn && typeof v === "string") {
      if (!URN_PATTERN.test(v)) return { ok: false, why: `"${k}" is not a urn (got "${v}")` };
      if (spec.mustExistInFrame && ctx?.knownUrns && !ctx.knownUrns.has(v)) {
        return { ok: false, why: `"${k}" does not resolve in the frame ("${v}")` };
      }
      if (spec.nodeType && ctx?.nodeTypes && ctx.nodeTypes[v] !== spec.nodeType) {
        return { ok: false, why: `"${k}" must resolve to a ${spec.nodeType} node` };
      }
    }
  }
  return { ok: true, tool };
}

/* ======================================================================================== */
/* A. mapping                                                                               */
/* ======================================================================================== */
console.log("\n=== A. ToolSpec -> OpenAI function-tool ===");
const oaTools = toOpenAiTools(ACTIONABLE);
assert(oaTools.length === 2, "two tools mapped");
const clip = toOpenAiTool(CLIPBOARD_TOOL);
assert(clip.type === "function", "tool has type:function");
assert(clip.function.name === "copy_urn_to_clipboard", "function name preserved");
assert(clip.function.parameters.type === "object", "parameters is an object schema");
assert(
  clip.function.parameters.properties.urn.type === "string",
  "urn field typed string (normalizeType inverted)",
);
assert(
  JSON.stringify(clip.function.parameters.required) === JSON.stringify(["urn"]),
  "required[] derived from the spec (urn)",
);
const pin = toOpenAiTool(PIN_PREVIEW_TOOL);
assert(
  pin.function.parameters.required.includes("ki_urn") &&
    pin.function.parameters.required.includes("workspace_urn"),
  "pin required[] = [ki_urn, workspace_urn]",
);
assert(clip.function.parameters.additionalProperties === false, "additionalProperties:false");

/* ======================================================================================== */
/* B. chat body                                                                             */
/* ======================================================================================== */
console.log("\n=== B. chat body ===");
const body = buildChatBody({
  model: "llama3.1:8b",
  systemText: "sys",
  userText: "copy the selected urn",
  tools: ACTIONABLE,
});
assert(body.model === "llama3.1:8b", "body.model set");
assert(body.tool_choice === "auto", "tool_choice:auto");
assert(Array.isArray(body.tools) && body.tools.length === 2, "body.tools mapped");
assert(
  body.messages.length === 2 &&
    body.messages[0].role === "system" &&
    body.messages[1].role === "user",
  "messages = [system, user]",
);

/* ======================================================================================== */
/* C. parse — both paths + strict rejection                                                 */
/* ======================================================================================== */
console.log("\n=== C. parse (structured / content-json / reject) ===");
const structuredResp = {
  choices: [
    {
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "copy_urn_to_clipboard",
              arguments: '{"urn":"urn:moos:knowledge_item:sam.t260-steinberger-readback"}',
            },
          },
        ],
      },
    },
  ],
};
const pStruct = parseCompletion(structuredResp);
assert(pStruct.ok && pStruct.source === "structured", "structured tool_calls -> source structured");
assert(pStruct.toolCalls[0].name === "copy_urn_to_clipboard", "structured name recovered");
assert(
  pStruct.toolCalls[0].args.urn === "urn:moos:knowledge_item:sam.t260-steinberger-readback",
  "structured args parsed from the JSON-string arguments",
);
assert(miniValidate(pStruct.toolCalls[0], ACTIONABLE).ok, "structured call passes validate");

const contentResp = {
  choices: [
    {
      message: {
        role: "assistant",
        content: '{"name":"copy_urn_to_clipboard","arguments":{"urn":"urn:moos:x"}}',
      },
    },
  ],
};
const pContent = parseCompletion(contentResp);
assert(
  pContent.ok && pContent.source === "content-json",
  "bare content JSON -> source content-json (fallback path)",
);
assert(pContent.toolCalls[0].name === "copy_urn_to_clipboard", "content-json name recovered");
assert(pContent.toolCalls[0].args.urn === "urn:moos:x", "content-json args recovered");
assert(miniValidate(pContent.toolCalls[0], ACTIONABLE).ok, "content-json call passes validate");

const fencedResp = {
  choices: [
    {
      message: {
        role: "assistant",
        content:
          'Sure! Here is the call:\n```json\n{"name":"copy_urn_to_clipboard","arguments":{"urn":"urn:moos:x"}}\n```',
      },
    },
  ],
};
const pFenced = parseCompletion(fencedResp);
assert(
  pFenced.ok && pFenced.source === "none" && pFenced.toolCalls.length === 0,
  "fenced/prose content is REJECTED (strict — not the deleted fenced parser)",
);

const hallucination = { name: "apply_program", args: { envelopes: [] } };
assert(!miniValidate(hallucination, ACTIONABLE).ok, "out-of-allowlist call rejected (apply_program)");

/* ======================================================================================== */
/* D. cloud-egress access gate                                                              */
/* ======================================================================================== */
console.log("\n=== D. cloud-egress access gate (ties to A3 access.js) ===");
const ollama = { id: "ollama-local", label: "Ollama", cloud: false, enabled: true };
const geminiEnabled = { id: "gemini", label: "Gemini", cloud: true, enabled: true };
const geminiDisabled = { id: "gemini", label: "Gemini", cloud: true, enabled: false };
const anonAccess = { scope: { mode: "anon", identity_source: "anon" } };
const idAccess = { scope: { mode: "identified", identity_source: "trusted-storage" } };
const forgedId = { scope: { mode: "identified", identity_source: "anon" } };

assert(checkCloudEgress(ollama, anonAccess).allowed, "on-box Ollama allowed even under anon");
assert(checkCloudEgress(ollama, null).allowed, "on-box Ollama allowed with no access resolution");
assert(!checkCloudEgress(geminiEnabled, anonAccess).allowed, "cloud + anon BLOCKED");
assert(
  !checkCloudEgress(geminiEnabled, forgedId).allowed,
  "cloud + forged identified (not trusted-storage) BLOCKED (fail-closed)",
);
assert(checkCloudEgress(geminiEnabled, idAccess).allowed, "cloud + identity-backed identified allowed");
assert(
  !checkCloudEgress(geminiDisabled, idAccess).allowed,
  "cloud + disabled (pending kernel-proxy) BLOCKED — gemini never called",
);

/* ======================================================================================== */
/* F. semantic urn gate (t263) — the exact live-caught class must stay red                  */
/* ======================================================================================== */
console.log("\n=== F. semantic urn gate (t263 {urn:'t263'} class) ===");
const FRAME_CTX = {
  knownUrns: new Set([
    "urn:moos:knowledge_item:sam.t260-steinberger-readback",
    "urn:moos:session:sam.z440-cowork-workspace",
    "urn:moos:derivation:zappa.t259-access-law",
  ]),
  nodeTypes: {
    "urn:moos:knowledge_item:sam.t260-steinberger-readback": "knowledge_item",
    "urn:moos:session:sam.z440-cowork-workspace": "session",
    "urn:moos:derivation:zappa.t259-access-law": "derivation",
  },
};
assert(
  !miniValidate({ name: "copy_urn_to_clipboard", args: { urn: "t263" } }, ACTIONABLE, FRAME_CTX).ok,
  "bare-word urn ('t263' — the live Gemini case) REJECTED on shape",
);
assert(
  !miniValidate(
    { name: "copy_urn_to_clipboard", args: { urn: "urn:moos:knowledge_item:ghost.not-here" } },
    ACTIONABLE,
    FRAME_CTX,
  ).ok,
  "shape-valid ghost urn REJECTED on frame resolution",
);
assert(
  miniValidate(
    { name: "copy_urn_to_clipboard", args: { urn: "urn:moos:knowledge_item:sam.t260-steinberger-readback" } },
    ACTIONABLE,
    FRAME_CTX,
  ).ok,
  "frame-resolved urn passes",
);
assert(
  !miniValidate(
    {
      name: "pin_ki_to_workspace",
      args: {
        ki_urn: "urn:moos:derivation:zappa.t259-access-law",
        workspace_urn: "urn:moos:session:sam.z440-cowork-workspace",
      },
    },
    ACTIONABLE,
    FRAME_CTX,
  ).ok,
  "pin with a wrong-typed (derivation) ki_urn REJECTED on node type",
);
assert(
  miniValidate(
    {
      name: "pin_ki_to_workspace",
      args: {
        ki_urn: "urn:moos:knowledge_item:sam.t260-steinberger-readback",
        workspace_urn: "urn:moos:session:sam.z440-cowork-workspace",
      },
    },
    ACTIONABLE,
    FRAME_CTX,
  ).ok,
  "pin with a real knowledge_item + frame workspace passes",
);
assert(
  miniValidate({ name: "copy_urn_to_clipboard", args: { urn: "urn:moos:x" } }, ACTIONABLE).ok,
  "no frame context => shape check only (structural callers unchanged)",
);
assert(
  !miniValidate({ name: "copy_urn_to_clipboard", args: { urn: 42 } }, ACTIONABLE, FRAME_CTX).ok,
  "wrong-typed arg (number where string declared) REJECTED (type mirror)",
);

/* ======================================================================================== */
/* E. LIVE (best-effort)                                                                    */
/* ======================================================================================== */
console.log("\n=== E. live model (best-effort) ===");
const OLLAMA_URL = process.env.PILOT_OLLAMA_URL || "http://localhost:11434/v1";
const MODEL = process.env.PILOT_MODEL || "llama3.1:8b";
const liveBody = buildChatBody({
  model: MODEL,
  systemText:
    "You are a read-only proposer. Only call one of the provided tools. Use the given urn.",
  userText:
    "Copy this node's urn to my clipboard: urn:moos:knowledge_item:sam.t260-steinberger-readback",
  tools: ACTIONABLE,
});

let liveRan = false;
try {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  const json = await postChatCompletions({
    endpoint: OLLAMA_URL,
    body: liveBody,
    signal: controller.signal,
  });
  clearTimeout(timer);
  const parsed = parseCompletion(json);
  console.log(`  live parse source: ${parsed.source}`);
  assert(parsed.ok, "live: response parsed");
  assert(parsed.toolCalls.length > 0, "live: a tool call was recovered (structured OR content-json)");
  const call = parsed.toolCalls[0];
  console.log(`  live tool call: ${JSON.stringify(call)}`);
  const v = miniValidate(call, ACTIONABLE);
  assert(v.ok, `live: recovered call validates (${call.name})`);
  liveRan = true;
} catch (err) {
  console.log(
    `  SKIP live-model assertion (pending): ${err instanceof Error ? err.message : String(err)}`,
  );
  console.log(
    `  -> Ollama at ${OLLAMA_URL} unreachable or model "${MODEL}" not pulled. Shape+parse (A-D) still gate this run.`,
  );
}

console.log(`\nPASS: ${PASS} assertions${liveRan ? " + live model" : " (live skipped)"}.`);
process.exit(0);
