/**
 * Collider Pilot - slice controls (t264 re-cut of the Phase 6 graph toolbar)
 * ==========================================================================
 * The control surface for the ONE function the panel projects:
 *
 *     slice : State × Agent → Context          (t263 ratification, "the same function")
 *
 * Every control here is one of its arguments; nothing else earns panel space:
 *
 *   WHO    — access posture ("Stay anon" / "Bring me in"; identity set in Settings)
 *   WHERE  — focus: All permitted, or one spine node (manifold / group / workspace /
 *            channel / the current selection), expanded scope_hops BFS steps out
 *   WHAT   — a LENS preset (identity · topology · content · everything) that sets the
 *            node types + relation ports together; the raw checkboxes live in the
 *            advanced drawer and flip the lens to "custom" when they deviate
 *   WHEN   — the optional t bound
 *
 * The inline graph is OFF by default (t264: the PiP / pop-out / full-tab mirrors carry
 * the picture; selection syncs both ways through the shared scratch) — the toggle here
 * turns it back on for mirror-less use.
 *
 * Presentational + controlled: every VALUE comes in as a prop and every change is lifted
 * to the panel via a callback. The only local state is the advanced drawer's open flag.
 * No I/O, no adapter here.
 */

import { useState } from "react";
import type { AccessPosture } from "../state/prefs";
import type { AccessScope, FrameRequest, HgFrame, ViewFilter } from "../mcp/types";

/* -------------------------------------------------------------------------- */
/* Lens presets — named (types × ports) slices matching the doctrine strata   */
/* -------------------------------------------------------------------------- */

export interface Lens {
  id: string;
  label: string;
  /** Node type_ids the lens retains. ["*"] = all (the transform's sentinel). */
  types: string[];
  /** Relation port labels the lens retains. [] = all. */
  ports: string[];
  title: string;
}

export const LENSES: Lens[] = [
  {
    id: "identity",
    label: "identity",
    types: ["user", "group", "agent", "role", "manifold"],
    ports: ["member-of", "governs", "delegates-to", "owns", "spans", "presents-as"],
    title:
      "The A1 identity poset: who is who, who belongs to what, who governs whom (user · group · agent · role · manifold + member-of / governs / delegates-to / owns / spans).",
  },
  {
    id: "topology",
    label: "topology",
    types: [
      "session",
      "kernel",
      "workstation",
      "router",
      "channel",
      "manifold",
      "twin_link",
      "endpoint",
      "agent",
    ],
    ports: ["opens-on", "has-occupant", "hosts", "routes-to", "spans", "realizes", "composes"],
    title:
      "Machines, workspaces, channels and how they connect (session · kernel · workstation · router · channel · manifold + opens-on / has-occupant / hosts / routes-to / spans).",
  },
  {
    id: "content",
    label: "content",
    types: [
      "knowledge_item",
      "derivation",
      "program",
      "grammar_fragment",
      "purpose",
      "session",
      "domain_tag",
    ],
    ports: [
      "provides-kb",
      "classifies",
      "pins-urn",
      "cites",
      "depends-on",
      "causes",
      "produces",
      "composes",
      "has-purpose",
      "curates",
    ],
    title:
      "Knowledge and work products: knowledge items, derivations, applied programs, grammar fragments (+ provides-kb / pins-urn / cites / causes …).",
  },
  {
    id: "everything",
    label: "everything",
    types: ["*"],
    ports: [],
    title: "The whole permitted fold — every node type, every relation. The full manifold view.",
  },
];

/** The lens id used when the advanced checkboxes deviate from every preset. */
export const CUSTOM_LENS_ID = "custom";

/** Default lens on open — continuity with the classic four-type content slice. */
export const DEFAULT_LENS_ID = "content";

