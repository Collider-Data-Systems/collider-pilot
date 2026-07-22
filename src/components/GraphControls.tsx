/**
 * Collider Pilot - graph toolbar controls (Phase 6, re-cut by the t263 UX eval)
 * =============================================================================
 * The compact, controlled strip mounted above the graph. After the t263 settings
 * consolidation it holds ONLY the live view controls — everything durable (identity,
 * provider, layout) moved to the SettingsPanel:
 *
 *   1. access posture  — "Stay anon" / "Bring me in" (sends ONLY view_filter.access.mode)
 *   2. node search     — filters nodes by urn/label; the panel selects + centers the hit
 *   3. view_filter     — the settable placement axis (t, types, seat/scope), OPEN by
 *                        default (t263 item 2: it is the highest-value settable feature
 *                        the panel has — it must be visible, not buried in a disclosure)
 *
 * Presentational + controlled: every VALUE comes in as a prop and every change is lifted
 * to the panel via a callback. The only local state is the view_filter disclosure's
 * open/closed flag (pure UI chrome). No I/O, no adapter here.
 */

import { useState } from "react";
import type { AccessPosture } from "../state/prefs";
import type { AccessScope, FrameRequest, ViewFilter } from "../mcp/types";

/**
 * The node types the view_filter can toggle. The first four are the default frame slice;
 * `user` / `workstation` (t263) are off by default but selectable so the identity-bearing
 * nodes can be brought into view (they also feed the Settings identity pickers).
 */
export const SELECTABLE_TYPES = [
  "knowledge_item",
  "derivation",
  "purpose",
  "session",
  "user",
  "workstation",
] as const;

/** The default view_filter selection (the classic four-type frame slice). */
export const DEFAULT_VIEW_TYPES: string[] = [
  "knowledge_item",
  "derivation",
  "purpose",
  "session",
];

/**
 * The access posture the panel MAY contribute — ONLY `mode`. Identity_source is declared
 * "anon" and user/workstation/role are null because a page/panel has NO authority to assert
 * an identity: the worker (or the preview's worker simulation) DISCARDS this whole object and
 * re-injects the trusted scope from chrome.storage.local, keeping only `mode`. This is a
 * throwaway carrier for the toggle, never a claim.
 */
export function panelAccessScope(mode: AccessPosture): AccessScope {
  return {
    mode,
    user: null,
    workstation: null,
    role: null,
    identity_source: "anon",
    enforced_by: "client-presentation",
  };
}

/**
 * Build a FrameRequest from a draft view_filter + access posture + optional scope. When
 * `accessMode` is supplied, the request always carries `view_filter.access` (mode only) so the
 * toggle flows; a non-empty `scopeUrns` pins the view to that seat. Otherwise it returns
 * undefined for the untouched default (all types, no `t`, no scope) so the legacy path stays a
 * bare frame request (⇒ transform's EMPTY default scope = "All permitted"). Shared by the side
 * panel and the live harness.
 */
export function buildFrameRequest(
  types: string[],
  tText: string,
  accessMode?: AccessPosture,
  scopeUrns?: string[],
): FrameRequest | undefined {
  const trimmed = tText.trim();
  const tNum = trimmed === "" ? null : Number(trimmed);
  const tValid = tNum !== null && Number.isFinite(tNum);
  const allTypes =
    types.length === DEFAULT_VIEW_TYPES.length &&
    DEFAULT_VIEW_TYPES.every((t) => types.includes(t));
  const scoped = Array.isArray(scopeUrns) && scopeUrns.length > 0;
  if (allTypes && !tValid && !accessMode && !scoped) return undefined;
  const view_filter: Partial<ViewFilter> = {};
  if (!allTypes) view_filter.types = [...types];
  if (tValid) view_filter.t = tNum as number;
  if (accessMode) view_filter.access = panelAccessScope(accessMode);
  // Empty scope is the seat-grounded default ("All permitted") — only pin when a seat is chosen.
  if (scoped) view_filter.scope_urns = [...(scopeUrns as string[])];
  return { view_filter };
}

export interface GraphControlsProps {
  search: string;
  onSearchChange: (value: string) => void;
  /** A short hint under the search box (e.g. "no match", "3 matches"). */
  searchHint?: string | null;

  activeTypes: string[];
  onToggleType: (type: string) => void;
  /** The `t` bound as raw input text; "" means unset. */
  t: string;
  onTChange: (value: string) => void;
  onApplyFilter: () => void;
  onResetFilter: () => void;
  /** Whether the current frame is a live read (view_filter is honored). */
  filterHonored: boolean;

  /**
   * SEAT (scope) selector. `permittedWorkspaces` are the current frame's permitted-workspace
   * seats (from provenance.access.permitted_workspaces); `activeScope` is the chosen single seat
   * urn ("" = All permitted, the seat-grounded default). Changing it re-requests the frame with
   * view_filter.scope_urns = [seat] (or [] for All), focusing the view to one seat without
   * pinning any literal urn as the default. Read-only — it only narrows what is rendered.
   */
  permittedWorkspaces: string[];
  activeScope: string;
  onScopeChange: (scopeUrn: string) => void;

  /**
   * Access posture (A3). DEFAULT "anon". The toggle sends ONLY view_filter.access.mode; the
   * identity (user/workstation/role) is resolved by the worker from chrome.storage.local and
   * is unreachable here. Changing it re-requests the frame under the new posture.
   */
  accessMode: AccessPosture;
  onAccessModeChange: (mode: AccessPosture) => void;

