/**
 * Collider Pilot - consolidated settings block (t263 UX eval, items 3 + 4)
 * ========================================================================
 * ONE coherent, collapsible settings surface instead of controls scattered between the
 * graph toolbar and the Actions section. It holds every durable choice the panel offers:
 *
 *   identity   — the trusted A3 identity (chrome.storage.local['pilot.access']), now set
 *                via PICKERS fed from the fold (user / workstation nodes and urn-shaped
 *                property values in the current frame) with a raw-URN escape hatch
 *                (item 3 — no more freehand-typing urns as the only path).
 *   engine     — which engine surfaceless windows read (t278): this box, a fleet engine,
 *                or a custom REST + MCP pair with an optional urn label (t337),
 *   provider   — the LLM provider + model (moved out of the Actions section),
 *   LLM bearer — the scope-split /llm/* token with set/clear (t263, #63),
 *   layout     — the graph layout pref (moved out of the graph toolbar).
 *
 * SAFETY UNCHANGED, BYTE-FOR-BYTE IN BEHAVIOR: this component only re-homes existing
 * controls. The identity editor still writes ONLY `pilot.access` (via access-config.ts;
 * the worker re-resolves it on the next GET_FRAME); the bearer still lands in
 * `pilot.llmToken` (scope-split — it can never write to the HG); provider/model/layout are
 * plain chrome.storage prefs. Nothing here touches the HG, the transport, or the gates.
 *
 * The provider section is optional (the live preview harness mounts identity+layout only).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AccessResolution, HgFrame } from "../mcp/types";
import type { AccessPosture, GraphLayoutName } from "../state/prefs";
import { GRAPH_LAYOUTS } from "../state/prefs";
import type { PilotAccessConfig } from "../state/access-identity";
import {
  loadPilotAccess,
  savePilotAccess,
  clearPilotAccess,
  isIdentitySet,
} from "../state/access-config";
import {
  MODEL_PROVIDERS,
  clearLLMToken,
  getProvider,
  isCloudProvider,
  isProviderAvailable,
  resolveLLMToken,
  saveLLMToken,
} from "../tools/model-providers";
import { evaluateEgress } from "../tools/llm-provider";
import {
  loadPilotEngine,
  normalizeEngineConfig,
  savePilotEngine,
  type PilotEngineConfig,
} from "../mcp/adapter-factory";
import { FLEET_ENGINES } from "../mcp/surface-resolver.js";
import { resolveGraphLayout } from "./FrameGraph";

const LAYOUT_LABEL: Record<GraphLayoutName, string> = {
  auto: "Auto",
  concentric: "Concentric",
  breadthfirst: "Breadth-first",
  grid: "Grid",
  nested: "Nested",
};

const USER_URN_PATTERN = /^urn:moos:user:\S+$/;
const WORKSTATION_URN_PATTERN = /^urn:moos:workstation:\S+$/;
const ANON_URN = "urn:moos:user:anon";

/** The sentinel <option> value that reveals the raw escape hatch (a urn, or engine URLs). */
const CUSTOM = "__custom__";

/**
 * Identity candidates FED FROM THE FOLD (item 3): user/workstation nodes rendered in the
 * frame, urn-shaped property values on any frame node (owner_urn, occupant, …), and the
 * access fiber's own principals. Pure projection — reading candidates never writes.
 */
export function collectIdentityCandidates(frame: HgFrame | null): {
  users: string[];
  workstations: string[];
} {
  const users = new Set<string>();
  const workstations = new Set<string>();
  const consider = (v: unknown) => {
    if (typeof v !== "string") return;
    if (USER_URN_PATTERN.test(v) && v !== ANON_URN) users.add(v);
    if (WORKSTATION_URN_PATTERN.test(v)) workstations.add(v);
  };
  for (const n of Array.isArray(frame?.nodes) ? frame!.nodes : []) {
    if (n.type_id === "user") consider(n.urn);
    if (n.type_id === "workstation") consider(n.urn);
    for (const k of Object.keys(n.properties ?? {})) consider(n.properties[k]);
  }
  const access = frame?.provenance?.access;
  consider(access?.scope?.user);
  consider(access?.scope?.workstation);
  for (const u of Array.isArray(access?.role_topology) ? access.role_topology : []) {
    consider(u);
  }
  return { users: [...users].sort(), workstations: [...workstations].sort() };
}

