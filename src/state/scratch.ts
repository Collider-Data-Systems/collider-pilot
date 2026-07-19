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

const SCRATCH_KEY = "pilot.scratch.v1";

export interface PilotScratch {
  /** urn of the currently selected node, or null. */
  selectedUrn: string | null;
  /** Last frame projected into the panel (a read cache, not truth). */
  frame: HgFrame | null;
}

const EMPTY: PilotScratch = { selectedUrn: null, frame: null };

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
