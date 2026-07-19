/**
 * Collider Pilot - provider-neutral model registry (Phase 4)
 * ==========================================================
 * Criterion 5: a provider-neutral model adapter, modelling the SHAPE of
 * `model-providers.json` — a `ModelProvider {id, label, endpoint?, kind}` interface plus
 * a registry, selectable in the UI, defaulting to `manual` (none). This is the SEAM only:
 *
 *   - NO real model is invoked anywhere. There is no `fetch` to any model endpoint.
 *   - NO API key is requested, stored, or referenced. There is no credential field.
 *   - Selecting a provider records the chosen seam in UI state; nothing calls out.
 *
 * Criterion 6: the local WebLLM provider is gated behind a capability check. For Phase 4
 * the check is a STUB — `navigator.gpu` presence (`hasWebGpu()`); WebLLM is NOT bundled.
 * When WebGPU is absent the WebLLM option is `available: false` and the UI disables it.
 */

export type ModelProviderKind = "manual" | "remote" | "local";

export interface ModelProvider {
  id: string;
  label: string;
  kind: ModelProviderKind;
  /** Optional endpoint SEAM. Left undefined in Phase 4 — nothing is ever called. */
  endpoint?: string;
  /** A capability this provider requires to be selectable (e.g. WebGPU for WebLLM). */
  requiresCapability?: "webgpu";
  /** One-line note rendered under the selector. */
  note: string;
}

/**
 * Capability STUB (criterion 6): is a WebGPU device plausibly present? Phase 4 only
 * feature-detects `navigator.gpu`; it does NOT request an adapter or measure VRAM. That
 * (and bundling WebLLM) is deferred. Absence ⇒ the WebLLM option is disabled.
 */
export function hasWebGpu(): boolean {
  try {
    return typeof navigator !== "undefined" && "gpu" in navigator && !!navigator.gpu;
  } catch {
    return false;
  }
}

/** The default provider id — no model, manual tool composition. */
export const DEFAULT_PROVIDER_ID = "none-manual";

/**
 * The static registry. `manual` is the default and always available. The `remote` and
 * `local` entries are seams: present, selectable (subject to capability), but inert —
 * choosing one changes nothing but UI state in Phase 4.
 */
export const MODEL_PROVIDERS: ModelProvider[] = [
  {
    id: DEFAULT_PROVIDER_ID,
    label: "Manual (no model)",
    kind: "manual",
    note: "Default. No model is invoked — you compose the structured tool calls yourself.",
  },
  {
    id: "remote-openai-compatible",
    label: "Remote (OpenAI-compatible endpoint)",
    kind: "remote",
    // endpoint intentionally omitted — unconfigured seam, no call, no credential.
    note: "Seam only. No endpoint configured, no API key, no call is made in Phase 4.",
  },
  {
    id: "webllm-local",
    label: "Local WebLLM (in-browser)",
    kind: "local",
    requiresCapability: "webgpu",
    note: "Gated on a WebGPU capability check (stub). WebLLM is not bundled in Phase 4.",
  },
];

/** Whether a provider is selectable in this environment (capability-gated). */
export function isProviderAvailable(provider: ModelProvider): boolean {
  if (provider.requiresCapability === "webgpu") return hasWebGpu();
  return true;
}

/** Look up a provider by id, falling back to the default `manual` provider. */
export function getProvider(id: string | null | undefined): ModelProvider {
  return (
    MODEL_PROVIDERS.find((p) => p.id === id) ??
    MODEL_PROVIDERS.find((p) => p.id === DEFAULT_PROVIDER_ID)!
  );
}