/** Short urn tail for option labels; the full urn stays in the option title. */
const urnTail = (urn: string) => urn.split(":").pop() || urn;

/**
 * The fleet entry a stored engine config IS — same transport pair AND urn — or undefined
 * (t337). Anything else stored under `pilot.engine` is a custom engine and must be shown
 * as one, with its URLs.
 */
const fleetEngineFor = (cfg: PilotEngineConfig) =>
  FLEET_ENGINES.find(
    (e) =>
      e.engineUrl === cfg.engineUrl &&
      e.mcpBaseUrl === cfg.mcpBaseUrl &&
      e.engineUrn === cfg.engineUrn,
  );

/** A typed engine URL as it is stored: trimmed, no trailing slash (`${url}/healthz`). */
const trimEngineUrl = (value: string) => value.trim().replace(/\/+$/, "");

export interface SettingsProviderProps {
  providerId: string;
  onProviderChange: (id: string) => void;
  modelName: string;
  onModelChange: (name: string) => void;
  llmTokenSet: boolean;
  onLlmTokenChanged: (set: boolean) => void;
  /** The frame's derived access fiber — drives the egress preview line. */
  access: AccessResolution | null;
}

export interface SettingsPanelProps {
  frame: HgFrame | null;
  accessMode: AccessPosture;
  /** Re-request the frame (the worker re-reads the trusted identity from storage). */
  onReloadFrame: () => void;
  /** Lifted so the toolbar can hint "no identity set — open Settings". */
  onIdentityChanged?: (set: boolean) => void;
  layout: GraphLayoutName;
  onLayoutChange: (layout: GraphLayoutName) => void;
  /** Omit to hide the provider/bearer section (e.g. the live preview harness). */
  provider?: SettingsProviderProps;
}

export function SettingsPanel({
  frame,
  accessMode,
  onReloadFrame,
  onIdentityChanged,
  layout,
  onLayoutChange,
  provider,
}: SettingsPanelProps) {
  const [current, setCurrent] = useState<PilotAccessConfig | null>(null);
  const identitySet = isIdentitySet(current);
  // t342: stored, but not a user urn — "Bring me in" then permits the public workspaces only:
  // the frame keeps those and the unattributed nodes, and every other seat is hidden.
  const identityMalformed = identitySet && !USER_URN_PATTERN.test(current?.user ?? "");
  const [open, setOpen] = useState(false);
  // Whether the stored identity has actually been READ yet. The auto-expand below must
  // wait for it: before the async chrome.storage read resolves, identitySet is a
  // transient false, and gating on it alone auto-opened the drawer on EVERY panel open
  // for legitimately-identified users (t263 review major).
  const [identityLoaded, setIdentityLoaded] = useState(false);

  // Auto-expand when "Bring me in" is selected with no identity backing it — the exact
  // stuck-at-anon state this block exists to fix. Only once the stored identity has
  // resolved (see above). A manual collapse sticks.
  useEffect(() => {
    if (identityLoaded && accessMode === "identified" && (!identitySet || identityMalformed)) {
      setOpen(true);
    }
  }, [identityLoaded, accessMode, identitySet, identityMalformed]);

  const activeProvider = provider ? getProvider(provider.providerId) : null;

  // t337: the layout DRAWN for the current frame — `auto` (no explicit choice) is nested
  // on a frame with nesting relations and concentric otherwise.
  const drawnLayoutLabel = useMemo(
    () => LAYOUT_LABEL[resolveGraphLayout(layout, frame)].toLowerCase(),
    [layout, frame],
  );

  const summary = useMemo(() => {
    const parts: string[] = [
      identitySet && current?.user ? urnTail(current.user) : "no identity",
    ];
    if (provider && activeProvider) {
      parts.push(
        activeProvider.kind === "manual"
          ? "manual"
          : `${activeProvider.id} · ${provider.modelName}`,
      );
    }
    parts.push(drawnLayoutLabel);
    return parts.join(" · ");
  }, [identitySet, current, provider, activeProvider, drawnLayoutLabel]);

  return (
    <details
      className="settings-panel"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="settings-summary">
        <span className="gc-label">settings</span>
        <span className="settings-summary-state" title={current?.user ?? ""}>
          {summary}
        </span>
      </summary>
      <div className="settings-body">
        <IdentitySection
          frame={frame}
          accessMode={accessMode}
          current={current}
          setCurrent={(cfg) => {
            setCurrent(cfg);
            onIdentityChanged?.(isIdentitySet(cfg));
          }}
          onLoaded={() => setIdentityLoaded(true)}
          onReloadFrame={onReloadFrame}
        />
        <EngineSection onReloadFrame={onReloadFrame} />
        {provider && <ProviderSection {...provider} />}
        <div className="settings-section">
          <div className="settings-section-title">layout</div>
          <select
            className="gc-select"
            value={layout}
            onChange={(e) => onLayoutChange(e.target.value as GraphLayoutName)}
            title="Graph layout (cytoscape core only). Auto: nested boxes when the frame has nesting relations, concentric otherwise. Any other choice is drawn as chosen."
          >
            {GRAPH_LAYOUTS.map((l) => (
              <option key={l} value={l}>
                {l === "auto" ? `${LAYOUT_LABEL[l]} (${drawnLayoutLabel})` : LAYOUT_LABEL[l]}
              </option>
            ))}
          </select>
        </div>
      </div>
    </details>
  );
}

