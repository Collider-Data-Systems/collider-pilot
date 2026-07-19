/**
 * Collider Pilot - LLM provider (Phase 7, typed panel-facing wrapper)
 * ==================================================================
 * The typed client the side panel calls to turn a free-text user request into a STRUCTURED,
 * validated tool-call PROPOSAL. It wraps the pure JS core `llm-openai.js` (the same
 * TS-wrapper / JS-core split as streamable-http-adapter.ts + streamable-http-client.js), so
 * `scripts/llm-smoke.mjs` can exercise the real mapping/parse/egress logic headlessly.
 *
 * The contract the panel relies on:
 *   - `proposeToolCall` POSTs an OpenAI-compatible chat/completions and returns EITHER a
 *     structured `{name,args}` ToolCall (recovered from `tool_calls` OR a strict
 *     single-JSON-object `content` fallback), a plain assistant message, or an error.
 *   - It NEVER executes the call. The panel runs `validateToolCall` (the security gate) and
 *     then routes: read -> auto-run; mutate -> the existing ConfirmActionModal. No auto-apply.
 *   - `checkCloudEgress` is re-exported from the core: the panel calls it BEFORE sending to a
 *     cloud provider and blocks/falls-back when the access posture is anon.
 *
 * READ-ONLY: no HG write, no apply path. The single fetch is the LLM chat read.
 */

import type { ToolCall, ToolSpec } from "./types";
import type { ModelProvider } from "./model-providers";
import type { AccessResolution } from "../mcp/types";
import { DEFAULT_PROVIDER_ID } from "./model-providers";
import {
  buildChatBody,
  buildSystemPrompt,
  parseCompletion,
  postChatCompletions,
  checkCloudEgress as coreCheckCloudEgress,
} from "./llm-openai.js";

export interface LlmContext {
  actor?: string;
  workspace?: string;
  purpose?: string;
  selectedUrn?: string | null;
}

/** Which parse path recovered a tool call (transparency badge in the UI). */
export type ProposeSource = "structured" | "content-json";

/** The outcome of asking a model to propose a tool call. Discriminated, never thrown. */
export type ProposeResult =
  | {
      ok: true;
      kind: "tool_call";
      call: ToolCall;
      source: ProposeSource;
      content: string | null;
    }
  | { ok: true; kind: "message"; content: string | null }
  | { ok: false; error: string };

export interface ProposeInput {
  provider: ModelProvider;
  /** Resolved model id (a chrome.storage override or the provider default). */
  model: string;
  userText: string;
  /** ONLY the actionable tools are exposed to the model. */
  tools: ToolSpec[];
  context?: LlmContext;
  /** Injectable fetch (defaults to global fetch; the panel relies on the page's fetch). */
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/**
 * Ask `provider.model` to propose a single structured tool call for `userText`. Pure-ish: the
 * only effect is the chat POST. Errors are returned, never thrown, so the panel renders them
 * as status rather than crashing the ErrorBoundary.
 */
export async function proposeToolCall(input: ProposeInput): Promise<ProposeResult> {
  const { provider, model, userText, tools, context, fetchImpl, signal } = input;
  if (!provider.endpoint) {
    return { ok: false, error: `provider ${provider.id} has no endpoint (manual mode?)` };
  }
  try {
    const systemText = buildSystemPrompt(context ?? {});
    const body = buildChatBody({ model, systemText, userText, tools });
    const json = await postChatCompletions({
      endpoint: provider.endpoint,
      body,
      fetchImpl,
      signal,
    });
    const parsed = parseCompletion(json);
    if (!parsed.ok) return { ok: false, error: parsed.error ?? "malformed LLM response" };
    const first = parsed.toolCalls[0];
    if (!first) return { ok: true, kind: "message", content: parsed.content };
    return {
      ok: true,
      kind: "tool_call",
      call: { name: first.name, args: first.args },
      source: parsed.source === "content-json" ? "content-json" : "structured",
      content: parsed.content,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** The egress decision plus the panel's fallback target when a cloud send is blocked. */
export interface EgressDecision {
  allowed: boolean;
  reason: string;
  /** When blocked, the local provider to fall back to (the on-box, always-allowed default). */
  fallbackProviderId?: string;
}

/**
 * Evaluate the cloud-egress access gate for a provider under a frame's access resolution.
 * Delegates the law to the JS core (which uses the real A3 `effectiveMode`), then annotates
 * a fallback provider id so the panel can offer "use Ollama (local) instead".
 */
export function evaluateEgress(
  provider: ModelProvider,
  access: AccessResolution | null | undefined,
): EgressDecision {
  const decision = coreCheckCloudEgress(provider, access);
  if (decision.allowed) return { allowed: true, reason: decision.reason };
  return {
    allowed: false,
    reason: decision.reason,
    fallbackProviderId: provider.id === DEFAULT_PROVIDER_ID ? undefined : DEFAULT_PROVIDER_ID,
  };
}

/** Re-export the raw gate for callers/tests that want the bare decision. */
export { coreCheckCloudEgress as checkCloudEgress };
