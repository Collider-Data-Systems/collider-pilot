/**
 * Collider Pilot - standalone preview harness (dev/test only)
 * ===========================================================
 * Renders the REAL side-panel components (PostureStrip + SettingsPanel + GraphControls +
 * FrameGraph + NodeInspector + ActionsPanel) against the REAL MockMcpAdapter, WITHOUT the MV3 extension
 * chrome. It reimplements only the worker-messaging wrapper — precisely the part that
 * cannot be exercised outside a loaded extension. Everything a served-page browser test
 * can verify (render, posture strip + audit drawer, consolidated Settings, node search,
 * Cytoscape relations inspector, node selection, gated Actions + the tools disclosure) is
 * exercised here.
 *
 * The MOCK adapter has no live stream — so, correctly, NO EventSource is opened here and
 * the view_filter is inert (the note in GraphControls states so). The live SSE loop is
 * exercised by `preview-live.tsx` against the real kernel.
 *
 * Not shipped in the extension: it is a vite entry (preview.html) used for local/CI UI
 * verification. The extension itself never loads this file.
 */

import { useCallback, useMemo, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import type { HgFrame } from "./mcp/types";
import { MockMcpAdapter } from "./mcp/mock-adapter";
import { PostureStrip } from "./components/PostureStrip";
import { FrameGraph } from "./components/FrameGraph";
import {
  GraphControls,
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
import {
  DEFAULT_PROVIDER_ID,
  getProvider,
  providerDefaultModel,
} from "./tools/model-providers";
import {
  DEFAULT_GRAPH_LAYOUT,
  DEFAULT_ACCESS_POSTURE,
  type GraphLayoutName,
  type AccessPosture,
} from "./state/prefs";
import "./sidepanel.css";

const adapter = new MockMcpAdapter();

function Preview() {
  const [frame, setFrame] = useState<HgFrame | null>(null);
  const [selectedUrn, setSelectedUrn] = useState<string | null>(null);

  const [layout, setLayout] = useState<GraphLayoutName>(DEFAULT_GRAPH_LAYOUT);
  const [search, setSearch] = useState("");
  const [searchHint, setSearchHint] = useState<string | null>(null);
  const [focusUrn, setFocusUrn] = useState<string | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);
  const [spec, setSpec] = useState<SliceSpec>(() => defaultSliceSpec());
  const [showGraph, setShowGraph] = useState(true);
  // Access posture is inert on the MOCK adapter (it ignores view_filter) — the toggle is
  // present only so this harness renders the same GraphControls as the shipped panel.
  const [accessMode, setAccessMode] = useState<AccessPosture>(DEFAULT_ACCESS_POSTURE);
  const [identitySet, setIdentitySet] = useState(false);

  // Provider/model/bearer state mirrors the shipped panel (Settings sets, Actions consumes).
  // Served without extension storage the save calls no-op — the harness still renders the
  // exact same consolidated Settings surface.
  const [providerId, setProviderId] = useState<string>(DEFAULT_PROVIDER_ID);
  const [modelName, setModelName] = useState<string>(() =>
    providerDefaultModel(getProvider(DEFAULT_PROVIDER_ID)),
  );
  const [llmTokenSet, setLlmTokenSet] = useState(false);

  const handleProviderChange = useCallback((id: string) => {
    setProviderId(id);
    setModelName(providerDefaultModel(getProvider(id)));
  }, []);

  const loadFrame = useCallback(async () => {
    const f = await adapter.getFrame();
    setFrame(f);
    setSelectedUrn((prev) =>
      prev && f.nodes.some((n) => n.urn === prev) ? prev : null,
    );
  }, []);

  useEffect(() => {
    void loadFrame();
  }, [loadFrame]);

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

  const toggleType = useCallback((ty: string) => {
    setSpec((prev) => specToggleType(prev, ty));
  }, []);
  const togglePort = useCallback((p: string) => {
    setSpec((prev) => specTogglePort(prev, p));
  }, []);

  const resetFilter = useCallback(() => {
    setSpec(defaultSliceSpec());
  }, []);

  const selectedNode = useMemo(
    () => frame?.nodes.find((n) => n.urn === selectedUrn) ?? null,
    [frame, selectedUrn],
  );

  return (
    <div className="pilot-container">
      <header className="pilot-header">
        <div className="header-left">
          <span className="status-dot connected" title="preview" />
          <h1>Collider Pilot</h1>
          {/* t263 item 1 dedupe: MOCK/READ-ONLY render only on the PostureStrip. */}
          <span className="header-sub">mock harness</span>
        </div>
        <div className="header-right">
          <button
            className="icon-btn"
            onClick={() => void loadFrame()}
            title="Reload frame"
          >
            ⟳
          </button>
        </div>
      </header>

      {frame && <PostureStrip provenance={frame.provenance} />}
      {!frame && (
        <section className="provenance posture-strip" aria-label="Frame posture (no frame)">
          <div className="prov-top">
            <span className="prov-badge readonly">READ-ONLY</span>
            <span className="prov-summary">no frame loaded — posture renders with the frame</span>
          </div>
        </section>
      )}

      <main className="pilot-body">
        {!frame && <div className="pilot-state">Loading mock frame…</div>}
        {frame && (
          <>
            <ErrorBoundary>
              <SettingsPanel
                frame={frame}
                accessMode={accessMode}
                onReloadFrame={() => void loadFrame()}
                onIdentityChanged={setIdentitySet}
                layout={layout}
                onLayoutChange={setLayout}
                provider={{
                  providerId,
                  onProviderChange: handleProviderChange,
                  modelName,
                  onModelChange: setModelName,
                  llmTokenSet,
                  onLlmTokenChanged: setLlmTokenSet,
                  access: frame.provenance?.access ?? null,
                }}
              />
            </ErrorBoundary>
            <GraphControls
              search={search}
              onSearchChange={handleSearchChange}
              searchHint={searchHint}
              spec={spec}
              onLensChange={(id) => setSpec((prev) => specWithLens(prev, id))}
              onToggleType={toggleType}
              onTogglePort={togglePort}
              onTChange={(t) => setSpec((prev) => ({ ...prev, t }))}
              onHopsChange={(hops) => setSpec((prev) => ({ ...prev, hops }))}
              onApplyFilter={() => void loadFrame()}
              onResetFilter={resetFilter}
              filterHonored={false}
              // The MOCK adapter ignores the slice; the controls render inert, like the
              // old view_filter note said. The live harness exercises them for real.
              focusOptions={collectFocusOptions(frame, [])}
              activeScope=""
              onScopeChange={() => void loadFrame()}
              selectedUrn={selectedUrn}
              accessMode={accessMode}
              onAccessModeChange={setAccessMode}
              identitySet={identitySet}
              showGraph={showGraph}
              onToggleGraphVisible={() => setShowGraph((v) => !v)}
            />
            {showGraph && (
              <FrameGraph
                frame={frame}
                selectedUrn={selectedUrn}
                onSelect={setSelectedUrn}
                layout={layout}
                focusUrn={focusUrn}
                focusSignal={focusSignal}
              />
            )}
            <NodeInspector
              frame={frame}
              node={selectedNode}
              onSelect={setSelectedUrn}
            />
            <ErrorBoundary>
              {/* liveTools=null ⇒ the served-page harness projects the labelled MOCK pack. */}
              <ActionsPanel
                frame={frame}
                selectedUrn={selectedUrn}
                liveTools={null}
                affordanceError={null}
                providerId={providerId}
                modelName={modelName}
                llmTokenSet={llmTokenSet}
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
  createRoot(container).render(
    <ErrorBoundary>
      <Preview />
    </ErrorBoundary>,
  );
}
