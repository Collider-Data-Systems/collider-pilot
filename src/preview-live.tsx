/**
 * Collider Pilot - LIVE preview harness (dev/test only, Phase 6)
 * =============================================================
 * A served-page harness that exercises the live loop against the REAL kernel: the
 * posture strip (+ audit drawer), the consolidated Settings (identity + layout; no
 * provider section here), node search, view_filter controls, and — the headline — the
 * live SSE stream (pulse + debounced re-fetch + reconnect resync) via the SAME
 * `useFoldStream` hook + `transform.js` the extension ships.
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
import type { AccessScope, FrameRequest, HgFrame } from "./mcp/types";
import { selectFrame, DEFAULT_ENGINE_URL } from "./mcp/transform.js";
import { readRequestedMode, ANON_USER_URN } from "./mcp/access.js";
import { PILOT_ACCESS_KEY, type PilotAccessConfig } from "./state/access-identity";
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
import { LogFeed } from "./components/LogFeed";
import { NodeInspector } from "./components/NodeInspector";
import { SettingsPanel } from "./components/SettingsPanel";
import {
  DEFAULT_GRAPH_LAYOUT,
  DEFAULT_ACCESS_POSTURE,
  type GraphLayoutName,
  type AccessPosture,
} from "./state/prefs";
import { useFoldStream } from "./state/use-fold-stream";
import "./sidepanel.css";

type Status = "loading" | "ready" | "error";

/**
 * PREVIEW-ONLY chrome.storage.local shim.
 * ---------------------------------------
 * The packed extension resolves the identity from chrome.storage.local['pilot.access'] in the
 * MV3 worker (page-inaccessible). A served page has NO such storage, so the Settings identity editor
 * — which writes ONLY that key — would have nowhere to land. This shim gives the harness a
 * faithful chrome.storage.local (backed by window.localStorage so a "Save identity" survives a
 * reload), so the SAME control drives this preview EXACTLY as it drives the extension. Dev-only:
 * the real extension already exposes chrome.storage.local, so we never shadow it.
 */
function installPreviewStorageShim(): void {
  const g = globalThis as unknown as { chrome?: any };
  if (g.chrome?.storage?.local) return; // real extension storage present — leave it alone
  const LS_KEY = "pilot.preview.chromeStorageLocal";
  const read = (): Record<string, unknown> => {
    try {
      return JSON.parse(window.localStorage.getItem(LS_KEY) || "{}");
    } catch {
      return {};
    }
  };
  const write = (o: Record<string, unknown>): void => {
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify(o));
    } catch {
      /* ignore */
    }
  };
  const local = {
    async get(keys?: string | string[] | null) {
      const store = read();
      if (keys == null) return { ...store };
      const list = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const k of list) if (k in store) out[k] = store[k];
      return out;
    },
    async set(items: Record<string, unknown>) {
      write({ ...read(), ...items });
    },
    async remove(keys: string | string[]) {
      const store = read();
      for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
      write(store);
    },
  };
  g.chrome = { ...(g.chrome || {}), storage: { ...(g.chrome?.storage || {}), local } };
}
installPreviewStorageShim();

function normalizeEnforcement(
  value: unknown,
): "client-presentation" | "server-authoritative" {
  return value === "server-authoritative" ? "server-authoritative" : "client-presentation";
}

/**
 * Preview stand-in for src/state/access-identity.ts resolveTrustedAccess(): resolve the trusted
 * scope from the shimmed chrome.storage.local['pilot.access'] — the SAME key, shape, and
 * fail-closed rule the worker uses. With no identity stored, "Bring me in" fail-closes to anon,
 * faithfully reproducing the empty-workspace state the IdentityControl exists to fix; once the
 * control writes an identity, this returns it and the frame flips to identified.
 */
