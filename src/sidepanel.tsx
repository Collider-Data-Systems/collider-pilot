/**
 * Collider Pilot - side panel (the seat)
 * ======================================
 * Read-only seat. Asks the service worker for a frame (live MCP by default, mock
 * fallback), and projects the ONE function the seat exists for:
 *
 *     slice : State × Agent → Context
 *
 * t264 re-cut — the panel is the CONTROL/INSPECT surface; the mirrors carry the picture:
 *   - PostureStrip (one line + audit drawer)
 *   - Slice controls: access posture · lens presets (identity/topology/content/
 *     everything) · focus (spine node) + hops · find · t · advanced types/ports
 *   - LIVE LOG FEED: the engine jsonl, newest first (GET /log tail + /log/stream SSE) —
 *     watching envelopes land IS watching the truth change
 *   - NodeInspector + gated Actions
 *   - Settings (identity/provider/bearer/layout) at the bottom
 *   - the inline graph is OFF by default (toggle in the controls): the PiP / pop-out /
 *     full-tab mirrors render it, and selection syncs both ways through the shared
 *     scratch, so panel-clicks (log feed, inspector, find) light up in the mirrors.
 *
 * SAFETY: still no writes, no page access. EventSource is GET-only — it cannot POST and
 * has no apply path. Every mutating act stays behind the ActionsPanel modal, and urn-typed
 * args are semantically validated against the frame before the modal even opens.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import type {
  FrameRequest,
  HgFrame,
  PilotRequest,
  PilotResponse,
  RawMcpTool,
} from "./mcp/types";
import { loadScratch, saveScratch, subscribeScratch } from "./state/scratch";
import {
  DEFAULT_GRAPH_LAYOUT,
  loadLayoutPref,
  saveLayoutPref,
  DEFAULT_ACCESS_POSTURE,
  loadAccessPosturePref,
  saveAccessPosturePref,
  loadInlineGraphPref,
  saveInlineGraphPref,
  type GraphLayoutName,
  type AccessPosture,
} from "./state/prefs";
import { PostureStrip } from "./components/PostureStrip";
import { FrameGraph } from "./components/FrameGraph";
import {
  GraphControls,
  buildFrameRequest,
  collectFocusOptions,
  defaultSliceSpec,
  specToggleType,
  specTogglePort,
  specWithLens,
  type SliceSpec,
} from "./components/GraphControls";
import { NodeInspector } from "./components/NodeInspector";
import { ActionsPanel } from "./components/ActionsPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { LogFeed } from "./components/LogFeed";
import { PresenceStrip } from "./components/PresenceStrip";
import { useFoldStream } from "./state/use-fold-stream";
import {
  DEFAULT_PROVIDER_ID,
  getProvider,
  providerDefaultModel,
  resolveLLMToken,
  resolveModelName,
  resolveProviderId,
  saveModelName,
  saveProviderId,
} from "./tools/model-providers";
import {
  isPopOutSupported,
  isPipOpen,
  focusPip,
  openPipMirror,
} from "./pip/pip-window";
import { applyMountGuard } from "./ui/mount-guard";
import "./sidepanel.css";

type Status = "loading" | "ready" | "error";

async function requestFrame(request?: FrameRequest): Promise<PilotResponse> {
  // Waking the worker with a message is what restarts it if it was terminated. The
  // request (view_filter) rides along; the worker forwards it to adapter.getFrame().
  return (await chrome.runtime.sendMessage({
    type: "GET_FRAME",
    request,
  } as PilotRequest)) as PilotResponse;
}

/**
 * Phase 4: ask the worker for the MCP tools/list catalog (READ-ONLY discovery). Listing
 * is not calling — no tool is invoked here.
 */
async function requestTools(): Promise<PilotResponse> {
  return (await chrome.runtime.sendMessage({
    type: "LIST_TOOLS",
  } as PilotRequest)) as PilotResponse;
}

/**
 * SURFACE ROOM handshake (see the worker's nameSurfaceRoom). The Z440 launcher opens this
 * page as `sidepanel.html?surface=<key>` inside each generated surface window; we hand the
 * key to the worker, which titles that window's tab group. Fire-and-forget: a failure is
 * logged and changes nothing about the seat.
 *
 * The key travels launcher → our own URL → worker, so no tab title is ever read and the
 * `tabs` permission is not needed. Absent `?surface=` (the docked panel, the pop-out, the
 * full tab) this is a no-op.
 */
