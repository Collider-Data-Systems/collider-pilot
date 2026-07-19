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

import { useEffect, useState } from "react";
import type { GraphLayoutName, AccessPosture } from "../state/prefs";
import { GRAPH_LAYOUTS } from "../state/prefs";
import type { AccessScope, FrameRequest, ViewFilter } from "../mcp/types";
import type { PilotAccessConfig } from "../state/access-identity";
import {
  loadPilotAccess,
  savePilotAccess,
  clearPilotAccess,
  isIdentitySet,
} from "../state/access-config";

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

  /**
   * Re-request the frame under the CURRENTLY-applied view_filter + access.mode (the parent
   * re-sends GET_FRAME so the worker re-reads the trusted identity from chrome.storage.local).
   * The identity control calls this after writing/clearing `pilot.access` so the header/graph
   * update without a manual reload.
   */
  onReloadFrame: () => void;
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
  permittedWorkspaces,
  activeScope,
  onScopeChange,
  accessMode,
  onAccessModeChange,
  onReloadFrame,
}: GraphControlsProps) {
  const activeSet = new Set(activeTypes);
  const identified = accessMode === "identified";
  // Guard the <select> value: if the chosen seat is no longer in the permitted set (e.g. the
  // posture changed), fall back to "All permitted" ("") so the control never shows a phantom option.
  const scopeValue = permittedWorkspaces.includes(activeScope) ? activeScope : "";
  /** Short seat label — the last urn segment (the whole urn stays as the option title). */
  const seatLabel = (urn: string) => urn.split(":").pop() || urn;
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

      <IdentityControl accessMode={accessMode} onReloadFrame={onReloadFrame} />

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

/**
 * IdentityControl (A3) — populate the trusted access identity FROM THE UI.
 * ========================================================================
 * The missing half of the ACCESS toggle: "Bring me in" resolves the identity ONLY from
 * `chrome.storage.local['pilot.access']` (worker-side, src/state/access-identity.ts). With no
 * identity set it fail-closes to anon, so the workspaces come up empty and the user is stuck
 * unless they open DevTools. This control writes that key — and ONLY that key — from the panel.
 *
 * READ-ONLY w.r.t. the HG: the sole side effect is `chrome.storage.local['pilot.access']`
 * (via src/state/access-config.ts). It never writes the HG, never a secret, and the input is
 * panel-authored (extension-origin, trusted) — no page value drives it. On save/clear it asks
 * the parent to re-request the frame so the worker re-reads the identity live.
 */
function IdentityControl({
  accessMode,
  onReloadFrame,
}: {
  accessMode: AccessPosture;
  onReloadFrame: () => void;
}) {
  const [current, setCurrent] = useState<PilotAccessConfig | null>(null);
  const [userText, setUserText] = useState("");
  const [wsText, setWsText] = useState("");
  const [open, setOpen] = useState(false);

  // On mount: read the CURRENT stored identity so the readout + inputs reflect reality.
  useEffect(() => {
    let cancelled = false;
    void loadPilotAccess().then((cfg) => {
      if (cancelled) return;
      setCurrent(cfg);
      if (cfg?.user) setUserText(cfg.user);
      if (cfg?.workstation) setWsText(cfg.workstation);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const identitySet = isIdentitySet(current);
  const canSave = userText.trim().length > 0;
  // The exact confusion this fixes: "Bring me in" is selected but no identity backs it, so the
  // worker fail-closes to anon and the permitted workspaces come up empty. Guide the user here.
  const showHint = accessMode === "identified" && !identitySet;

  // Auto-expand when the user lands in that empty "Bring me in" state so the inputs are right
  // there. A manual collapse sticks (the effect only fires when the deps CHANGE into that state).
  useEffect(() => {
    if (accessMode === "identified" && !identitySet) setOpen(true);
  }, [accessMode, identitySet]);

  const handleSave = async () => {
    if (!canSave) return;
    await savePilotAccess(userText.trim(), wsText.trim() || null);
    setCurrent(await loadPilotAccess());
    onReloadFrame(); // re-send GET_FRAME under the current mode; the worker re-reads identity
  };

  const handleClear = async () => {
    await clearPilotAccess();
    setCurrent(await loadPilotAccess()); // -> null
    onReloadFrame(); // worker resolves anon; header/graph revert without a manual reload
  };

  return (
    <div className="gc-identity">
      {showHint && (
        <div className="gc-identity-hint" role="note">
          set your identity below to load your workspaces
        </div>
      )}
      <details
        className="gc-identity-disclosure"
        open={open}
        onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary className="gc-identity-summary">
          <span className="gc-label">identity</span>
          {identitySet ? (
            <span className="gc-identity-urn" title={current?.user ?? ""}>
              {current?.user}
            </span>
          ) : (
            <span className="gc-identity-none">no identity set — anon only</span>
          )}
        </summary>
        <div className="gc-identity-body">
          <label className="gc-field">
            <span className="gc-label">user urn</span>
            <input
              className="gc-input"
              type="text"
              value={userText}
              placeholder="urn:moos:user:sam"
              onChange={(e) => setUserText(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              title="The trusted user urn resolved for 'Bring me in' (worker reads it from storage)."
            />
          </label>
          <label className="gc-field">
            <span className="gc-label">workstation urn (optional)</span>
            <input
              className="gc-input"
              type="text"
              value={wsText}
              placeholder="urn:moos:workstation:hp-z440"
              onChange={(e) => setWsText(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              title="Optional workstation urn. A client-tier claim (not cert-bound); the ∩ is skipped at PRESENTATION."
            />
          </label>
          <div className="gc-identity-actions">
            <button
              type="button"
              className="gc-btn"
              onClick={() => void handleSave()}
              disabled={!canSave}
              title="Write this identity to chrome.storage.local['pilot.access'] and reload the frame"
            >
              Save identity
            </button>
            <button
              type="button"
              className="gc-btn gc-btn-ghost"
              onClick={() => void handleClear()}
              disabled={!current}
              title="Remove the stored identity — back to anon-only"
            >
              Clear
            </button>
          </div>
          <div className="gc-note">
            writes only <code>chrome.storage.local['pilot.access']</code> — never the HG, never a secret.
          </div>
        </div>
      </details>
    </div>
  );
}
