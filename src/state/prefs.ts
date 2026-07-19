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
