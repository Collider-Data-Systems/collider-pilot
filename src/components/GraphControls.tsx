/**
 * Collider Pilot - graph toolbar controls (Phase 6)
 * =================================================
 * A compact, controlled controls strip mounted above the graph in the side panel. Three
 * local, read-only affordances — NONE of them writes to the HG:
 *
 *   1. layout picker   — switches the cytoscape-core layout (concentric/breadthfirst/grid)
 *   2. node search     — filters nodes by urn/label; the panel selects + centers the hit
 *   3. view_filter     — type checkboxes + an optional `t`, re-requesting the frame with
 *                        `FrameRequest.view_filter` (the live adapter honors it; the mock
 *                        adapter ignores it, so a note is shown when the frame is mock)
 *
 * Purely presentational + controlled: every value comes in as a prop and every change is
 * lifted to the panel via a callback. No state, no I/O, no adapter here.
 */

import type { GraphLayoutName, AccessPosture } from "../state/prefs";
import { GRAPH_LAYOUTS } from "../state/prefs";
import type { AccessScope, FrameRequest, ViewFilter } from "../mcp/types";

/** The node types the view_filter can toggle (matches the graph legend + transform). */
export const SELECTABLE_TYPES = [
  "knowledge_item",
  "derivation",
  "purpose",
  "session",
] as const;

/** The default (all-types) view_filter selection. */
export const DEFAULT_VIEW_TYPES: string[] = [...SELECTABLE_TYPES];

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
 * Build a FrameRequest from a draft view_filter + access posture. When `accessMode` is
 * supplied, the request always carries `view_filter.access` (mode only) so the toggle flows;
 * otherwise it returns undefined for the untouched default (all types, no `t`) so the legacy
 * path stays a bare frame request. Shared by the side panel and the live harness.
 */
export function buildFrameRequest(
  types: string[],
  tText: string,
  accessMode?: AccessPosture,
): FrameRequest | undefined {
  const trimmed = tText.trim();
  const tNum = trimmed === "" ? null : Number(trimmed);
  const tValid = tNum !== null && Number.isFinite(tNum);
  const allTypes =
    types.length === DEFAULT_VIEW_TYPES.length &&
    DEFAULT_VIEW_TYPES.every((t) => types.includes(t));
  if (allTypes && !tValid && !accessMode) return undefined;
  const view_filter: Partial<ViewFilter> = {};
  if (!allTypes) view_filter.types = [...types];
  if (tValid) view_filter.t = tNum as number;
  if (accessMode) view_filter.access = panelAccessScope(accessMode);
  return { view_filter };
}

const LAYOUT_LABEL: Record<GraphLayoutName, string> = {
  concentric: "Concentric",
  breadthfirst: "Breadth-first",
  grid: "Grid",
};

export interface GraphControlsProps {
  layout: GraphLayoutName;
  onLayoutChange: (layout: GraphLayoutName) => void;

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
   * Access posture (A3). DEFAULT "anon". The toggle sends ONLY view_filter.access.mode; the
   * identity (user/workstation/role) is resolved by the worker from chrome.storage.local and
   * is unreachable here. Changing it re-requests the frame under the new posture.
   */
  accessMode: AccessPosture;
  onAccessModeChange: (mode: AccessPosture) => void;
}

export function GraphControls({
  layout,
  onLayoutChange,
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
  accessMode,
  onAccessModeChange,
}: GraphControlsProps) {
  const activeSet = new Set(activeTypes);
  const identified = accessMode === "identified";
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

      <div className="gc-row">
        <label className="gc-field">
          <span className="gc-label">layout</span>
          <select
            className="gc-select"
            value={layout}
            onChange={(e) => onLayoutChange(e.target.value as GraphLayoutName)}
            title="Graph layout (all ship in cytoscape core)"
          >
            {GRAPH_LAYOUTS.map((l) => (
              <option key={l} value={l}>
                {LAYOUT_LABEL[l]}
              </option>
            ))}
          </select>
        </label>

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

      <details className="gc-filter">
        <summary className="gc-filter-summary">view_filter</summary>
        <div className="gc-filter-body">
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
