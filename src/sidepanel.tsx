/**
 * Collider Pilot - side panel (the seat)
 * ======================================
 * Read-only Phase 1 shell. Asks the service worker for a mock frame, renders the
 * provenance header + Cytoscape inspector + textual node inspector, and keeps
 * selection/frame in chrome.storage.session so the panel restores after a forced
 * service-worker termination. No model, no writes, no page access.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import type { HgFrame, PilotRequest, PilotResponse, RawMcpTool } from "./mcp/types";
import { loadScratch, saveScratch, subscribeScratch } from "./state/scratch";
import { ProvenanceHeader } from "./components/ProvenanceHeader";
import { FrameGraph } from "./components/FrameGraph";
import { NodeInspector } from "./components/NodeInspector";
import { ActionsPanel } from "./components/ActionsPanel";
import {
  isPopOutSupported,
  isPipOpen,
  focusPip,
  openPipMirror,
} from "./pip/pip-window";
import "./sidepanel.css";

type Status = "loading" | "ready" | "error";

async function requestFrame(): Promise<PilotResponse> {
  // Waking the worker with a message is what restarts it if it was terminated;
  // the mock adapter answers identically each time (no lost state).
  return (await chrome.runtime.sendMessage({
    type: "GET_FRAME",
  } as PilotRequest)) as PilotResponse;
}

/**
 * Phase 4: ask the worker for the MCP tools/list catalog (READ-ONLY discovery). The
 * worker answers with the live catalog (live adapter) or an empty list (mock adapter),
 * and the Actions section projects the affordance pack from it, falling back to the mock
 * pack. Listing is not calling — no tool is invoked here.
 */
async function requestTools(): Promise<PilotResponse> {
  return (await chrome.runtime.sendMessage({
    type: "LIST_TOOLS",
  } as PilotRequest)) as PilotResponse;
}

function SidePanel() {
  const [frame, setFrame] = useState<HgFrame | null>(null);
  const [selectedUrn, setSelectedUrn] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  // Feature-detect Pop-out once (criterion 6). Enabled whenever EITHER Document PiP or
  // chrome.windows is available — in the extension that's always, so the button always
  // opens SOMETHING (Document PiP, or the chrome.windows popup fallback from the panel).
  const [popOutSupported] = useState(() => isPopOutSupported());
  const [pipOpen, setPipOpen] = useState(false);
  // Phase 4: the MCP tools/list catalog for the affordance pack (null ⇒ mock fallback).
  const [liveTools, setLiveTools] = useState<RawMcpTool[] | null>(null);
  const [affordanceError, setAffordanceError] = useState<string | null>(null);

  const loadFrame = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const res = await requestFrame();
      if (res.type === "FRAME") {
        // Normalize: never let a frame with a missing/non-array nodes/relations
        // reach the renderer (Cytoscape init throws on a non-array).
        const safeFrame: HgFrame = {
          ...res.frame,
          nodes: Array.isArray(res.frame?.nodes) ? res.frame.nodes : [],
          relations: Array.isArray(res.frame?.relations) ? res.frame.relations : [],
        };
        setFrame(safeFrame);
        setStatus("ready");
        // Cache to browser scratch; drop a stale selection not present in the frame.
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
        // A non-FRAME, non-ERROR response to GET_FRAME should never happen; treat defensively.
        setStatus("error");
        setError("unexpected response to GET_FRAME");
      }
    } catch (err) {
      setStatus("error");
      setError(String(err));
    }
  }, []);

  // Phase 4: load the tool catalog for affordance discovery. Non-fatal — a failure just
  // falls the Actions section back to the labelled mock pack.
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

  // Mount: restore instantly from scratch (survives worker termination), then
  // refresh from the worker.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const scratch = await loadScratch();
      // Only restore a well-shaped cached frame; a stale/partial one (e.g. from an
      // earlier extension version) must not reach the renderer.
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
      await loadFrame();
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

  // Mirror the PiP window: adopt SELECTION changes written to the shared scratch by the
  // other surface (the panel authors the frame, so frame changes from scratch are ignored
  // here). Event-driven via storage.onChanged — no polling, and no re-write (no loop).
  useEffect(() => {
    const unsub = subscribeScratch((s) => {
      setSelectedUrn((prev) => (s.selectedUrn === prev ? prev : s.selectedUrn));
    });
    return unsub;
  }, []);

  // Open (or focus) the Document PiP mirror. The click IS the user gesture — call
  // openPipMirror synchronously so requestWindow() runs with a valid activation.
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
          <span className="header-sub">
            read-only · {frame && frame.provenance.mock === false ? "live" : "mock"} · gated acts
          </span>
        </div>
        <div className="header-right">
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
            title="Reload frame (re-asks the worker; proves restart resilience)"
          >
            ⟳
          </button>
        </div>
      </header>

      {frame && <ProvenanceHeader provenance={frame.provenance} />}

      <main className="pilot-body">
        {status === "loading" && !frame && (
          <div className="pilot-state">Loading mock frame…</div>
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
            <FrameGraph
              frame={frame}
              selectedUrn={selectedUrn}
              onSelect={handleSelect}
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
