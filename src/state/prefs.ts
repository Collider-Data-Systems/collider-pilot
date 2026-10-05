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

/**
 * The graph layouts the picker offers (cytoscape core only; no new dep). t337 adds two:
 *   - `nested` — the packed layout that draws a nesting relation as boxes (FrameGraph);
 *   - `auto`   — NO explicit choice: FrameGraph draws `nested` on a frame that has nesting
 *                relations and `concentric` on every other frame.
 */
export type GraphLayoutName = "auto" | "concentric" | "breadthfirst" | "grid" | "nested";

export const GRAPH_LAYOUTS: GraphLayoutName[] = [
  "auto",
  "concentric",
  "breadthfirst",
  "grid",
  "nested",
];

/**
 * The default — `auto` (t337). On a frame without nesting relations it IS the previous
 * default, `concentric` (a deterministic, DAG-ish read that kills cose label overlap), so
 * those frames lay out exactly as before. Nothing is stored until the user picks a layout
 * in Settings; a stored layout is an explicit choice and is always honoured.
 */
export const DEFAULT_GRAPH_LAYOUT: GraphLayoutName = "auto";

// t337: the choice is stored under a new key. Under the old one `concentric` was both the
// default and a pickable value, so a stored `concentric` says nothing about a choice — it
// is read as none (`auto`); a stored `breadthfirst` or `grid` still is one. Without this
// an install that ever touched the picker would draw the knowledge lens flat.
const LAYOUT_KEY = "pilot.graphLayout.v2";
const LEGACY_LAYOUT_KEY = "pilot.graphLayout";

function normalizeLayout(value: unknown): GraphLayoutName | null {
  return GRAPH_LAYOUTS.includes(value as GraphLayoutName) ? (value as GraphLayoutName) : null;
}

/** Read the persisted layout choice, or the default. Never throws. */
export async function loadLayoutPref(): Promise<GraphLayoutName> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const got = await chrome.storage.local.get([LAYOUT_KEY, LEGACY_LAYOUT_KEY]);
      const stored = normalizeLayout(got?.[LAYOUT_KEY]);
      if (stored) return stored;
      const legacy = normalizeLayout(got?.[LEGACY_LAYOUT_KEY]);
      if (legacy && legacy !== "concentric") return legacy;
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
 * Follow the layout choice (t337): a mirror window draws the layout picked in the panel's
 * Settings and keeps following it while open. Event-driven (`chrome.storage.onChanged`),
 * no polling; outside an extension it never fires. Returns an unsubscribe function.
 */
export function subscribeLayoutPref(cb: (layout: GraphLayoutName) => void): () => void {
  try {
    const onChanged = typeof chrome !== "undefined" ? chrome.storage?.onChanged : undefined;
    if (!onChanged) return () => {};
    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string,
    ): void => {
      if (areaName !== "local" || !(LAYOUT_KEY in changes)) return;
      cb(normalizeLayout(changes[LAYOUT_KEY].newValue) ?? DEFAULT_GRAPH_LAYOUT);
    };
    onChanged.addListener(listener);
    return () => {
      try {
        onChanged.removeListener(listener);
      } catch {
        // context already torn down — nothing to remove
      }
    };
  } catch {
    return () => {};
  }
}

/**
 * INLINE-GRAPH toggle (t264) — whether the side panel renders the graph itself.
 * DEFAULT false: the PiP / pop-out / full-tab mirrors carry the picture and selection
 * syncs through the shared scratch; the panel stays the control/inspect surface.
 */
export const DEFAULT_INLINE_GRAPH = false;

const INLINE_GRAPH_KEY = "pilot.inlineGraph";

/** Read the persisted inline-graph choice, or the default (hidden). Never throws. */
export async function loadInlineGraphPref(): Promise<boolean> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const got = await chrome.storage.local.get(INLINE_GRAPH_KEY);
      const stored = got?.[INLINE_GRAPH_KEY];
      if (typeof stored === "boolean") return stored;
    }
  } catch {
    // storage unavailable — fall back to the default
  }
  return DEFAULT_INLINE_GRAPH;
}

/** Persist the inline-graph choice (best-effort; a failure is non-fatal). */
export async function saveInlineGraphPref(show: boolean): Promise<void> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({ [INLINE_GRAPH_KEY]: show });
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