export function lensById(id: string): Lens | null {
  return LENSES.find((l) => l.id === id) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Advanced drawer vocab — grouped node types and relation ports              */
/* -------------------------------------------------------------------------- */

/** Node types offered in the advanced drawer, grouped for scanability. */
export const TYPE_GROUPS: { label: string; types: string[] }[] = [
  { label: "principals", types: ["user", "group", "agent", "role"] },
  {
    label: "places",
    types: [
      "session",
      "kernel",
      "workstation",
      "router",
      "channel",
      "manifold",
      "twin_link",
      "endpoint",
    ],
  },
  {
    label: "content",
    types: [
      "knowledge_item",
      "derivation",
      "program",
      "grammar_fragment",
      "domain_tag",
      "claim",
      "source_feed",
    ],
  },
  {
    label: "governance & ops",
    types: [
      "purpose",
      "governance_proposal",
      "t_hook",
      "watcher",
      "guard",
      "reactor",
      "system_instruction",
      "classification_scheme",
      "shard_rule",
      "calendar_event",
      "git_issue",
      "agent_session",
    ],
  },
];

/** Relation ports offered in the advanced drawer, grouped by family. */
export const PORT_GROUPS: { label: string; ports: string[] }[] = [
  { label: "identity/authority", ports: ["owns", "member-of", "governs", "delegates-to"] },
  {
    label: "placement",
    ports: ["opens-on", "has-occupant", "hosts", "routes-to", "spans", "realizes", "presents-as"],
  },
  {
    label: "content/flow",
    ports: [
      "provides-kb",
      "classifies",
      "pins-urn",
      "cites",
      "depends-on",
      "composes",
      "produces",
      "causes",
      "triggers",
      "has-purpose",
      "curates",
      "scheduled-after",
      "focus",
    ],
  },
];

/** Legacy alias kept for the harnesses/tests: the classic default slice. */
export const DEFAULT_VIEW_TYPES: string[] =
  LENSES.find((l) => l.id === DEFAULT_LENS_ID)!.types;

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

/** The full slice specification the panel holds — one value per axis. */
export interface SliceSpec {
  lens: string; // lens id, or "custom"
  types: string[]; // effective type selection (["*"] = all)
  ports: string[]; // effective port selection ([] = all)
  t: string; // raw t text; "" = latest
  hops: number; // scope BFS depth (1..4)
}

/** The spec a fresh panel opens with. */
export function defaultSliceSpec(): SliceSpec {
  const lens = lensById(DEFAULT_LENS_ID)!;
  return { lens: lens.id, types: [...lens.types], ports: [...lens.ports], t: "", hops: 1 };
}

/** Every type / port the advanced drawer offers (flattened). */
export const ALL_TYPES: string[] = TYPE_GROUPS.flatMap((g) => g.types);
export const ALL_PORTS: string[] = PORT_GROUPS.flatMap((g) => g.ports);

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && b.every((x) => a.includes(x));

/** The lens id whose (types × ports) exactly matches — or "custom". */
export function matchLens(types: string[], ports: string[]): string {
  for (const l of LENSES) {
    if (sameSet(types, l.types) && sameSet(ports, l.ports)) return l.id;
  }
  return CUSTOM_LENS_ID;
}

/** Apply a lens preset to a spec (t and hops survive; types/ports are replaced). */
export function specWithLens(spec: SliceSpec, lensId: string): SliceSpec {
  const lens = lensById(lensId);
  if (!lens) return spec;
  return { ...spec, lens: lens.id, types: [...lens.types], ports: [...lens.ports] };
}

/**
 * Toggle one node type in a spec. The ["*"] sentinel concretizes to the full drawer
 * list first; re-completing the full list collapses back to ["*"]. The lens field is
 * re-derived (a deviation flips it to "custom"; landing exactly on a preset names it).
 *
 * The LAST remaining type cannot be unticked (Copilot #21 catch): an empty `types`
 * array is the transform's legacy "fall back to the default slice" signal, so a
 * 0-type UI state would silently request a 4-type frame. Refusing the final untick
 * keeps the UI and the request telling the same story.
 */
export function specToggleType(spec: SliceSpec, ty: string): SliceSpec {
  const base = spec.types.includes("*") ? [...ALL_TYPES] : [...spec.types];
  const next = base.includes(ty) ? base.filter((t) => t !== ty) : [...base, ty];
  if (next.length === 0) return spec; // never emit [] — it would silently mean "default"
  const types = sameSet(next, ALL_TYPES) ? ["*"] : next;
  return { ...spec, types, lens: matchLens(types, spec.ports) };
}

/**
 * Toggle one relation port. [] (= all) concretizes first; full list collapses to [].
 * Same last-item guard as types (Copilot #21 catch, mirrored): [] means ALL ports in
 * the transform, so unticking the final port would silently flip the slice from
 * "one port" to "every port".
 */
export function specTogglePort(spec: SliceSpec, p: string): SliceSpec {
  const base = spec.ports.length === 0 ? [...ALL_PORTS] : [...spec.ports];
  const next = base.includes(p) ? base.filter((x) => x !== p) : [...base, p];
  if (next.length === 0) return spec; // never emit [] — it would silently mean "all"
  const ports = sameSet(next, ALL_PORTS) ? [] : next;
  return { ...spec, ports, lens: matchLens(spec.types, ports) };
}

/**
 * Build a FrameRequest from the slice spec + access posture + optional focus scope.
 * When `accessMode` is supplied the request always carries `view_filter.access` (mode
 * only) so the toggle flows; a non-empty `scopeUrns` pins the focus. Returns undefined
 * for the fully-default spec with no posture (legacy bare request ⇒ transform defaults).
 * Shared by the side panel and the harnesses.
 */
export function buildFrameRequest(
  spec: SliceSpec,
  accessMode?: AccessPosture,
  scopeUrns?: string[],
): FrameRequest | undefined {
  const def = defaultSliceSpec();
  const trimmed = spec.t.trim();
  const tNum = trimmed === "" ? null : Number(trimmed);
  const tValid = tNum !== null && Number.isFinite(tNum);
  const sameTypes =
    spec.types.length === def.types.length && def.types.every((t) => spec.types.includes(t));
  const samePorts =
    spec.ports.length === def.ports.length && def.ports.every((p) => spec.ports.includes(p));
  const isDefault = sameTypes && samePorts && !tValid && spec.hops === 1;
  const scoped = Array.isArray(scopeUrns) && scopeUrns.length > 0;
  if (isDefault && !accessMode && !scoped) return undefined;
  const view_filter: Partial<ViewFilter> = {};
  view_filter.types = [...spec.types];
  if (spec.ports.length > 0) view_filter.ports = [...spec.ports];
  if (tValid) view_filter.t = tNum as number;
  if (spec.hops !== 1) view_filter.scope_hops = spec.hops;
  if (spec.lens) view_filter.lens = spec.lens;
  if (accessMode) view_filter.access = panelAccessScope(accessMode);
  // Empty scope is the seat-grounded default ("All permitted") — only pin when a focus is chosen.
  if (scoped) view_filter.scope_urns = [...(scopeUrns as string[])];
  return { view_filter };
}

/* -------------------------------------------------------------------------- */
/* Focus options — the spine nodes the current frame offers to focus on       */
/* -------------------------------------------------------------------------- */

export interface FocusOption {
  urn: string;
  label: string;
  group: string;
}

const FOCUS_TYPE_GROUPS: Record<string, string> = {
  manifold: "manifold",
  group: "groups",
  session: "workspaces",
  channel: "channels",
};

/**
 * Focusable spine nodes from the CURRENT frame plus the permitted workspaces from
 * provenance (which may not be rendered as nodes under a narrow lens). Grouped
 * manifold → groups → workspaces → channels.
 */
export function collectFocusOptions(
  frame: HgFrame | null,
  permittedWorkspaces: string[],
): FocusOption[] {
  const seen = new Set<string>();
  const out: FocusOption[] = [];
  const push = (urn: string, group: string) => {
    if (seen.has(urn)) return;
    seen.add(urn);
    out.push({ urn, label: urn.split(":").pop() || urn, group });
  };
  for (const n of Array.isArray(frame?.nodes) ? frame!.nodes : []) {
    const group = FOCUS_TYPE_GROUPS[n.type_id];
    if (group) push(n.urn, group);
  }
  for (const u of permittedWorkspaces) push(u, "workspaces");
  const order = ["manifold", "groups", "workspaces", "channels"];
  return out.sort(
    (a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.label.localeCompare(b.label),
  );
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export interface GraphControlsProps {
  search: string;
  onSearchChange: (value: string) => void;
  /** A short hint under the search box (e.g. "no match", "3 matches"). */
  searchHint?: string | null;

  /** The full slice spec (lens + types + ports + t + hops). */
  spec: SliceSpec;
  /** Lens tap: parent sets spec to the lens's types/ports (or keeps custom edits). */
  onLensChange: (lensId: string) => void;
  onToggleType: (type: string) => void;
  onTogglePort: (port: string) => void;
  onTChange: (value: string) => void;
  onHopsChange: (hops: number) => void;
  onApplyFilter: () => void;
  onResetFilter: () => void;
  /** Whether the current frame is a live read (view_filter is honored). */
  filterHonored: boolean;

  /** FOCUS (scope). Options from collectFocusOptions; "" = All permitted. */
  focusOptions: FocusOption[];
  activeScope: string;
  onScopeChange: (scopeUrn: string) => void;
  /** The currently-selected node urn, offered as a one-tap focus target. */
  selectedUrn: string | null;

  /**
   * Access posture (A3). DEFAULT "anon". The toggle sends ONLY view_filter.access.mode; the
   * identity (user/workstation/role) is resolved by the worker from chrome.storage.local and
   * is unreachable here. Changing it re-requests the frame under the new posture.
   */
  accessMode: AccessPosture;
  onAccessModeChange: (mode: AccessPosture) => void;

  /** Whether a trusted identity is stored — drives the "open Settings" hint, nothing else. */
  identitySet: boolean;

  /** Inline-graph visibility (t264: OFF by default; mirrors carry the picture). */
  showGraph: boolean;
  onToggleGraphVisible: () => void;
}

export function GraphControls({
  search,
  onSearchChange,
  searchHint,
  spec,
  onLensChange,
  onToggleType,
  onTogglePort,
  onTChange,
  onHopsChange,
  onApplyFilter,
  onResetFilter,
  filterHonored,
  focusOptions,
  activeScope,
  onScopeChange,
  selectedUrn,
  accessMode,
  onAccessModeChange,
  identitySet,
  showGraph,
  onToggleGraphVisible,
}: GraphControlsProps) {
  const identified = accessMode === "identified";
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const typeSet = new Set(spec.types);
  const allTypes = typeSet.has("*");
  const portSet = new Set(spec.ports);
  const allPorts = portSet.size === 0;
  // The focus select must always DISPLAY the actual focus (Copilot #21 catch): a
  // "focus selection" target or a focus that dropped out of the spine options
  // (lens/posture change) gets a synthetic "(focused)" entry rather than the select
  // silently falling back to "All permitted" while the request stays pinned.
  const displayOptions =
    activeScope && !focusOptions.some((o) => o.urn === activeScope)
      ? [
          { urn: activeScope, label: activeScope.split(":").pop() || activeScope, group: "(focused)" },
          ...focusOptions,
        ]
      : focusOptions;
  const scopeValue = displayOptions.some((o) => o.urn === activeScope) ? activeScope : "";
  const groups = [...new Set(displayOptions.map((o) => o.group))];

  const stateEcho = `${allTypes ? "all" : spec.types.length} types · ${
    allPorts ? "all" : spec.ports.length
  } ports · t ${spec.t.trim() === "" ? "latest" : spec.t.trim()} · ${spec.hops} hop${spec.hops > 1 ? "s" : ""}`;

  return (
    <div className="graph-controls" aria-label="Slice controls">
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
        <button
          type="button"
          className={`gc-seg gc-graph-toggle ${showGraph ? "is-on" : ""}`}
          aria-pressed={showGraph}
          onClick={onToggleGraphVisible}
          title={
            showGraph
              ? "Hide the inline graph (the PiP / pop-out / full-tab mirrors keep showing it; selection stays synced)"
              : "Show the graph inline in this panel (it also lives in the PiP / pop-out / full-tab mirrors)"
          }
        >
          {showGraph ? "graph: inline" : "graph: mirrors"}
        </button>
      </div>

      {identified && !identitySet && (
        <div className="gc-identity-hint" role="note">
          no identity set — open Settings (below) to pick one, or you stay anon
        </div>
      )}

      {/* WHAT — the lens row. One tap per stratum; custom when the drawer deviates. */}
      <div className="gc-row gc-lens-row" role="group" aria-label="Lens">
        {LENSES.map((l) => (
          <button
            key={l.id}
            type="button"
            className={`gc-seg gc-lens ${spec.lens === l.id ? "is-on" : ""}`}
            aria-pressed={spec.lens === l.id}
            onClick={() => onLensChange(l.id)}
            title={l.title}
          >
            {l.label}
          </button>
        ))}
        {spec.lens === CUSTOM_LENS_ID && (
          <span className="gc-lens-custom" title="The advanced selection deviates from every preset.">
            custom
          </span>
        )}
      </div>

      {/* WHERE — focus + hops. */}
      <div className="gc-row gc-filter-scope">
        <label className="gc-field gc-scope-field">
          <span className="gc-label">focus</span>
          <select
            className="gc-select gc-scope-select"
            value={scopeValue}
            onChange={(e) => onScopeChange(e.target.value)}
            title="Focus the slice on one spine node (manifold / group / workspace / channel), expanded `hops` steps out along the retained relations. All permitted = no focus."
          >
            <option value="">All permitted</option>
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {displayOptions
                  .filter((o) => o.group === g)
                  .map((o) => (
                    <option key={o.urn} value={o.urn} title={o.urn}>
                      {o.label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="gc-field">
          <span className="gc-label">hops</span>
          <select
            className="gc-select gc-hops-select"
            value={String(spec.hops)}
            onChange={(e) => onHopsChange(Number(e.target.value))}
            title="How many relation steps out from the focus to include (BFS along the retained ports)."
          >
            {[1, 2, 3, 4].map((h) => (
              <option key={h} value={String(h)}>
                {h}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="gc-btn gc-btn-ghost gc-focus-sel"
          disabled={!selectedUrn}
          onClick={() => selectedUrn && onScopeChange(selectedUrn)}
          title={
            selectedUrn
              ? `Focus the slice on the selected node (${selectedUrn})`
              : "Select a node first (graph or log feed), then focus on it"
          }
        >
          focus selection
        </button>
      </div>

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
        <label className="gc-field">
          <span className="gc-label">t</span>
          <input
            className="gc-input gc-t-input"
            type="number"
            value={spec.t}
            placeholder="(all)"
            onChange={(e) => onTChange(e.target.value)}
            title="Optional fold time bound (t_day). Leave blank for the latest fold."
          />
        </label>
        <button type="button" className="gc-btn" onClick={onApplyFilter} title="Re-request the frame under the current slice">
          Apply
        </button>
        <button type="button" className="gc-btn gc-btn-ghost" onClick={onResetFilter} title="Back to the default content lens, no focus, latest t">
          Reset
        </button>
      </div>

      {search.trim() !== "" && searchHint && (
        <div className="gc-hint">{searchHint}</div>
      )}

      {/* Advanced — the raw degrees of freedom behind the lens. */}
      <details
        className="gc-filter"
        open={advancedOpen}
        onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary className="gc-filter-summary">
          advanced <span className="gc-filter-state">{stateEcho}</span>
        </summary>
        <div className="gc-filter-body">
          <div className="gc-adv-note">
            node types {allTypes && <em>(everything — untick to narrow)</em>}
          </div>
          {TYPE_GROUPS.map((g) => (
            <div key={g.label} className="gc-types gc-type-group">
              <span className="gc-group-label">{g.label}</span>
              {g.types.map((ty) => (
                <label key={ty} className="gc-check" title={ty}>
                  <input
                    type="checkbox"
                    checked={allTypes || typeSet.has(ty)}
                    onChange={() => onToggleType(ty)}
                  />
                  <span>{ty}</span>
                </label>
              ))}
            </div>
          ))}
          <div className="gc-adv-note">
            relation ports {allPorts && <em>(everything — untick to narrow)</em>}
          </div>
          {PORT_GROUPS.map((g) => (
            <div key={g.label} className="gc-types gc-type-group">
              <span className="gc-group-label">{g.label}</span>
              {g.ports.map((p) => (
                <label key={p} className="gc-check" title={p}>
                  <input
                    type="checkbox"
                    checked={allPorts || portSet.has(p)}
                    onChange={() => onTogglePort(p)}
                  />
                  <span>{p}</span>
                </label>
              ))}
            </div>
          ))}
          {!filterHonored && (
            <div className="gc-note">
              Mock frame — the slice is inert until a live engine read.
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