function announceSurfaceRoom(): void {
  try {
    const key = new URLSearchParams(window.location.search).get("surface");
    if (!key) return;
    void chrome.runtime
      .sendMessage({ type: "SURFACE_ROOM", surfaceKey: key } as PilotRequest)
      .then((res: PilotResponse) => {
        if (res?.type === "SURFACE_ROOM_OK") {
          console.log(`[pilot] surface room "${res.title}" (${res.grouped} tab(s) grouped)`);
        } else if (res?.type === "SURFACE_ROOM_SKIPPED") {
          console.log(`[pilot] surface room not applicable: ${res.reason}`);
        } else if (res?.type === "ERROR") {
          console.log(`[pilot] surface room failed: ${res.error}`);
        }
      })
      // The try/catch below cannot see an async rejection (a torn-down worker, a closed
      // channel), and an unhandled rejection would surface as console noise on a
      // fire-and-forget nicety (Copilot #24).
      .catch((err: unknown) => {
        console.log("[pilot] surface-room handshake did not complete:", err);
      });
  } catch (err) {
    console.log("[pilot] surface-room handshake unavailable:", err);
  }
}

/** Feature-detect the full-tab route (chrome.tabs.create needs no extra permission). */
function isFullTabSupported(): boolean {
  try {
    return (
      typeof chrome !== "undefined" &&
      !!chrome.tabs?.create &&
      !!chrome.runtime?.getURL
    );
  } catch {
    return false;
  }
}

