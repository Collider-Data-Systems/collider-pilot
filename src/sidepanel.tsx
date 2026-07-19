/**
 * Collider Pilot - side panel (the seat)
 * ======================================
 * Read-only seat. Asks the service worker for a frame (live MCP by default, mock
 * fallback), renders the provenance header + Cytoscape inspector + textual node inspector
 * + gated Actions, and keeps selection/frame in chrome.storage.session so the panel
 * restores after a forced service-worker termination.
 *
 * PHASE 6 additions (all read-only, all in the panel):
 *   - graph layout picker (concentric default) + node search (select + center a hit)
 *   - view_filter controls (type toggles + optional t) that re-request the frame
 *   - LIVE frames: when the frame is a live read, subscribe to the kernel SSE
 *     (GET :8000/fold/stream) and DEBOUNCE a full adapter re-fetch on each `rewrite`,
 *     pulsing a LIVE indicator; reconnect with backoff and resync on reconnect. The MOCK
 *     path never opens a stream. The manual ⟳ stays as a force-refresh.
 *   - "Open full tab" opens the read-only mirror (pip.html) in a browser tab.
 *
 * SAFETY: still no model, no writes, no page access. EventSource is GET-only — it cannot
 * POST and has no apply path. Every mutating act stays behind the ActionsPanel modal.
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
  type GraphLayoutName,
  type AccessPosture,
} from "./state/prefs";
import { ProvenanceHeader } from "./components/ProvenanceHeader";
import { FrameGraph } from "./components/FrameGraph";
import {
  GraphControls,
  DEFAULT_VIEW_TYPES,
  buildFrameRequest,
} from "./components/GraphControls";
import { NodeInspector } from "./components/NodeInspector";
import { ActionsPanel } from "./components/ActionsPanel";
import { useFoldStream } from "./state/use-fold-stream";
import {
  isPopOutSupported,
  isPipOpen,
  focusPip,
  openPipMirror,
} from "./pip/pip-window";
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

  // Phase 6 UI state (all local, read-only).
  const [layout, setLayout] = useState<GraphLayoutName>(DEFAULT_GRAPH_LAYOUT);
  const [search, setSearch] = useState("");
  const [searchHint, setSearchHint] = useState<string | null>(null);
  const [focusUrn, setFocusUrn] = useState<string | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);
  const [viewTypes, setViewTypes] = useState<string[]>(DEFAULT_VIEW_TYPES);
  const [viewT, setViewT] = useState("");
  // Access posture (A3). DEFAULT anon (fail-closed). The toggle sends ONLY access.mode; the
  // identity is worker-resolved from chrome.storage.local and is unreachable from this panel.
  const [accessMode, setAccessMode] = useState<AccessPosture>(DEFAULT_ACCESS_POSTURE);

  // The currently-applied FrameRequest — a ref so the SSE re-fetch always uses the latest
  // applied filter without re-subscribing the stream.
  const frameRequestRef = useRef<FrameRequest | undefined>(undefined);

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

  // Mount: restore instantly from scratch, load the layout pref, then refresh.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [scratch, savedLayout, savedPosture] = await Promise.all([
        loadScratch(),
        loadLayoutPref(),
        loadAccessPosturePref(),
      ]);
      if (!cancelled) setLayout(savedLayout);
      if (!cancelled) setAccessMode(savedPosture);
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
      const initialReq = buildFrameRequest(DEFAULT_VIEW_TYPES, "", savedPosture);
      frameRequestRef.current = initialReq;
      await loadFrame(initialReq);
      void loadTools();
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
      setFocusUrn(hit.urn);
      setFocusSignal((s) => s + 1);
    },
    [frame, handleSelect],
  );

  const handleLayoutChange = useCallback((next: GraphLayoutName) => {
    setLayout(next);
    void saveLayoutPref(next);
  }, []);

  const toggleType = useCallback((type: string) => {
    setViewTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  }, []);

  const applyFilter = useCallback(() => {
    const req = buildFrameRequest(viewTypes, viewT, accessMode);
    frameRequestRef.current = req;
    void loadFrame(req);
  }, [viewTypes, viewT, accessMode, loadFrame]);

  const resetFilter = useCallback(() => {
    setViewTypes(DEFAULT_VIEW_TYPES);
    setViewT("");
    // Preserve the access posture across a view_filter reset (it is a separate control).
    const req = buildFrameRequest(DEFAULT_VIEW_TYPES, "", accessMode);
    frameRequestRef.current = req;
    void loadFrame(req);
  }, [accessMode, loadFrame]);

  // Access-posture toggle. Persists the UI pref (NOT the identity) and re-requests the frame
  // under the new posture. The worker resolves the trusted identity from storage — the toggle
  // only carries `mode`.
  const handleAccessModeChange = useCallback(
    (mode: AccessPosture) => {
      setAccessMode(mode);
      void saveAccessPosturePref(mode);
      const req = buildFrameRequest(viewTypes, viewT, mode);
      frameRequestRef.current = req;
      void loadFrame(req);
    },
    [viewTypes, viewT, loadFrame],
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
  const handleFullTab = useCallback(() => {
    if (!fullTabSupported) return;
    try {
      void chrome.tabs.create({ url: chrome.runtime.getURL("pip.html") });
    } catch (err) {
      console.error("[pilot] full-tab open failed:", err);
    }
  }, [fullTabSupported]);

  const selectedNode = useMemo(
    () => frame?.nodes.find((n) => n.urn === selectedUrn) ?? null,
    [frame, selectedUrn],
  );

  const liveLabel =
    streamStatus === "reconnecting" ? "RECONNECTING" : "LIVE";

  return (
    <div className="pilot-container">
      <header className="pilot-header">
        <div className="header-left">
          <span
            className={`status-dot ${status === "ready" ? "connected" : status === "error" ? "disconnected" : ""}`}
            title={status}
          />
          <h1>Collider Pilot</h1>
          <span className="header-sub">
            read-only · {isLive ? "live" : "mock"} · gated acts
          </span>
          {isLive && streamStatus !== "off" && (
            <span
              className={`live-indicator ${streamStatus}`}
              title={
                streamStatus === "reconnecting"
                  ? "Stream dropped — reconnecting with backoff"
                  : "Subscribed to the kernel fold stream"
              }
            >
              <span key={pulseKey} className="live-dot" />
              {liveLabel}
            </span>
          )}
        </div>
        <div className="header-right">
          <button
            className="pip-btn"
            onClick={handleFullTab}
            disabled={!fullTabSupported}
            title={
              fullTabSupported
                ? "Open the read-only mirror in a full browser tab"
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

      {frame && <ProvenanceHeader provenance={frame.provenance} />}

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
              layout={layout}
              onLayoutChange={handleLayoutChange}
              search={search}
              onSearchChange={handleSearchChange}
              searchHint={searchHint}
              activeTypes={viewTypes}
              onToggleType={toggleType}
              t={viewT}
              onTChange={setViewT}
              onApplyFilter={applyFilter}
              onResetFilter={resetFilter}
              filterHonored={isLive}
              accessMode={accessMode}
              onAccessModeChange={handleAccessModeChange}
            />
            <FrameGraph
              frame={frame}
              selectedUrn={selectedUrn}
              onSelect={handleSelect}
              layout={layout}
              focusUrn={focusUrn}
              focusSignal={focusSignal}
            />
            <NodeInspector
              frame={frame}
              node={selectedNode}
              onSelect={handleSelect}
            />
            <ErrorBoundary>
              <ActionsPanel
                frame={frame}
                selectedUrn={selectedUrn}
                liveTools={liveTools}
                affordanceError={affordanceError}
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
  createRoot(container).render(<ErrorBoundary><SidePanel /></ErrorBoundary>);
}
