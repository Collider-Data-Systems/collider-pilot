/**
 * Collider Pilot - browser scratch state
 * ======================================
 * Ephemeral UI state that must survive a forced service-worker termination but is
 * NOT semantic truth: the selected node urn and the last projected frame.
 *
 * Stored in chrome.storage.session (in-memory for the browser session, independent
 * of the service-worker lifecycle) so the side panel restores instantly on reopen
 * even if the worker was killed. Per #158: layout/selection state is browser
 * scratch, never HG node data; the append-only log stays the sole source of truth.
 */

import type { HgFrame } from "../mcp/types";
import { SURFACE_KEY_PATTERN } from "../mcp/surface-resolver.js";

/**
 * A17: the scratch store is PER SURFACE. One browser-wide key meant every generated Z440
 * window shared (and overwrote) one selection + one cached frame — 14 windows, one frame.
 * Each surface now scratches under its own key; the docked panel / pop-out / selftest
 * (no surface) keep the legacy key, so their behaviour is unchanged.
 *
 * Scope resolution, per page:
 *   - `?scope=<key>`   — explicit, threaded by whichever page OPENED this one (both
 *                        pip.html routes), so a mirror lands on its opener's channel.
 *                        An empty `scope=` pins the default scope explicitly.
 *   - `?surface=<key>` — the launcher's room key on sidepanel.html. `"tab"` is excluded:
 *                        on pip.html that value is the full-tab DISPLAY-MODE sentinel,
 *                        not a room.
 *   - neither          — the default (legacy) scope.
 * Invalid keys collapse to the default scope rather than minting junk storage keys.
 */
function scratchScope(): string {
  try {
    const params = new URLSearchParams(window.location.search);
    const scope = params.get("scope");
    if (scope !== null) {
      return SURFACE_KEY_PATTERN.test(scope) ? scope : "";
    }
    const surface = params.get("surface");
    if (surface !== null && surface !== "tab" && SURFACE_KEY_PATTERN.test(surface)) {
      return surface;
    }
  } catch {
    // no DOM/location (never the case for the pages that import this) — default scope
  }
  return "";
}

const SCRATCH_SCOPE = scratchScope();
const SCRATCH_KEY = SCRATCH_SCOPE ? `pilot.scratch.v1.${SCRATCH_SCOPE}` : "pilot.scratch.v1";

/** The `?scope=` query fragment a page must append when OPENING a mirror (pip.html). */
export function scratchScopeParam(): string {
  return `scope=${encodeURIComponent(SCRATCH_SCOPE)}`;
}

export interface PilotScratch {
  /** urn of the currently selected node, or null. */
  selectedUrn: string | null;
  /** Last frame projected into the panel (a read cache, not truth). */
  frame: HgFrame | null;
}

const EMPTY: PilotScratch = { selectedUrn: null, frame: null };

/**
 * Cheap frame-identity signature. Two frames with the same signature can keep object
 * identity so a mirror surface (Document PiP mount or the pip.html popup) doesn't force
 * FrameGraph to relayout on every mirrored selection tick. Shared by both PiP surfaces.
 */
export function frameSignature(frame: HgFrame | null): string {
  if (!frame) return "";
  const p = frame.provenance;
  const n = Array.isArray(frame.nodes) ? frame.nodes.length : 0;
  const r = Array.isArray(frame.relations) ? frame.relations.length : 0;
  return `${p?.engine ?? ""}|${p?.log_seq ?? ""}|${p?.folded_at ?? ""}|${n}|${r}`;
}

export async function loadScratch(): Promise<PilotScratch> {
  try {
    const result = await chrome.storage.session.get(SCRATCH_KEY);
    const value = result[SCRATCH_KEY] as PilotScratch | undefined;
    return value ?? EMPTY;
  } catch {
    return EMPTY;
  }
}

export async function saveScratch(scratch: PilotScratch): Promise<void> {
  try {
    await chrome.storage.session.set({ [SCRATCH_KEY]: scratch });
  } catch {
    // Session storage is best-effort scratch; a failure is non-fatal.
  }
}

/**
 * Update ONLY the selection, preserving whatever frame is currently in scratch.
 *
 * Used by the surface that does NOT author the frame (the PiP mirror): it must not
 * clobber a fresher frame the side panel may have just projected. Read-modify-write
 * keeps the newest frame while flipping the shared selection.
 */
export async function saveSelectedUrn(selectedUrn: string | null): Promise<void> {
  try {
    const current = await loadScratch();
    await chrome.storage.session.set({
      [SCRATCH_KEY]: { ...current, selectedUrn },
    });
  } catch {
    // Best-effort scratch; a failure is non-fatal.
  }
}

/**
 * Subscribe to shared-scratch changes (the store the side panel and the Document PiP
 * mirror share, per #158). Event-driven — `chrome.storage.onChanged` fires in every
 * extension context that reads this store, so a write from one surface reflects in the
 * other with NO polling loop. Returns an unsubscribe function.
 *
 * The callback receives the full post-change scratch (or EMPTY if the key was cleared).
 * It fires for the writer's own writes too; callers guard against feedback by never
 * re-writing in response (only user gestures write).
 */
export function subscribeScratch(
  cb: (scratch: PilotScratch) => void,
): () => void {
  try {
    const onChanged = chrome?.storage?.onChanged;
    if (!onChanged) return () => {};
    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string,
    ): void => {
      if (areaName !== "session") return;
      if (!(SCRATCH_KEY in changes)) return;
      cb((changes[SCRATCH_KEY].newValue as PilotScratch | undefined) ?? EMPTY);
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