async function previewResolveTrustedAccess(mode: AccessPosture): Promise<AccessScope> {
  if (mode === "identified") {
    try {
      const chromeLocal = (globalThis as unknown as { chrome?: any }).chrome?.storage?.local;
      const got = await chromeLocal?.get?.(PILOT_ACCESS_KEY);
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
    } catch {
      // storage unavailable / malformed -> fail closed to anon
    }
  }
  return {
    mode: "anon",
    user: ANON_USER_URN,
    workstation: null,
    role: null,
    identity_source: "anon",
    enforced_by: "client-presentation",
  };
}

/**
 * Faithful stand-in for the MV3 worker seam (src/worker.ts withTrustedAccess): read the ONLY
 * page-influenced input — access.mode — from the inbound request, DISCARD any inbound
 * user/workstation/role/identity_source, and re-inject the trusted scope. A page can toggle
 * posture but can NEVER assert an identity or name a workstation.
 */
async function simulateWorkerSeam(
  request: FrameRequest | undefined,
): Promise<FrameRequest> {
  const mode = readRequestedMode(request); // extracts ONLY inbound access.mode
  const trusted = await previewResolveTrustedAccess(mode);
  return {
    ...request,
    view_filter: { ...(request?.view_filter ?? {}), access: trusted },
  };
}