/**
 * IdentitySection (A3) — the trusted-identity editor, picker-first (item 3).
 * The write path is UNCHANGED from the previous IdentityControl: the sole side effect is
 * `chrome.storage.local['pilot.access']` via access-config.ts. Only the INPUT surface
 * changed — a <select> fed from the fold, with "custom urn…" revealing the raw escape
 * hatch. On save/clear the parent re-requests the frame so the worker re-reads identity.
 */
function IdentitySection({
  frame,
  accessMode,
  current,
  setCurrent,
  onLoaded,
  onReloadFrame,
}: {
  frame: HgFrame | null;
  accessMode: AccessPosture;
  current: PilotAccessConfig | null;
  setCurrent: (cfg: PilotAccessConfig | null) => void;
  /** Fired once the stored identity has been read (gates the parent's auto-expand). */
  onLoaded: () => void;
  onReloadFrame: () => void;
}) {
  const candidates = useMemo(() => collectIdentityCandidates(frame), [frame]);

  // Picker selection ("" = unset, CUSTOM = raw escape hatch) + the raw drafts.
  const [userPick, setUserPick] = useState<string>("");
  const [userText, setUserText] = useState("");
  const [wsPick, setWsPick] = useState<string>("");
  const [wsText, setWsText] = useState("");

  // On mount: read the CURRENT stored identity so the readout + inputs reflect reality.
  // A stored urn that the fold doesn't offer selects the escape hatch, not a phantom option.
  useEffect(() => {
    let cancelled = false;
    void loadPilotAccess().then((cfg) => {
      if (cancelled) return;
      setCurrent(cfg);
      if (cfg?.user) {
        setUserText(cfg.user);
        setUserPick(candidates.users.includes(cfg.user) ? cfg.user : CUSTOM);
      }
      if (cfg?.workstation) {
        setWsText(cfg.workstation);
        setWsPick(candidates.workstations.includes(cfg.workstation) ? cfg.workstation : CUSTOM);
      }
      onLoaded();
    });
    return () => {
      cancelled = true;
    };
    // Mount-only: candidates arriving later must not clobber in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Candidates are frame-reactive but the picks were classified against the candidates
  // available at load time. If a picked urn later DROPS OUT of the candidate list (frame
  // refresh, posture change), migrate it to the escape hatch instead of letting the
  // <select> render blank while Save stays enabled on the stale value (t263 review catch).
  useEffect(() => {
    if (userPick !== "" && userPick !== CUSTOM && !candidates.users.includes(userPick)) {
      setUserText(userPick);
      setUserPick(CUSTOM);
    }
    if (wsPick !== "" && wsPick !== CUSTOM && !candidates.workstations.includes(wsPick)) {
      setWsText(wsPick);
      setWsPick(CUSTOM);
    }
  }, [candidates, userPick, wsPick]);

  const identitySet = isIdentitySet(current);
  const showHint = accessMode === "identified" && !identitySet;

  const effectiveUser = userPick === CUSTOM ? userText.trim() : userPick;
  const effectiveWs = wsPick === CUSTOM ? wsText.trim() : wsPick;
  // t342: only a user urn can be saved. A bare "sam" used to save: it resolves no governs
  // closure and owns no session, so "Bring me in" drew public + unattributed nodes only
  // (431 of 447 on the scratch fold, every seat hidden) while the strip still read "sam".
  const userValid = USER_URN_PATTERN.test(effectiveUser) && effectiveUser !== ANON_URN;
  const wsValid = effectiveWs === "" || WORKSTATION_URN_PATTERN.test(effectiveWs);
  const canSave = userValid && wsValid;
  const storedMalformed = identitySet && !USER_URN_PATTERN.test(current?.user ?? "");

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    await savePilotAccess(effectiveUser, effectiveWs || null);
    setCurrent(await loadPilotAccess());
    onReloadFrame(); // re-send GET_FRAME under the current mode; the worker re-reads identity
  }, [canSave, effectiveUser, effectiveWs, setCurrent, onReloadFrame]);

  const handleClear = useCallback(async () => {
    await clearPilotAccess();
    setCurrent(await loadPilotAccess()); // -> null
    setUserPick("");
    setUserText("");
    setWsPick("");
    setWsText("");
    onReloadFrame(); // worker resolves anon; strip/graph revert without a manual reload
  }, [setCurrent, onReloadFrame]);

  return (
    <div className="settings-section">
      <div className="settings-section-title">
        identity
        {identitySet ? (
          <span className="gc-identity-urn" title={current?.user ?? ""}>
            {current?.user}
          </span>
        ) : (
          <span className="gc-identity-none">no identity set — anon only</span>
        )}
      </div>
      {showHint && (
        <div className="gc-identity-hint" role="note">
          "Bring me in" is on but no identity is set — pick one below to load your
          workspaces
        </div>
      )}
      {storedMalformed && (
        <div className="gc-identity-hint" role="alert">
          the stored user "{current?.user}" is not a user urn — it owns no workspace, so
          "Bring me in" draws the public workspaces and unattributed nodes only — every other
          seat is hidden. Pick urn:moos:user:… below and save.
        </div>
      )}
      <label className="gc-field">
        <span className="gc-label">user</span>
        <select
          className="gc-select"
          value={userPick}
          onChange={(e) => setUserPick(e.target.value)}
          title="User urns found in the current frame (user nodes, owner/occupant properties, role topology). Pick one, or 'custom urn…' to type it."
        >
          <option value="">— pick a user —</option>
          {candidates.users.map((u) => (
            <option key={u} value={u} title={u}>
              {urnTail(u)}
            </option>
          ))}
          <option value={CUSTOM}>custom urn…</option>
        </select>
      </label>
      {candidates.users.length === 0 && (
        <div className="gc-note">
          no user candidates in this frame — the default view_filter slice omits
          user/workstation nodes (enable those types and Apply), or use custom urn…
        </div>
      )}
      {userPick === CUSTOM && (
        <label className="gc-field">
          <span className="gc-label">user urn (raw)</span>
          <input
            className="gc-input"
            type="text"
            value={userText}
            placeholder="urn:moos:user:sam"
            onChange={(e) => setUserText(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            title="Raw escape hatch — the trusted user urn resolved for 'Bring me in' (worker reads it from storage)."
          />
        </label>
      )}
      {userPick === CUSTOM && userText.trim() !== "" && !userValid && (
        <div className="gc-note">not a user urn — write urn:moos:user:&lt;name&gt;</div>
      )}
      <label className="gc-field">
        <span className="gc-label">workstation (optional)</span>
        <select
          className="gc-select"
          value={wsPick}
          onChange={(e) => setWsPick(e.target.value)}
          title="Optional workstation urn. A client-tier claim (not cert-bound); the ∩ is skipped at PRESENTATION."
        >
          <option value="">— none —</option>
          {candidates.workstations.map((u) => (
            <option key={u} value={u} title={u}>
              {urnTail(u)}
            </option>
          ))}
          <option value={CUSTOM}>custom urn…</option>
        </select>
      </label>
      {wsPick === CUSTOM && (
        <label className="gc-field">
          <span className="gc-label">workstation urn (raw)</span>
          <input
            className="gc-input"
            type="text"
            value={wsText}
            placeholder="urn:moos:workstation:hp-z440"
            onChange={(e) => setWsText(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
        </label>
      )}
      {/* t342: Save is disabled for this too, so say why, as for the user urn above. */}
      {wsPick === CUSTOM && wsText.trim() !== "" && !wsValid && (
        <div className="gc-note">
          not a workstation urn — write urn:moos:workstation:&lt;name&gt;, or pick none
        </div>
      )}
      <div className="gc-identity-actions">
        <button
          type="button"
          className="gc-btn"
          data-testid="identity-save"
          onClick={() => void handleSave()}
          disabled={!canSave}
          title="Write this identity to chrome.storage.local['pilot.access'] and reload the frame"
        >
          Save identity
        </button>
        <button
          type="button"
          className="gc-btn gc-btn-danger"
          data-testid="identity-clear"
          onClick={() => void handleClear()}
          disabled={!current}
          title="Remove the stored identity — back to anon-only"
        >
          Clear identity
        </button>
      </div>
      <div className="gc-note">
        writes only <code>chrome.storage.local['pilot.access']</code> — never the HG, never
        a secret.
      </div>
    </div>
  );
}

/**
 * EngineSection (t278) — which fleet engine surfaceless windows read. The pick writes
 * `chrome.storage.local['pilot.engine']`; the worker's storage.onChanged listener drops
 * its adapter memo, and the reload re-reads through the new default. READ-ONLY like the
 * whole seat: this changes which engine is READ, never what can be written (nothing
 * can). A `?surface=` window's own verified engine resolution still wins. WHAT a user
 * sees on any engine stays the A3 access posture's decision, not this picker's.
 *
 * t337: "custom engine…" reads an engine the fleet directory does not list — two URLs
 * (REST + MCP) and an optional urn label, stored through the SAME `pilot.engine` key. The
 * picker also tells the truth about what is stored: a stored pair that is not a fleet
 * entry shows as custom WITH its URLs. It used to fall through to "This box" while the
 * frame was read from somewhere else.
 */
function EngineSection({ onReloadFrame }: { onReloadFrame: () => void }) {
  // "" = the build-time localhost default (this box); a fleet engine urn; or CUSTOM.
  const [pick, setPick] = useState<string>("");
  // What is actually stored, and the custom drafts compared against it (t337).
  const [stored, setStored] = useState<PilotEngineConfig | null>(null);
  const [restText, setRestText] = useState("");
  const [mcpText, setMcpText] = useState("");
  const [urnText, setUrnText] = useState("");

  useEffect(() => {
    let cancelled = false;
    void loadPilotEngine().then((cfg) => {
      if (cancelled) return;
      setStored(cfg);
      if (!cfg) return;
      const fleet = fleetEngineFor(cfg);
      if (fleet) {
        setPick(fleet.engineUrn);
        return;
      }
      setPick(CUSTOM);
      setRestText(cfg.engineUrl ?? "");
      setMcpText(cfg.mcpBaseUrl ?? "");
      setUrnText(cfg.engineUrn ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePick = useCallback(
    async (urn: string) => {
      setPick(urn);
      // Choosing "custom engine…" only reveals the inputs — nothing is written, and the
      // stored engine keeps being read, until the pair below is explicitly stored.
      if (urn === CUSTOM) return;
      const engine = FLEET_ENGINES.find((e) => e.engineUrn === urn);
      const next = engine
        ? {
            engineUrl: engine.engineUrl,
            mcpBaseUrl: engine.mcpBaseUrl,
            engineUrn: engine.engineUrn,
          }
        : null;
      await savePilotEngine(next);
      setStored(next);
      onReloadFrame(); // the worker rebuilt its adapters on the storage change
    },
    [onReloadFrame],
  );

  // The custom draft, validated by the same normalizer storage is read with: null until
  // BOTH URLs are http(s). A urn label the normalizer would drop blocks the save instead
  // of being discarded silently.
  const urnLabel = urnText.trim();
  const draft = normalizeEngineConfig({
    engineUrl: trimEngineUrl(restText),
    mcpBaseUrl: trimEngineUrl(mcpText),
    ...(urnLabel ? { engineUrn: urnLabel } : {}),
  });
  const urnRejected = urnLabel !== "" && draft !== null && draft.engineUrn !== urnLabel;
  const customApplied =
    draft !== null &&
    stored !== null &&
    draft.engineUrl === stored.engineUrl &&
    draft.mcpBaseUrl === stored.mcpBaseUrl &&
    draft.engineUrn === stored.engineUrn;
  const canApplyCustom = draft !== null && !urnRejected && !customApplied;

  const handleApplyCustom = async () => {
    if (!draft || urnRejected) return;
    await savePilotEngine(draft);
    setStored(draft);
    onReloadFrame(); // the worker rebuilt its adapters on the storage change
  };

  return (
    <div className="settings-section">
      <div className="settings-section-title">engine</div>
      <select
        className="gc-select"
        value={pick}
        onChange={(e) => void handlePick(e.target.value)}
        title="Default engine for surfaceless windows (docked panel / pop-out / PiP). A ?surface= window still resolves its own engine. Read-only either way."
      >
        <option value="">This box (localhost — default)</option>
        {FLEET_ENGINES.map((e) => (
          <option key={e.engineUrn} value={e.engineUrn} title={e.engineUrn}>
            {e.label} · {urnTail(e.engineUrn)}
          </option>
        ))}
        <option value={CUSTOM}>custom engine…</option>
      </select>
      {pick === CUSTOM && (
        <>
          <label className="gc-field">
            <span className="gc-label">engine REST URL</span>
            <input
              className="gc-input"
              type="text"
              value={restText}
              placeholder="http://localhost:8000"
              onChange={(e) => setRestText(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              title="REST base of the engine — /healthz, the log feed and the fold stream are read from it."
            />
          </label>
          <label className="gc-field">
            <span className="gc-label">MCP base URL</span>
            <input
              className="gc-input"
              type="text"
              value={mcpText}
              placeholder="http://localhost:8080"
              onChange={(e) => setMcpText(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              title="MCP Streamable HTTP base — the frame is read with POST {this}/sse. Its origin must be listed in the extension manifest's host_permissions, or the browser blocks the read."
            />
          </label>
          <label className="gc-field">
            <span className="gc-label">engine urn (optional label)</span>
            <input
              className="gc-input"
              type="text"
              value={urnText}
              placeholder="urn:moos:kernel:…"
              onChange={(e) => setUrnText(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              title="Optional. Stamped into provenance as the engine this pair is EXPECTED to be. Left empty, the frame is stamped with what the engine reports on /healthz — or as an unidentified engine when it reports nothing."
            />
          </label>
          {urnRejected && (
            <div className="gc-identity-hint" role="note">
              the label must be a kernel urn (urn:moos:kernel:…) — or leave it empty
            </div>
          )}
          <div className="gc-identity-actions">
            <button
              type="button"
              className="gc-btn"
              data-testid="engine-use-custom"
              onClick={() => void handleApplyCustom()}
              disabled={!canApplyCustom}
              title="Write this pair to chrome.storage.local['pilot.engine'] and reload the frame"
            >
              Use custom engine
            </button>
          </div>
          <div className="gc-note">
            {customApplied
              ? "stored — surfaceless windows read this pair"
              : stored
                ? `not stored yet — the default engine is still ${stored.engineUrl}`
                : "not stored yet — the default engine is still this box (localhost)"}
          </div>
        </>
      )}
      <div className="gc-note">
        writes only <code>chrome.storage.local['pilot.engine']</code> — a read target,
        never a write path. Access posture decides what is visible on any engine.
      </div>
    </div>
  );
}

/**
 * ProviderSection — the LLM provider/model/bearer controls, verbatim from the Actions
 * section (item 4 re-homing). The bearer save re-derives the SET flag from an actual
 * storage read-back (the Copilot #17 catch preserved) and reports it up so the Actions
 * section can hint "set the bearer in Settings" without holding token state itself.
 */
function ProviderSection({
  providerId,
  onProviderChange,
  modelName,
  onModelChange,
  llmTokenSet,
  onLlmTokenChanged,
  access,
}: SettingsProviderProps) {
  const activeProvider = getProvider(providerId);
  const [tokenDraft, setTokenDraft] = useState("");

  const handleSaveToken = useCallback(() => {
    const tok = tokenDraft.trim();
    if (!tok) return;
    void saveLLMToken(tok)
      .then(() => resolveLLMToken())
      .then((stored) => {
        onLlmTokenChanged(stored !== "");
        if (stored !== "") setTokenDraft("");
      });
  }, [tokenDraft, onLlmTokenChanged]);

  const handleClearToken = useCallback(() => {
    void clearLLMToken()
      .then(() => resolveLLMToken())
      .then((stored) => onLlmTokenChanged(stored !== ""));
  }, [onLlmTokenChanged]);

  const egressPreview = isCloudProvider(activeProvider)
    ? evaluateEgress(activeProvider, access)
    : null;

  return (
    <div className="settings-section">
      <div className="settings-section-title">model provider</div>
      <select
        className="provider-select"
        value={providerId}
        onChange={(e) => onProviderChange(e.target.value)}
      >
        {MODEL_PROVIDERS.map((p) => {
          const avail = isProviderAvailable(p);
          return (
            <option key={p.id} value={p.id} disabled={!avail}>
              {p.label}
              {!avail ? " (pending kernel-proxy)" : ""}
            </option>
          );
        })}
      </select>
      {activeProvider.models && activeProvider.models.length > 1 && (
        <select
          className="provider-select model-select"
          value={modelName}
          onChange={(e) => onModelChange(e.target.value)}
          title="Model id sent to the endpoint (persisted to chrome.storage.local['pilot.modelName'])"
        >
          {activeProvider.models.map((m) => (
            <option key={m} value={m}>
              {m}
              {m === activeProvider.model
                ? " (default · structured tool_calls)"
                : " (fallback path)"}
            </option>
          ))}
        </select>
      )}
      <div className="provider-note">{activeProvider.note}</div>
      {activeProvider.viaKernelProxy && (
        <div className="llm-token-row">
          <input
            type="password"
            className="llm-token-input"
            placeholder={
              llmTokenSet
                ? "LLM bearer set — paste to replace"
                : "paste the scope-split LLM bearer (secrets/moos-llm-token)"
            }
            value={tokenDraft}
            onChange={(e) => setTokenDraft(e.target.value)}
            autoComplete="off"
            title="Stored as chrome.storage.local['pilot.llmToken']. Scope-split: this token reaches /llm/* only — it can never write to the HG. Never paste the fleet write token here."
          />
          <button
            className="mini-btn"
            data-testid="llm-token-save"
            onClick={handleSaveToken}
            disabled={!tokenDraft.trim()}
          >
            save
          </button>
          <button
            className="mini-btn"
            data-testid="llm-token-clear"
            onClick={handleClearToken}
            disabled={!llmTokenSet}
            title="Remove the stored bearer from chrome.storage (revoke/rotate)"
          >
            clear
          </button>
          <span className={`llm-token-state ${llmTokenSet ? "ok" : "missing"}`}>
            {llmTokenSet ? "set" : "required"}
          </span>
        </div>
      )}
      {egressPreview && (
        <div className={`provider-egress ${egressPreview.allowed ? "ok" : "blocked"}`}>
          cloud egress: {egressPreview.allowed ? "permitted" : "BLOCKED"} —{" "}
          {egressPreview.reason}
        </div>
      )}
    </div>
  );
}
