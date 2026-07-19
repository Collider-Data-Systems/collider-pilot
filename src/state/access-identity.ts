/**
 * Collider Pilot - trusted access identity (worker-only) — the prompt-injection boundary
 * =====================================================================================
 * Resolves the identity POINT (user × workstation × role) for a frame from
 * `chrome.storage.local['pilot.access']` — and NOWHERE else. A web page cannot read
 * chrome.storage.local and cannot reach the worker's storage read, so the trust boundary is
 * STRUCTURAL, not conventional: the panel/page may set only `access.mode` ("anon" |
 * "identified"); the user/workstation/role are injected HERE, in the MV3 service worker.
 *
 * Mirrors the `resolveAdapterMode()` precedent in src/mcp/adapter-factory.ts exactly: a
 * `chrome.storage.local` read guarded by try/catch so the same code is safe when storage is
 * unavailable (served harness, torn-down worker) — every such ambiguity FAILS CLOSED to anon.
 *
 * Trusted config shape (the user sets it out-of-band — options page / DevTools):
 *   chrome.storage.local['pilot.access'] = {
 *     enabled: boolean, user: string, workstation?: string,
 *     role?: string, enforcement?: "client-presentation" | "server-authoritative"
 *   }
 *
 * READ-ONLY: this module reads storage; it never writes the HG and never writes storage.
 */

import type { AccessScope, AccessMode, AccessEnforcement } from "../mcp/types";

/** The anonymous user, modeled as a first-class principal (kept in sync with access.js). */
export const ANON_USER_URN = "urn:moos:user:anon";

/** The trusted-config key. The identity lives ONLY here — never in session, never in a page. */
export const PILOT_ACCESS_KEY = "pilot.access";

/** The stored trusted-config shape. */
export interface PilotAccessConfig {
  enabled?: boolean;
  user?: string;
  workstation?: string | null;
  role?: string | null;
  enforcement?: AccessEnforcement;
}

/** The canonical anon scope — the fail-closed collapse for every ambiguity. */
export function anonScope(): AccessScope {
  return {
    mode: "anon",
    user: ANON_USER_URN,
    workstation: null,
    role: null,
    identity_source: "anon",
    enforced_by: "client-presentation",
  };
}

function normalizeEnforcement(value: unknown): AccessEnforcement {
  return value === "server-authoritative" ? "server-authoritative" : "client-presentation";
}

/**
 * Resolve the trusted AccessScope for a requested posture. The requested mode is the ONLY
 * page-influenced input; everything else comes from trusted storage.
 *
 *   - requestedMode === "identified" AND cfg.enabled AND cfg.user  → identified scope from storage
 *   - anything else (default / disabled / missing user / malformed / storage unavailable)
 *                                                                   → anonScope()  (fail-closed)
 *
 * A page-forged `mode:"identified"` with no backing trusted entry therefore collapses to anon:
 * the returned scope's `identity_source` is "anon", and downstream filtering treats any
 * identity_source !== "trusted-storage" as anon regardless of the claimed mode.
 */
export async function resolveTrustedAccess(
  requestedMode: AccessMode | undefined,
): Promise<AccessScope> {
  if (requestedMode !== "identified") return anonScope();
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const got = await chrome.storage.local.get(PILOT_ACCESS_KEY);
      const cfg = got?.[PILOT_ACCESS_KEY] as PilotAccessConfig | undefined;
      if (cfg && cfg.enabled === true && typeof cfg.user === "string" && cfg.user.length > 0) {
        return {
          mode: "identified",
          user: cfg.user,
          workstation: typeof cfg.workstation === "string" ? cfg.workstation : null,
          role: typeof cfg.role === "string" ? cfg.role : null,
          identity_source: "trusted-storage",
          enforced_by: normalizeEnforcement(cfg.enforcement),
        };
      }
    }
  } catch {
    // storage unavailable / malformed -> fail closed to anon
  }
  return anonScope();
}