  /** Whether a trusted identity is stored — drives the "open Settings" hint, nothing else. */
  identitySet: boolean;
}

export function GraphControls({
  search,
  onSearchChange,
  searchHint,
  activeTypes,
  onToggleType,
  t,
  onTChange,
  onApplyFilter,
  onResetFilter,
  filterHonored,
  permittedWorkspaces,
  activeScope,
  onScopeChange,
  accessMode,
  onAccessModeChange,
  identitySet,
}: GraphControlsProps) {
  const activeSet = new Set(activeTypes);
  const identified = accessMode === "identified";
  // Open by default, user-toggleable, and — being controlled state (the SettingsPanel
  // pattern) — provably immune to any future re-render re-applying the attribute
  // (Copilot #18 review hardening; the uncontrolled form tested fine, this can't regress).
  const [filterOpen, setFilterOpen] = useState(true);
  // Guard the <select> value: if the chosen seat is no longer in the permitted set (e.g. the
  // posture changed), fall back to "All permitted" ("") so the control never shows a phantom option.
  const scopeValue = permittedWorkspaces.includes(activeScope) ? activeScope : "";
  /** Short seat label — the last urn segment (the whole urn stays as the option title). */
  const seatLabel = (urn: string) => urn.split(":").pop() || urn;
  const filterSummary = `${activeTypes.length}/${SELECTABLE_TYPES.length} types · t ${
    t.trim() === "" ? "latest" : t.trim()
  } · seat ${scopeValue ? seatLabel(scopeValue) : "all"}`;
  return (
    <div className="graph-controls" aria-label="Graph controls">
      <div className="gc-row gc-access-row">
        <span className="gc-label" title="Access posture — DEFAULT anon. Sends only the posture; the identity is resolved by the service worker from chrome.storage.local (page-inaccessible).">
          access
        </span>
        <div
          className="gc-access-toggle"
          role="group"
          aria-label="Access posture (default anon)"
        >
          <button
            type="button"
            className={`gc-seg ${!identified ? "is-on" : ""}`}
            aria-pressed={!identified}
            onClick={() => onAccessModeChange("anon")}
            title="Stay anon — see only public workspaces (the default, fail-closed)"
          >
            Stay anon
          </button>
          <button
            type="button"
            className={`gc-seg ${identified ? "is-on" : ""}`}
            aria-pressed={identified}
            onClick={() => onAccessModeChange("identified")}
            title="Bring me in — resolve my trusted identity (worker-only) and show my permitted workspaces"
          >
            Bring me in
          </button>
        </div>
      </div>

      {identified && !identitySet && (
        <div className="gc-identity-hint" role="note">
          no identity set — open Settings (above) to pick one, or you stay anon
        </div>
      )}

      <div className="gc-row">
        <label className="gc-field gc-search">
          <span className="gc-label">find</span>
          <input
            className="gc-input"
            type="search"
            value={search}
            placeholder="urn or label…"
            onChange={(e) => onSearchChange(e.target.value)}
            title="Select + center the first node matching this urn or label"
          />
        </label>
      </div>

      {search.trim() !== "" && searchHint && (
        <div className="gc-hint">{searchHint}</div>
      )}

      {/* t263 item 2: the placement axis is the panel's highest-value settable feature —
          rendered OPEN by default, with the active selection echoed in the summary. */}
      <details
        className="gc-filter"
        open={filterOpen}
        onToggle={(e) => setFilterOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary className="gc-filter-summary">
          view_filter <span className="gc-filter-state">{filterSummary}</span>
        </summary>
        <div className="gc-filter-body">
          <div className="gc-row gc-filter-scope">
            <label className="gc-field gc-scope-field">
              <span className="gc-label">seat</span>
              <select
                className="gc-select gc-scope-select"
                value={scopeValue}
                onChange={(e) => onScopeChange(e.target.value)}
                title="Focus the view to one permitted seat (workspace), or All permitted. Read-only scope — no literal urn is pinned as the default."
              >
                <option value="">All permitted ({permittedWorkspaces.length})</option>
                {permittedWorkspaces.map((urn) => (
                  <option key={urn} value={urn} title={urn}>
                    {seatLabel(urn)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="gc-types">
            {SELECTABLE_TYPES.map((ty) => (
              <label key={ty} className="gc-check" title={ty}>
                <input
                  type="checkbox"
                  checked={activeSet.has(ty)}
                  onChange={() => onToggleType(ty)}
                />
                <span>{ty}</span>
              </label>
            ))}
          </div>
          <div className="gc-row gc-filter-t">
            <label className="gc-field">
              <span className="gc-label">t</span>
              <input
                className="gc-input gc-t-input"
                type="number"
                value={t}
                placeholder="(all)"
                onChange={(e) => onTChange(e.target.value)}
                title="Optional fold time bound (t_day). Leave blank for the latest fold."
              />
            </label>
            <button type="button" className="gc-btn" onClick={onApplyFilter}>
              Apply
            </button>
            <button type="button" className="gc-btn gc-btn-ghost" onClick={onResetFilter}>
              Reset
            </button>
          </div>
          {!filterHonored && (
            <div className="gc-note">
              Mock frame — view_filter is inert until a live engine read.
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
