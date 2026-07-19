/**
 * Collider Pilot - standalone preview harness (dev/test only)
 * ===========================================================
 * Renders the REAL side-panel components (ProvenanceHeader + GraphControls + FrameGraph +
 * NodeInspector + ActionsPanel) against the REAL MockMcpAdapter, WITHOUT the MV3 extension
 * chrome. It reimplements only the worker-messaging wrapper — precisely the part that
 * cannot be exercised outside a loaded extension. Everything a served-page browser test
 * can verify (render, provenance collapse, layout picker, node search, Cytoscape relations
 * inspector, node selection, gated Actions + the tools disclosure) is exercised here.
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
import { ProvenanceHeader } from "./components/ProvenanceHeader";
import { FrameGraph } from "./components/FrameGraph";
import {
  GraphControls,
  DEFAULT_VIEW_TYPES,
} from "./components/GraphControls";
import { NodeInspector } from "./components/NodeInspector";
import { ActionsPanel } from "./components/ActionsPanel";
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
  const [viewTypes, setViewTypes] = useState<string[]>(DEFAULT_VIEW_TYPES);
  const [viewT, setViewT] = useState("");
  // Access posture is inert on the MOCK adapter (it ignores view_filter) — the toggle is
  // present only so this harness renders the same GraphControls as the shipped panel.
  const [accessMode, setAccessMode] = useState<AccessPosture>(DEFAULT_ACCESS_POSTURE);

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

  const toggleType = useCallback((type: string) => {
    setViewTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  }, []);

  const resetFilter = useCallback(() => {
    setViewTypes(DEFAULT_VIEW_TYPES);
    setViewT("");
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
          <span className="header-sub">read-only · mock · preview</span>
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

      {frame && <ProvenanceHeader provenance={frame.provenance} />}

      <main className="pilot-body">
        {!frame && <div className="pilot-state">Loading mock frame…</div>}
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
              onApplyFilter={() => void loadFrame()}
              onResetFilter={resetFilter}
              filterHonored={false}
              // The MOCK frame carries no access fiber, so there are no permitted seats to focus;
              // the seat selector renders inert ("All permitted (0)"), like the other view_filter
              // controls on this adapter. The live harness (preview-live.tsx) exercises it for real.
              permittedWorkspaces={[]}
              activeScope=""
              onScopeChange={() => void loadFrame()}
              accessMode={accessMode}
              onAccessModeChange={setAccessMode}
              onReloadFrame={() => void loadFrame()}
            />
            <FrameGraph
              frame={frame}
              selectedUrn={selectedUrn}
              onSelect={setSelectedUrn}
              layout={layout}
              focusUrn={focusUrn}
              focusSignal={focusSignal}
            />
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
