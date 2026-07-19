/**
 * Collider Pilot - panel UI preferences (Phase 6)
 * ===============================================
 * Durable, NON-semantic UI choices persisted in `chrome.storage.local` (survives the
 * browser session, unlike the `chrome.storage.session` scratch). Currently just the
 * graph layout choice. This is best-effort: outside an extension (a served harness) or
 * on any storage error the calls silently no-op and the caller keeps its default.
 *
 * Mirrors the `adapter-factory.ts` precedent of reading a `chrome.storage.local`
 * override guarded by a try/catch so the same code runs served and packed.
 *
 * Per #158: layout/selection are browser scratch, never HG node data — nothing here
 * touches the append-only log.
 */

/** The graph layouts the picker offers (all ship in cytoscape core; no new dep). */
export type GraphLayoutName = "concentric" | "breadthfirst" | "grid";

export const GRAPH_LAYOUTS: GraphLayoutName[] = [
  "concentric",
  "breadthfirst",
  "grid",
];

/** The default layout — a deterministic, DAG-ish read that kills cose label overlap. */
export const DEFAULT_GRAPH_LAYOUT: GraphLayoutName = "concentric";

const LAYOUT_KEY = "pilot.graphLayout";

function normalizeLayout(value: unknown): GraphLayoutName | null {
  return value === "concentric" || value === "breadthfirst" || value === "grid"
    ? value
    : null;
}

/** Read the persisted layout choice, or the default. Never throws. */
export async function loadLayoutPref(): Promise<GraphLayoutName> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const got = await chrome.storage.local.get(LAYOUT_KEY);
      const stored = normalizeLayout(got?.[LAYOUT_KEY]);
      if (stored) return stored;
    }
  } catch {
    // storage unavailable — fall back to the default
  }
  return DEFAULT_GRAPH_LAYOUT;
}

/** Persist the layout choice (best-effort; a failure is non-fatal). */
export async function saveLayoutPref(layout: GraphLayoutName): Promise<void> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({ [LAYOUT_KEY]: layout });
    }
  } catch {
    // best-effort — ignore
  }
}

/**
 * ACCESS POSTURE toggle (A3) — a UI PREFERENCE, never the identity.
 * =================================================================
 * Persists ONLY which posture the toggle is in: "anon" (default) or "identified". This is
 * the sole thing the panel contributes to access; the actual identity (user/workstation/role)
 * is resolved by the worker from chrome.storage.local['pilot.access'] and is unreachable from
 * here. Stored under a SEPARATE key from the identity so a UI pref can never be mistaken for,
 * or promoted to, a trusted identity. DEFAULT is anon (fail-closed).
 */
export type AccessPosture = "anon" | "identified";

export const DEFAULT_ACCESS_POSTURE: AccessPosture = "anon";

const ACCESS_POSTURE_KEY = "pilot.accessPosture";

function normalizePosture(value: unknown): AccessPosture | null {
  return value === "anon" || value === "identified" ? value : null;
}

/** Read the persisted access-posture toggle, or the default (anon). Never throws. */
export async function loadAccessPosturePref(): Promise<AccessPosture> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const got = await chrome.storage.local.get(ACCESS_POSTURE_KEY);
      const stored = normalizePosture(got?.[ACCESS_POSTURE_KEY]);
      if (stored) return stored;
    }
  } catch {
    // storage unavailable — fall back to anon (fail-closed)
  }
  return DEFAULT_ACCESS_POSTURE;
}

/** Persist the access-posture toggle (best-effort; a failure is non-fatal). NOT the identity. */
export async function saveAccessPosturePref(posture: AccessPosture): Promise<void> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({ [ACCESS_POSTURE_KEY]: posture });
    }
  } catch {
    // best-effort — ignore
  }
}
