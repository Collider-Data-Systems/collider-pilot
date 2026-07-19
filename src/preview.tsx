/**
 * Collider Pilot - standalone preview harness (dev/test only)
 * ===========================================================
 * Renders the REAL side-panel components (ProvenanceHeader + FrameGraph +
 * NodeInspector) against the REAL MockMcpAdapter, WITHOUT the MV3 extension
 * chrome. It reimplements only the worker-messaging wrapper — precisely the
 * part that cannot be exercised outside a loaded extension. Everything a
 * served-page browser test can verify (render, provenance header, Cytoscape
 * relations inspector, node selection, text inspector) is exercised here.
 *
 * Not shipped in the extension: it is a third vite entry (preview.html) used
 * for local/CI UI verification. The extension itself never loads this file.
 */

import { useCallback, useMemo, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import type { HgFrame } from "./mcp/types";
import { MockMcpAdapter } from "./mcp/mock-adapter";
import { ProvenanceHeader } from "./components/ProvenanceHeader";
import { FrameGraph } from "./components/FrameGraph";
import { NodeInspector } from "./components/NodeInspector";
import "./sidepanel.css";

const adapter = new MockMcpAdapter();

function Preview() {
  const [frame, setFrame] = useState<HgFrame | null>(null);
  const [selectedUrn, setSelectedUrn] = useState<string | null>(null);

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
            <FrameGraph
              frame={frame}
              selectedUrn={selectedUrn}
              onSelect={setSelectedUrn}
            />
            <NodeInspector
              frame={frame}
              node={selectedNode}
              onSelect={setSelectedUrn}
            />
          </>
        )}
      </main>
    </div>
  );
}

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<Preview />);
}