/** Read a live frame from the CORS-open REST surface + the shared pure transform. */
async function fetchLiveFrame(request?: FrameRequest): Promise<HgFrame> {
  // Strip inbound access + re-inject the trusted identity, exactly as the worker does.
  const sanitized = await simulateWorkerSeam(request);
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
    request: sanitized,
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
  const [spec, setSpec] = useState<SliceSpec>(() => defaultSliceSpec());
  const [accessMode, setAccessMode] = useState<AccessPosture>(DEFAULT_ACCESS_POSTURE);
  const [identitySet, setIdentitySet] = useState(false);
  // FOCUS (scope) selection. "" = All permitted; non-empty = focus one spine node.
  const [viewScope, setViewScope] = useState<string>("");
  // The harness is a wide page — inline graph ON here (the panel defaults off).
  const [showGraph, setShowGraph] = useState(true);

  const frameRequestRef = useRef<FrameRequest | undefined>(
    buildFrameRequest(defaultSliceSpec(), DEFAULT_ACCESS_POSTURE),
  );
  // Mirrors the shipped panel so this harness exercises the SAME pending-Apply logic
  // (a hardcoded dirty={false} made the indicator untestable here).
  const [appliedSpec, setAppliedSpec] = useState<SliceSpec>(() => defaultSliceSpec());

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

  // (d) WORKER-STRIP PROOF (dev console). A page-forged access.user/workstation is DROPPED by
  // the seam — the resolved identity comes only from trusted storage. This mirrors what the MV3
  // worker enforces; here it runs against the preview's worker-seam simulation.
  useEffect(() => {
    void (async () => {
      const forged: FrameRequest = {
        view_filter: {
          access: {
            mode: "identified",
            user: "urn:moos:user:EVIL-INJECTED",
            workstation: "urn:moos:workstation:attacker",
            role: "urn:moos:role:superadmin",
            identity_source: "trusted-storage",
            enforced_by: "server-authoritative",
          },
        },
      };
      const sanitized = await simulateWorkerSeam(forged);
      const forgedUser = forged.view_filter?.access?.user;
      const resolvedUser = sanitized.view_filter?.access?.user;
      // eslint-disable-next-line no-console
      console.log(
        "[pilot][access] worker-strip proof — inbound forged user:",
        forgedUser,
        "→ resolved user:",
        resolvedUser,
        "| forged DROPPED:",
        resolvedUser !== forgedUser,
        "| forged workstation DROPPED:",
        sanitized.view_filter?.access?.workstation !==
          forged.view_filter?.access?.workstation,
      );
    })();
  }, []);

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

  const commitSlice = useCallback(
    (nextSpec: SliceSpec, mode: AccessPosture, scopeUrn: string) => {
      const req = buildFrameRequest(nextSpec, mode, scopeUrn ? [scopeUrn] : []);
      frameRequestRef.current = req;
      setAppliedSpec(nextSpec);
      void loadFrame(req);
    },
    [loadFrame],
  );

  const handleLensChange = useCallback(
    (lensId: string) => {
      const next = specWithLens(spec, lensId);
      setSpec(next);
      commitSlice(next, accessMode, viewScope);
    },
    [spec, accessMode, viewScope, commitSlice],
  );

  const toggleType = useCallback((ty: string) => {
    setSpec((prev) => specToggleType(prev, ty));
  }, []);
  const togglePort = useCallback((p: string) => {
    setSpec((prev) => specTogglePort(prev, p));
  }, []);
  const handleTChange = useCallback((t: string) => {
    setSpec((prev) => ({ ...prev, t }));
  }, []);
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
    setViewScope("");
    commitSlice(next, accessMode, "");
  }, [accessMode, commitSlice]);

  // FOCUS selector — focus one spine node (or All permitted when ""). Read-only narrow.
  const handleScopeChange = useCallback(
    (scopeUrn: string) => {
      setViewScope(scopeUrn);
      commitSlice(spec, accessMode, scopeUrn);
    },
    [spec, accessMode, commitSlice],
  );

  const handleAccessModeChange = useCallback(
    (mode: AccessPosture) => {
      setAccessMode(mode);
      setViewScope(""); // posture change ⇒ permitted set changes; reset focus to All permitted
      commitSlice(spec, mode, "");
    },
    [spec, commitSlice],
  );

  const isLive = frame != null && frame.provenance?.mock === false;
  const stale = status === "error" && frame != null;
  const reloadForStream = useCallback(() => void loadFrame(), [loadFrame]);
  const { status: streamStatus, pulseKey } = useFoldStream({
    active: isLive,
    onReload: reloadForStream,
  });

  const selectedNode = useMemo(
    () => frame?.nodes.find((n) => n.urn === selectedUrn) ?? null,
    [frame, selectedUrn],
  );

  const permittedWorkspaces = useMemo(
    () => frame?.provenance?.access?.permitted_workspaces ?? [],
    [frame],
  );

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
          <span className="header-sub">live harness</span>
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

      {frame && (
        <PostureStrip
          provenance={frame.provenance}
          streamStatus={isLive ? streamStatus : "off"}
          pulseKey={pulseKey}
          stale={stale}
        />
      )}
      {stale && (
        <div className="stale-banner" role="status">
          <span className="stale-banner-text">
            refresh failed — showing the last good frame (seq {frame?.provenance?.log_seq}):{" "}
            {error}
          </span>
          <button className="mini-btn" onClick={() => void loadFrame()}>
            retry
          </button>
        </div>
      )}
      {!frame && (
        <section className="provenance posture-strip" aria-label="Frame posture (no frame)">
          <div className="prov-top">
            <span className="prov-badge readonly">READ-ONLY</span>
            <span className="prov-summary">no frame loaded — posture renders with the frame</span>
          </div>
        </section>
      )}

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
            <ErrorBoundary>
              {/* no provider section here: this harness exercises the frame/identity loop only */}
              <SettingsPanel
                frame={frame}
                accessMode={accessMode}
                onReloadFrame={() => void loadFrame()}
                onIdentityChanged={setIdentitySet}
                layout={layout}
                onLayoutChange={setLayout}
              />
            </ErrorBoundary>
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
              onToggleGraphVisible={() => setShowGraph((v) => !v)}
              dirty={
                JSON.stringify({ t: spec.types, p: spec.ports, tt: spec.t }) !==
                JSON.stringify({ t: appliedSpec.types, p: appliedSpec.ports, tt: appliedSpec.t })
              }
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
            <ErrorBoundary>
              <LogFeed live={isLive} frame={frame} accessMode={accessMode} onSelect={handleSelect} />
            </ErrorBoundary>
            <NodeInspector
              frame={frame}
              node={selectedNode}
              onSelect={handleSelect}
              collapsible
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
