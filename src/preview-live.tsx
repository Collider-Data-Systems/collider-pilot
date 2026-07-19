/**
 * Collider Pilot - LIVE preview harness (dev/test only)
 * =====================================================
 * The exact same side-panel component tree as `preview.tsx` (ProvenanceHeader +
 * FrameGraph + NodeInspector), but wired to the REAL `StreamableHttpMcpAdapter` reading
 * the live Z440 engine over MCP Streamable HTTP — no mock, no fixture.
 *
 * CORS CAVEAT (read this before you file a bug):
 *   Served from a normal page (e.g. `vite` dev server on http://localhost:5177), the
 *   browser applies CORS + forbids overriding the Origin header, so the cross-origin
 *   POST to http://localhost:8080/sse is BLOCKED and this harness shows a transport
 *   error. THAT IS EXPECTED. It renders live data only in a CORS-exempt context — i.e.
 *   loaded as the actual unpacked extension (host_permissions grant :8080/:8000), or a
 *   browser launched with web-security disabled. The Node smoke test
 *   (`node scripts/live-smoke.mjs`) has no CORS and is the headless live-read proof.
 *
 * Not shipped in the extension: a fourth vite entry (preview-live.html) for local/CI use.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { HgFrame } from "./mcp/types";
import { StreamableHttpMcpAdapter } from "./mcp/streamable-http-adapter";
import { ProvenanceHeader } from "./components/ProvenanceHeader";
import { FrameGraph } from "./components/FrameGraph";
import { NodeInspector } from "./components/NodeInspector";
import "./sidepanel.css";

const adapter = new StreamableHttpMcpAdapter();

type Status = "loading" | "ready" | "error";

function PreviewLive() {
  const [frame, setFrame] = useState<HgFrame | null>(null);
  const [selectedUrn, setSelectedUrn] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);

  const loadFrame = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const f = await adapter.getFrame();
      setFrame(f);
      setSelectedUrn((prev) =>
        prev && f.nodes.some((n) => n.urn === prev) ? prev : null,
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

  const selectedNode = useMemo(
    () => frame?.nodes.find((n) => n.urn === selectedUrn) ?? null,
    [frame, selectedUrn],
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
          <span className="header-sub">read-only · live · preview</span>
        </div>
        <div className="header-right">
          <button
            className="icon-btn"
            onClick={() => void loadFrame()}
            title="Reload live frame"
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
              Expected from a served page — the cross-origin POST to
              http://localhost:8080/sse is CORS-blocked. Load the unpacked extension for a
              live render, or run <code>node scripts/live-smoke.mjs</code> for the headless
              live-read proof.
            </div>
            <button className="retry-btn" onClick={() => void loadFrame()}>
              Retry
            </button>
          </div>
        )}
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
  createRoot(container).render(<PreviewLive />);
}
