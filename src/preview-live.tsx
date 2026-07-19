/**
 * Collider Pilot - LIVE preview harness (dev/test only, Phase 6)
 * =============================================================
 * A served-page harness that exercises the Phase 6 live loop against the REAL kernel:
 * graph layout picker, node search, view_filter controls, the collapsible provenance
 * header, and — the headline — the live SSE stream (pulse + debounced re-fetch + reconnect
 * resync) via the SAME `useFoldStream` hook + `transform.js` the extension ships.
 *
 * WHY REST /fold HERE (and not the MCP adapter):
 *   The shipped side panel reads frames through `StreamableHttpMcpAdapter` (MCP :8080).
 *   From a normal served page that POST is CORS-blocked (the browser forbids overriding
 *   Origin), so the adapter can't render served — that's expected and documented. The
 *   kernel's REST surface, by contrast, sends `Access-Control-Allow-Origin: *`, so this
 *   harness reads the one-shot `GET :8000/fold` snapshot + `GET :8000/healthz` and runs
 *   the EXACT same pure `selectFrame` transform to build the frame. The frame is therefore
 *   identical in shape to the adapter's, and the live-SSE mechanics under test are the
 *   real ones. In the loaded extension both :8000 and :8080 are host-permitted.
 *
 * READ-ONLY: only GET requests (the REST snapshot + the GET-only EventSource). No apply.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import type { FrameRequest, HgFrame } from "./mcp/types";
import { selectFrame, DEFAULT_ENGINE_URL } from "./mcp/transform.js";
import { ProvenanceHeader } from "./components/ProvenanceHeader";
import { FrameGraph } from "./components/FrameGraph";
import {
  GraphControls,
  DEFAULT_VIEW_TYPES,
  buildFrameRequest,
} from "./components/GraphControls";
import { NodeInspector } from "./components/NodeInspector";
import {
  DEFAULT_GRAPH_LAYOUT,
  type GraphLayoutName,
} from "./state/prefs";
import { useFoldStream } from "./state/use-fold-stream";
import "./sidepanel.css";

type Status = "loading" | "ready" | "error";

/** Read a live frame from the CORS-open REST surface + the shared pure transform. */
async function fetchLiveFrame(request?: FrameRequest): Promise<HgFrame> {
  const [foldRes, healthRes] = await Promise.all([
    fetch(`${DEFAULT_ENGINE_URL}/fold`),
    fetch(`${DEFAULT_ENGINE_URL}/healthz`),
  ]);
  if (!foldRes.ok) throw new Error(`GET /fold -> HTTP ${foldRes.status}`);
  const foldJson = await foldRes.json();
  const health = healthRes.ok ? await healthRes.json() : {};
  // /fold returns { nodes:[…], relations:[…] }; selectFrame's Object.values handles arrays.
  const fold = { nodes: foldJson.nodes ?? {}, relations: foldJson.relations ?? {} };
  return selectFrame(fold, {
    healthz: health,
    request,
    engineEndpoint: `${DEFAULT_ENGINE_URL} (HTTP /fold · served-page harness)`,
    foldedAt: new Date().toISOString(),
  });
}

function PreviewLive() {
  const [frame, setFrame] = useState<HgFrame | null>(null);
  const [selectedUrn, setSelectedUrn] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);

  const [layout, setLayout] = useState<GraphLayoutName>(DEFAULT_GRAPH_LAYOUT);
  const [search, setSearch] = useState("");
  const [searchHint, setSearchHint] = useState<string | null>(null);
  const [focusUrn, setFocusUrn] = useState<string | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);
  const [viewTypes, setViewTypes] = useState<string[]>(DEFAULT_VIEW_TYPES);
  const [viewT, setViewT] = useState("");

  const frameRequestRef = useRef<FrameRequest | undefined>(undefined);

  const loadFrame = useCallback(async (request?: FrameRequest) => {
    const req = request ?? frameRequestRef.current;
    setStatus("loading");
    setError(null);
    try {
      const f = await fetchLiveFrame(req);
      const safe: HgFrame = {
        ...f,
        nodes: Array.isArray(f?.nodes) ? f.nodes : [],
        relations: Array.isArray(f?.relations) ? f.relations : [],
      };
      setFrame(safe);
      setSelectedUrn((prev) =>
        prev && safe.nodes.some((n) => n.urn === prev) ? prev : null,
      );
      setStatus("ready");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void loadFrame();
  }, [loadFrame]);

  const handleSelect = useCallback((urn: string | null) => {
    setSelectedUrn(urn);
  }, []);

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
      setSelectedUrn(hit.urn);
      setFocusUrn(hit.urn);
      setFocusSignal((s) => s + 1);
    },
    [frame],
  );

  const toggleType = useCallback((type: string) => {
    setViewTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  }, []);

  const applyFilter = useCallback(() => {
    const req = buildFrameRequest(viewTypes, viewT);
    frameRequestRef.current = req;
    void loadFrame(req);
  }, [viewTypes, viewT, loadFrame]);

  const resetFilter = useCallback(() => {
    setViewTypes(DEFAULT_VIEW_TYPES);
    setViewT("");
    frameRequestRef.current = undefined;
    void loadFrame(undefined);
  }, [loadFrame]);

  const isLive = frame != null && frame.provenance?.mock === false;
  const reloadForStream = useCallback(() => void loadFrame(), [loadFrame]);
  const { status: streamStatus, pulseKey } = useFoldStream({
    active: isLive,
    onReload: reloadForStream,
  });

  const selectedNode = useMemo(
    () => frame?.nodes.find((n) => n.urn === selectedUrn) ?? null,
    [frame, selectedUrn],
  );

  const liveLabel = streamStatus === "reconnecting" ? "RECONNECTING" : "LIVE";

  return (
    <div className="pilot-container">
      <header className="pilot-header">
        <div className="header-left">
          <span
            className={`status-dot ${status === "ready" ? "connected" : status === "error" ? "disconnected" : ""}`}
            title={status}
          />
          <h1>Collider Pilot</h1>
          <span className="header-sub">read-only · live · preview</span>
          {isLive && streamStatus !== "off" && (
            <span className={`live-indicator ${streamStatus}`}>
              <span key={pulseKey} className="live-dot" />
              {liveLabel}
            </span>
          )}
        </div>
        <div className="header-right">
          <button
            className="icon-btn"
            onClick={() => void loadFrame()}
            title="Reload live frame (force-refresh)"
          >
            ⟳
          </button>
        </div>
      </header>

      {frame && <ProvenanceHeader provenance={frame.provenance} />}

      <main className="pilot-body">
        {status === "loading" && !frame && (
          <div className="pilot-state">Reading live frame from the engine…</div>
        )}
        {status === "error" && !frame && (
          <div className="pilot-state error">
            Live read failed: {error}
            <div style={{ fontSize: 11, opacity: 0.75, maxWidth: 320 }}>
              This harness reads the CORS-open <code>GET /fold</code> REST snapshot. If it
              fails, the kernel is likely not running on {DEFAULT_ENGINE_URL}.
            </div>
            <button className="retry-btn" onClick={() => void loadFrame()}>
              Retry
            </button>
          </div>
        )}
        {frame && (
          <>
            <GraphControls
              layout={layout}
              onLayoutChange={setLayout}
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
          </>
        )}
      </main>
    </div>
  );
}

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(
    <ErrorBoundary>
      <PreviewLive />
    </ErrorBoundary>,
  );
}