function SidePanel() {
  const [frame, setFrame] = useState<HgFrame | null>(null);
  const [selectedUrn, setSelectedUrn] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [popOutSupported] = useState(() => isPopOutSupported());
  const [fullTabSupported] = useState(() => isFullTabSupported());
  const [pipOpen, setPipOpen] = useState(false);
  const [liveTools, setLiveTools] = useState<RawMcpTool[] | null>(null);
  const [affordanceError, setAffordanceError] = useState<string | null>(null);

  const [layout, setLayout] = useState<GraphLayoutName>(DEFAULT_GRAPH_LAYOUT);
  const [search, setSearch] = useState("");
  const [searchHint, setSearchHint] = useState<string | null>(null);
  const [focusUrn, setFocusUrn] = useState<string | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);
  // t264: the whole WHAT/WHEN selection is one SliceSpec (lens + types + ports + t + hops).
  const [spec, setSpec] = useState<SliceSpec>(() => defaultSliceSpec());
  // FOCUS (scope). "" = All permitted (the seat-grounded default; no literal urn pinned).
  const [viewScope, setViewScope] = useState<string>("");
  // t264: the inline graph is a pref, default OFF (mirrors carry the picture).
  const [showGraph, setShowGraph] = useState(false);
  // Access posture (A3). DEFAULT anon (fail-closed). The toggle sends ONLY access.mode; the
  // identity is worker-resolved from chrome.storage.local and is unreachable from this panel.
  const [accessMode, setAccessMode] = useState<AccessPosture>(DEFAULT_ACCESS_POSTURE);
  // Whether a trusted identity is stored (reported by the SettingsPanel) — hint-only state.
  const [identitySet, setIdentitySet] = useState(false);

  // Provider/model/bearer selection lives HERE (set in SettingsPanel, consumed by
  // ActionsPanel). Same storage keys as before — only the UI home moved (t263).
  const [providerId, setProviderId] = useState<string>(DEFAULT_PROVIDER_ID);
  const [modelName, setModelName] = useState<string>(() =>
    providerDefaultModel(getProvider(DEFAULT_PROVIDER_ID)),
  );
  const [llmTokenSet, setLlmTokenSet] = useState(false);

  // The currently-applied FrameRequest — a ref so the SSE re-fetch always uses the latest
  // applied filter without re-subscribing the stream.
  const frameRequestRef = useRef<FrameRequest | undefined>(undefined);
  // The last COMMITTED spec — drives the Apply button's pending indicator when the
  // staged drawer edits deviate from what the frame actually shows.
  const [appliedSpec, setAppliedSpec] = useState<SliceSpec>(() => defaultSliceSpec());

  const loadFrame = useCallback(async (request?: FrameRequest) => {
    const req = request ?? frameRequestRef.current;
    setStatus("loading");
    setError(null);
    try {
      const res = await requestFrame(req);
      if (res.type === "FRAME") {
        // Normalize: never let a frame with a missing/non-array nodes/relations reach
        // the renderer (Cytoscape init throws on a non-array).
        const safeFrame: HgFrame = {
          ...res.frame,
          nodes: Array.isArray(res.frame?.nodes) ? res.frame.nodes : [],
          relations: Array.isArray(res.frame?.relations) ? res.frame.relations : [],
        };
        setFrame(safeFrame);
        setStatus("ready");
        setSelectedUrn((prev) => {
          const stillThere =
            prev && safeFrame.nodes.some((n) => n.urn === prev) ? prev : null;
          void saveScratch({ selectedUrn: stillThere, frame: safeFrame });
          return stillThere;
        });
      } else if (res.type === "ERROR") {
        setStatus("error");
        setError(res.error);
      } else {
        setStatus("error");
        setError("unexpected response to GET_FRAME");
      }
    } catch (err) {
      setStatus("error");
      setError(String(err));
    }
  }, []);

  const loadTools = useCallback(async () => {
    try {
      const res = await requestTools();
      if (res?.type === "TOOLS") {
        setLiveTools(Array.isArray(res.tools) ? res.tools : []);
        setAffordanceError(null);
      } else if (res?.type === "ERROR") {
        setLiveTools(null);
        setAffordanceError(res.error);
      }
    } catch (err) {
      setLiveTools(null);
      setAffordanceError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Mount: restore instantly from scratch, load the prefs, then refresh.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [scratch, savedLayout, savedPosture, savedProviderId, savedInline] =
        await Promise.all([
          loadScratch(),
          loadLayoutPref(),
          loadAccessPosturePref(),
          resolveProviderId(),
          loadInlineGraphPref(),
        ]);
      const [savedModel, savedToken] = await Promise.all([
        resolveModelName(getProvider(savedProviderId)),
        resolveLLMToken(),
      ]);
      if (!cancelled) {
        setLayout(savedLayout);
        setAccessMode(savedPosture);
        setProviderId(savedProviderId);
        setModelName(savedModel);
        setLlmTokenSet(savedToken !== "");
        setShowGraph(savedInline);
      }
      if (
        !cancelled &&
        scratch.frame &&
        Array.isArray(scratch.frame.nodes) &&
        Array.isArray(scratch.frame.relations)
      ) {
        setFrame(scratch.frame);
        setSelectedUrn(scratch.selectedUrn);
        setStatus("ready");
      }
      // Seed the first read under the restored posture so an "identified" toggle survives a
      // reopen (default anon on a fresh profile). The worker still resolves the identity.
      const initialReq = buildFrameRequest(defaultSliceSpec(), savedPosture);
      frameRequestRef.current = initialReq;
      await loadFrame(initialReq);
      void loadTools();
      // If the launcher opened us with ?surface=<key>, title that window's tab group.
      announceSurfaceRoom();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadFrame, loadTools]);

  const handleSelect = useCallback(
    (urn: string | null) => {
      setSelectedUrn(urn);
      if (frame) void saveScratch({ selectedUrn: urn, frame });
    },
    [frame],
  );

  // Node search: match by urn/label, then select + center the first hit. Local only.
  const handleSearchChange = useCallback(
    (value: string) => {
      setSearch(value);
      const q = value.trim().toLowerCase();
      if (!q || !frame) {
        setSearchHint(null);
        return;
      }
      const nodes = Array.isArray(frame.nodes) ? frame.nodes : [];
      const matches = nodes.filter(
        (n) =>
          n.urn.toLowerCase().includes(q) ||
          (n.label ?? "").toLowerCase().includes(q),
      );
      if (matches.length === 0) {
        setSearchHint("no match");
        return;
      }
      setSearchHint(
        matches.length === 1 ? "1 match" : `${matches.length} matches — first shown`,
      );
      const hit = matches[0];
      handleSelect(hit.urn);
      if (showGraph) {
        setFocusUrn(hit.urn);
        setFocusSignal((s) => s + 1);
      }
    },
    [frame, handleSelect, showGraph],
  );

  const handleLayoutChange = useCallback((next: GraphLayoutName) => {
    setLayout(next);
    void saveLayoutPref(next);
  }, []);

  const handleToggleGraphVisible = useCallback(() => {
    const next = !showGraph;
    setShowGraph(next);
    void saveInlineGraphPref(next);
  }, [showGraph]);

  // Provider selection (persisted, mirrors adapter-factory). Switching resets the model to
  // the new provider's default; ActionsPanel clears its stale proposal on providerId change.
  const handleProviderChange = useCallback((id: string) => {
    setProviderId(id);
    void saveProviderId(id);
    const name = providerDefaultModel(getProvider(id));
    setModelName(name);
    if (name) void saveModelName(name);
  }, []);

  const handleModelChange = useCallback((name: string) => {
    setModelName(name);
    void saveModelName(name);
  }, []);

  /** Commit a spec + scope: build the request, remember it, re-read the frame. */
  const commitSlice = useCallback(
    (nextSpec: SliceSpec, mode: AccessPosture, scopeUrn: string) => {
      const req = buildFrameRequest(nextSpec, mode, scopeUrn ? [scopeUrn] : []);
      frameRequestRef.current = req;
      setAppliedSpec(nextSpec);
      void loadFrame(req);
    },
    [loadFrame],
  );

  // Lens tap: one-tap slice change — applies immediately. Computed OUTSIDE the state
  // updater (t264 review major: network I/O inside an updater double-fires under
  // StrictMode replay).
  const handleLensChange = useCallback(
    (lensId: string) => {
      const next = specWithLens(spec, lensId);
      setSpec(next);
      commitSlice(next, accessMode, viewScope);
    },
    [spec, accessMode, viewScope, commitSlice],
  );

  // Advanced edits: stage in the spec; Apply commits.
  const toggleType = useCallback((ty: string) => {
    setSpec((prev) => specToggleType(prev, ty));
  }, []);
  const togglePort = useCallback((p: string) => {
    setSpec((prev) => specTogglePort(prev, p));
  }, []);
  const handleTChange = useCallback((t: string) => {
    setSpec((prev) => ({ ...prev, t }));
  }, []);

  // Hops: applies immediately (like lens/focus — a one-value axis). Pure updater.
  const handleHopsChange = useCallback(
    (hops: number) => {
      const next = { ...spec, hops };
      setSpec(next);
      commitSlice(next, accessMode, viewScope);
    },
    [spec, accessMode, viewScope, commitSlice],
  );

  const applyFilter = useCallback(() => {
    commitSlice(spec, accessMode, viewScope);
  }, [spec, accessMode, viewScope, commitSlice]);

  const resetFilter = useCallback(() => {
    const next = defaultSliceSpec();
    setSpec(next);
    setViewScope(""); // reset focus back to All permitted (it is part of the view_filter)
    // Preserve the access posture across a slice reset (it is a separate control).
    commitSlice(next, accessMode, "");
  }, [accessMode, commitSlice]);

  // FOCUS selector. Focus the slice on one spine node (or All permitted when ""). The
  // permitted set is unchanged — this only narrows what is RENDERED. Re-requests under the
  // current posture (worker re-resolves the trusted identity); no literal urn is pinned.
  const handleScopeChange = useCallback(
    (scopeUrn: string) => {
      setViewScope(scopeUrn);
      commitSlice(spec, accessMode, scopeUrn);
    },
    [spec, accessMode, commitSlice],
  );

  // Access-posture toggle. Persists the UI pref (NOT the identity) and re-requests the frame
  // under the new posture. The worker resolves the trusted identity from storage — the toggle
  // only carries `mode`.
  const handleAccessModeChange = useCallback(
    (mode: AccessPosture) => {
      setAccessMode(mode);
      void saveAccessPosturePref(mode);
      // The permitted set changes with the posture, so a previously-chosen focus may no longer
      // be visible — reset focus to All permitted to avoid focusing on an invisible node.
      setViewScope("");
      commitSlice(spec, mode, "");
    },
    [spec, commitSlice],
  );

  // Mirror the PiP window: adopt SELECTION changes from the shared scratch (frame is
  // panel-authored, so scratch frame changes are ignored here). Event-driven, no polling.
  useEffect(() => {
    const unsub = subscribeScratch((s) => {
      setSelectedUrn((prev) => (s.selectedUrn === prev ? prev : s.selectedUrn));
    });
    return unsub;
  }, []);

  // LIVE frames. Only when the current frame is a live read (mock === false). `isLive` is
  // a boolean, so it stays stable across frame refreshes (true stays true): the hook opens
  // the stream once when live-ness turns on and closes it when it turns off / on unmount.
  const isLive = frame != null && frame.provenance?.mock === false;
  const reloadForStream = useCallback(() => void loadFrame(), [loadFrame]);
  const { status: streamStatus, pulseKey } = useFoldStream({
    active: isLive,
    onReload: reloadForStream,
  });

  const handlePopOut = useCallback(() => {
    if (!popOutSupported) return;
    if (isPipOpen()) {
      focusPip();
      return;
    }
    openPipMirror({
      onOpen: () => setPipOpen(true),
      onClose: () => setPipOpen(false),
    });
  }, [popOutSupported]);

  // Open the read-only mirror (pip.html) in a full browser tab. Feature-detected.
  // surface=tab keeps the NodeInspector there (the lean-down applies to the PiP only).
  const handleFullTab = useCallback(() => {
    if (!fullTabSupported) return;
    try {
      void chrome.tabs.create({ url: chrome.runtime.getURL("pip.html") + "?surface=tab" });
    } catch (err) {
      console.error("[pilot] full-tab open failed:", err);
    }
  }, [fullTabSupported]);

  const selectedNode = useMemo(
    () => frame?.nodes.find((n) => n.urn === selectedUrn) ?? null,
    [frame, selectedUrn],
  );

  // The permitted seats — the derived access fiber's permitted_workspaces (empty until an
  // access-scoped frame has been read). Read-only projection of provenance.
  const permittedWorkspaces = useMemo(
    () => frame?.provenance?.access?.permitted_workspaces ?? [],
    [frame],
  );

  // Focusable spine nodes from the current frame + the permitted workspaces.
  const focusOptions = useMemo(
    () => collectFocusOptions(frame, permittedWorkspaces),
    [frame, permittedWorkspaces],
  );

  return (
    <div className="pilot-container">
      <header className="pilot-header">
        <div className="header-left">
          <span
            className={`status-dot ${status === "ready" ? "connected" : status === "error" ? "disconnected" : ""}`}
            title={status}
          />
          <h1>Collider Pilot</h1>
          {/* The LIVE / READ-ONLY / ACCESS badges render ONLY on the PostureStrip below. */}
        </div>
        <div className="header-right">
          <button
            className="pip-btn"
            onClick={handleFullTab}
            disabled={!fullTabSupported}
            title={
              fullTabSupported
                ? "Open the read-only mirror (graph + inspector) in a full browser tab"
                : "Full-tab is unavailable in this context"
            }
          >
            Full tab ⛶
          </button>
          <button
            className={`pip-btn ${pipOpen ? "is-active" : ""}`}
            onClick={handlePopOut}
            disabled={!popOutSupported}
            title={
              popOutSupported
                ? pipOpen
                  ? "Mirror window is open — click to focus it"
                  : "Pop out a mirror window of this frame"
                : "Pop-out is unavailable in this context"
            }
          >
            Pop out ⧉
          </button>
          <button
            className="icon-btn"
            onClick={() => void loadFrame()}
            title="Reload frame (force-refresh; also the manual resync)"
          >
            ⟳
          </button>
        </div>
      </header>

      {frame && (
        <PostureStrip
          provenance={frame.provenance}
          streamStatus={isLive ? streamStatus : "off"}
          pulseKey={pulseKey}
        />
      )}
      {/* Pre-frame posture fallback: loading/error states must still declare the seat's
          posture somewhere until the full strip can render. */}
      {!frame && (
        <section className="provenance posture-strip" aria-label="Frame posture (no frame)">
          <div className="prov-top">
            <span
              className="prov-badge readonly"
              title="No write path exists: mutating acts are confirmation-gated; HG rewrites are review-only previews that are never posted."
            >
              READ-ONLY
            </span>
            <span className="prov-summary">
              no frame loaded — provenance renders with the frame
            </span>
          </div>
        </section>
      )}

      <main className="pilot-body">
        {status === "loading" && !frame && (
          <div className="pilot-state">Loading frame…</div>
        )}
        {status === "error" && !frame && (
          <div className="pilot-state error">
            Could not load frame: {error}
            <button className="retry-btn" onClick={() => void loadFrame()}>
              Retry
            </button>
          </div>
        )}
        {frame && (
          <>
            <GraphControls
              search={search}
              onSearchChange={handleSearchChange}
              searchHint={searchHint}
              spec={spec}
              onLensChange={handleLensChange}
              onToggleType={toggleType}
              onTogglePort={togglePort}
              onTChange={handleTChange}
              onHopsChange={handleHopsChange}
              onApplyFilter={applyFilter}
              onResetFilter={resetFilter}
              filterHonored={isLive}
              focusOptions={focusOptions}
              activeScope={viewScope}
              onScopeChange={handleScopeChange}
              selectedUrn={selectedUrn}
              accessMode={accessMode}
              onAccessModeChange={handleAccessModeChange}
              identitySet={identitySet}
              showGraph={showGraph}
              onToggleGraphVisible={handleToggleGraphVisible}
              dirty={JSON.stringify({ t: spec.types, p: spec.ports, tt: spec.t }) !== JSON.stringify({ t: appliedSpec.types, p: appliedSpec.ports, tt: appliedSpec.t })}
            />
            {showGraph && (
              <FrameGraph
                frame={frame}
                selectedUrn={selectedUrn}
                onSelect={handleSelect}
                layout={layout}
                focusUrn={focusUrn}
                focusSignal={focusSignal}
              />
            )}
            {/* t264: the engine jsonl, live. Self-hides on mock frames. */}
            <ErrorBoundary>
              <LogFeed live={isLive} frame={frame} accessMode={accessMode} onSelect={handleSelect} />
            </ErrorBoundary>
            {/* P9 WebTransport spike: synthetic presence strip. Self-hides when the
                pilot.wt flag is off / WebTransport is unavailable / the connect fails.
                READ-ONLY, feature-flagged OFF by default. */}
            <ErrorBoundary>
              <PresenceStrip />
            </ErrorBoundary>
            <NodeInspector
              frame={frame}
              node={selectedNode}
              onSelect={handleSelect}
              collapsible
            />
            <ErrorBoundary>
              <ActionsPanel
                frame={frame}
                selectedUrn={selectedUrn}
                liveTools={liveTools}
                affordanceError={affordanceError}
                providerId={providerId}
                modelName={modelName}
                llmTokenSet={llmTokenSet}
              />
            </ErrorBoundary>
            {/* Settings last: durable choices, rarely touched (identity/provider/layout). */}
            <ErrorBoundary>
              <SettingsPanel
                frame={frame}
                accessMode={accessMode}
                onReloadFrame={() => void loadFrame()}
                onIdentityChanged={setIdentitySet}
                layout={layout}
                onLayoutChange={handleLayoutChange}
                provider={{
                  providerId,
                  onProviderChange: handleProviderChange,
                  modelName,
                  onModelChange: handleModelChange,
                  llmTokenSet,
                  onLlmTokenChanged: setLlmTokenSet,
                  access: frame.provenance?.access ?? null,
                }}
              />
            </ErrorBoundary>
          </>
        )}
      </main>
    </div>
  );
}

const container = document.getElementById("root");
if (container) {
  // Dev-bridge guard: this page is web-accessible from localhost, so it refuses to
  // render embedded and never auto-connects when a script opened the window.
  const mount = () =>
    createRoot(container).render(<ErrorBoundary><SidePanel /></ErrorBoundary>);
  if (applyMountGuard(container, mount)) mount();
}
