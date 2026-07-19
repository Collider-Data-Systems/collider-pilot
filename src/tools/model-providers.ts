/**
 * Collider Pilot - model-provider registry (Phase 7 — a REAL LLM in the seam)
 * ==========================================================================
 * Phase 4 shipped this as an INERT seam (a `ModelProvider {id,label,endpoint?,kind}` that
 * was never called). Phase 7 lights it up: the registry now carries a concrete `model` +
 * `endpoint` per provider, and `src/tools/llm-provider.ts` actually POSTs an
 * OpenAI-compatible `chat/completions` to the selected provider. The LLM only ever
 * PROPOSES a structured tool call; the existing gate (validateToolCall → ConfirmActionModal)
 * decides whether anything happens. READ-ONLY invariants are unchanged: the sole mutate
 * route is still the confirmation modal → review-only preview that never POSTs to the HG.
 *
 * The selectable provider id is read from `chrome.storage.local['pilot.model']` (mirrors
 * `resolveAdapterMode` in adapter-factory.ts). The active model NAME is a separate
 * `chrome.storage.local['pilot.modelName']` override (mirrors the same precedent), so a
 * user can pick llama3.1:8b vs qwen2.5-coder:7b without a rebuild.
 *
 * TWO real entries + one explicit "no model" option:
 *   - `ollama-local` (DEFAULT) — private, on-box, KEYLESS OpenAI-compatible endpoint at
 *     :11434. Default model `llama3.1:8b` (emits structured `tool_calls`); `qwen2.5-coder:7b`
 *     is a selectable alternative that resolves via the strict-content-JSON fallback path in
 *     llm-provider. On-box ⇒ NOT cloud ⇒ always allowed regardless of the A3 access posture.
 *   - `gemini` — points at a FUTURE kernel-proxy (`localhost:8000/llm/gemini`) that is NOT
 *     built yet. Wired but `enabled:false` ("pending kernel-proxy"). The extension holds NO
 *     Gemini key — the key lives in the kernel-proxy's Secret Manager (decided design). It is
 *     `cloud:true`, so even once enabled it is gated on the access posture (never sent anon).
 *     It is NEVER actually called in this build.
 *   - `none-manual` — no model; compose the structured tool calls by hand (Phase 4 behaviour).
 */

export type ModelProviderKind = "manual" | "remote" | "local";

export interface ModelProvider {
  id: string;
  label: string;
  kind: ModelProviderKind;
  /** OpenAI-compatible base. `{endpoint}/chat/completions` is POSTed. Undefined for manual. */
  endpoint?: string;
  /** Default model id sent in the OpenAI-compat body. Undefined for manual. */
  model?: string;
  /** Selectable alternative model ids (drives the UI model sub-picker). */
  models?: string[];
  /** Does the provider require an API key held by the EXTENSION? Always false here (keyless). */
  requiresKey?: boolean;
  /** Routes through the future kernel-proxy (the key lives server-side, never in the page). */
  viaKernelProxy?: boolean;
  /** Cloud egress? Gated on the A3 access posture — never sent when the frame is anon. */
  cloud?: boolean;
  /** false = wired but NOT-yet-available (shown disabled in the UI, never called). */
  enabled?: boolean;
  /** One-line note rendered under the selector. */
  note: string;
}

/** The default provider id — the private, keyless, on-box Ollama endpoint. */
export const DEFAULT_PROVIDER_ID = "ollama-local";

/** Storage keys (mirror the adapter-factory `pilot.adapterMode` precedent). */
const STORAGE_PROVIDER_KEY = "pilot.model";
const STORAGE_MODEL_NAME_KEY = "pilot.modelName";

/**
 * The static registry. `ollama-local` is the DEFAULT and always available. `gemini` is a
 * disabled placeholder for the future kernel-proxy. `none-manual` keeps the Phase 4
 * hand-compose path.
 */
