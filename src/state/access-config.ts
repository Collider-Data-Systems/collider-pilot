/**
 * Collider Pilot - panel-side WRITE path for the trusted access identity
 * ======================================================================
 * The side panel is extension-origin (trusted) — the SAME tier the badge honestly labels
 * `ACCESS: PRESENTATION`. It MAY populate the trusted-config that the MV3 worker later reads.
 * This module is that write authority: read / write / clear
 * `chrome.storage.local['pilot.access']` — and NOTHING else. No page input reaches it (the
 * panel owns its own inputs); it never touches the HG, never a secret, never any other key.
 *
 * The READ side stays in `src/state/access-identity.ts` (worker-only, unchanged). We import
 * ONLY the key constant + the config shape from there so the writer and the reader can never
 * drift on the key name or field set. Best-effort + fail-safe, mirroring prefs.ts: outside an
 * extension (a served harness) or on any storage error the calls silently no-op.
 */

import { PILOT_ACCESS_KEY, type PilotAccessConfig } from "./access-identity";

/** True when this identity config names an actual user (⇒ the panel is identified). */
export function isIdentitySet(cfg: PilotAccessConfig | null | undefined): boolean {
  return !!cfg && cfg.enabled === true && typeof cfg.user === "string" && cfg.user.length > 0;
}

/** Read the current trusted-config, or null when unset / unavailable. Never throws. */
export async function loadPilotAccess(): Promise<PilotAccessConfig | null> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const got = await chrome.storage.local.get(PILOT_ACCESS_KEY);
      const cfg = got?.[PILOT_ACCESS_KEY] as PilotAccessConfig | undefined;
      return cfg ?? null;
    }
  } catch {
    // storage unavailable — treated as "no identity set"
  }
  return null;
}

/**
 * Persist the trusted identity the worker will resolve on the next GET_FRAME. Writes ONLY
 * `pilot.access`, always at the client-presentation tier (a panel/page can never claim
 * server-authoritative enforcement — the badge would still read PRESENTATION regardless).
 * Best-effort; a failure is non-fatal.
 */
export async function savePilotAccess(user: string, workstation: string | null): Promise<void> {
  const cfg: PilotAccessConfig = {
    enabled: true,
    user,
    workstation: workstation && workstation.length > 0 ? workstation : null,
    enforcement: "client-presentation",
  };
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({ [PILOT_ACCESS_KEY]: cfg });
    }
  } catch {
    // best-effort — ignore
  }
}

/** Remove the trusted identity ⇒ back to anon-only. Best-effort; a failure is non-fatal. */
export async function clearPilotAccess(): Promise<void> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.remove(PILOT_ACCESS_KEY);
    }
  } catch {
    // best-effort — ignore
  }
}
