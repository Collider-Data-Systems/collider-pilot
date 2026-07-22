/**
 * Collider Pilot - insider-string glossary (t263 UX eval, item 7)
 * ===============================================================
 * One place that translates the pilot's insider vocabulary — access-law path names,
 * tier names, honesty notes — into hoverable plain sentences. Rendered as `title`
 * tooltips wherever the raw string is load-bearing and must stay VERBATIM in the UI
 * (the strings themselves are part of the audit surface; only the explanation is added).
 *
 * Pure data + one lookup. No I/O, no chrome.*.
 */

export const GLOSSARY: Record<string, string> = {
  // ---- access workspace_path values (how the permitted set was derived) ----
  "wf19-has-occupant":
    "Permitted workspaces were derived by the primary access walk: reverse WF19 has-occupant relations (a workspace HAS an occupant; collect every workspace whose occupant is one of your principals).",
  "occupant-property":
    "Fallback derivation: no WF19 has-occupant relations resolved, so session nodes were scanned for an `occupant` property naming one of your principals.",
  none: "No workspace derivation ran (anon, or the permitted set is empty).",

  // ---- workstation ∩ honesty ----
  "widened, not narrowed":
    "The workstation intersection was SKIPPED (no proven engine→workstation binding at this tier), so the permitted set was left as-is — i.e. wider than a workstation-narrowed set would be. Never read this as enforcement.",
  "skipped-widened":
    "The workstation intersection was not applied; the permitted set is left widened, not narrowed by workstation.",
  "failed-closed":
    "A server-authoritative frame claimed a workstation that could not be resolved, so the governs-closure was dropped to public-only (fail-safe) instead of silently widening.",
  applied:
    "A concrete engine→workstation binding was resolved and the permitted set was narrowed to workspaces on that workstation.",

  // ---- access tier names ----
  "client-presentation":
    "This tier is NOT a security boundary: the full fold still crosses the wire; access only changes what is RENDERED in this panel.",
  "server-authoritative":
    "The kernel itself computed the permitted subgraph and returned only that — access is enforced server-side, not just presented.",

  // ---- identity_source values ----
  "trusted-storage":
    "The identity was resolved by the MV3 service worker from chrome.storage.local (page-inaccessible) — the structural trust boundary.",
  anon: "No trusted identity backs this frame; every ambiguity fails closed to the anonymous principal.",
};

/** Tooltip for an insider string; falls back to the string itself when unknown. */
export function glossaryTitle(term: string): string {
  return GLOSSARY[term] ?? term;
}