export const MODEL_PROVIDERS: ModelProvider[] = [
  {
    id: "ollama-local",
    label: "Ollama (local · keyless)",
    kind: "remote",
    endpoint: "http://localhost:11434/v1",
    model: "llama3.1:8b",
    models: ["llama3.1:8b", "qwen2.5-coder:7b"],
    requiresKey: false,
    cloud: false,
    enabled: true,
    note: "Private, on-box, keyless OpenAI-compatible endpoint (:11434). DEFAULT. Always allowed — on-box, no cloud egress.",
  },
  {
    id: "gemini",
    label: "Gemini (via kernel-proxy)",
    kind: "remote",
    endpoint: "http://localhost:8000/llm/gemini",
    model: "gemini-2.5-flash",
    requiresKey: false, // the extension holds NO key — it lives in the kernel-proxy Secret Manager
    viaKernelProxy: true,
    cloud: true,
    enabled: false, // pending kernel-proxy — wired but never called in this build
    note: "Cloud, via the FUTURE kernel-proxy (key server-side). PENDING — not yet available. Gated on the access posture: never sent when anon.",
  },
  {
    id: "none-manual",
    label: "Manual (no model)",
    kind: "manual",
    cloud: false,
    enabled: true,
    note: "No model is invoked — compose the structured tool calls yourself with the buttons below.",
  },
];

/** Look up a provider by id, falling back to the default. */
export function getProvider(id: string | null | undefined): ModelProvider {
  return (
    MODEL_PROVIDERS.find((p) => p.id === id) ??
    MODEL_PROVIDERS.find((p) => p.id === DEFAULT_PROVIDER_ID)!
  );
}

/** A provider that actually calls a model (has an endpoint) — i.e. not the manual option. */
export function isModelProvider(provider: ModelProvider): boolean {
  return provider.kind !== "manual" && typeof provider.endpoint === "string";
}

/** Cloud egress provider — the A3 access gate applies before ANY prompt is sent. */
export function isCloudProvider(provider: ModelProvider): boolean {
  return provider.cloud === true;
}

/** Whether a provider is selectable/callable in this build (disabled ⇒ shown but inert). */
export function isProviderAvailable(provider: ModelProvider): boolean {
  return provider.enabled !== false;
}

/** The resolved model name for a provider: a storage override (if known), else the default. */
export function providerDefaultModel(provider: ModelProvider): string {
  return provider.model ?? "";
}

/**
 * Resolve the effective provider id: a `chrome.storage.local['pilot.model']` override if it
 * names a known provider, else the default. Safe outside an extension (returns the default).
 */
export async function resolveProviderId(): Promise<string> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const got = await chrome.storage.local.get(STORAGE_PROVIDER_KEY);
      const id = got?.[STORAGE_PROVIDER_KEY];
      if (typeof id === "string" && MODEL_PROVIDERS.some((p) => p.id === id)) return id;
    }
  } catch {
    // storage unavailable -> default
  }
  return DEFAULT_PROVIDER_ID;
}

/** Persist the selected provider id (best-effort; a failure is non-fatal). */
export async function saveProviderId(id: string): Promise<void> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({ [STORAGE_PROVIDER_KEY]: id });
    }
  } catch {
    // best-effort
  }
}

/**
 * Resolve the effective model NAME for a provider: a `chrome.storage.local['pilot.modelName']`
 * override (honored only if it is one of the provider's known `models`, or the provider fixes
 * no list), else the provider default. Safe outside an extension.
 */
export async function resolveModelName(provider: ModelProvider): Promise<string> {
  const fallback = providerDefaultModel(provider);
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const got = await chrome.storage.local.get(STORAGE_MODEL_NAME_KEY);
      const name = got?.[STORAGE_MODEL_NAME_KEY];
      if (typeof name === "string" && name.trim()) {
        if (!provider.models || provider.models.includes(name)) return name;
      }
    }
  } catch {
    // storage unavailable -> provider default
  }
  return fallback;
}

/** Persist the selected model name (best-effort; a failure is non-fatal). */
export async function saveModelName(name: string): Promise<void> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({ [STORAGE_MODEL_NAME_KEY]: name });
    }
  } catch {
    // best-effort
  }
}
