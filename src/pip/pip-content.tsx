/**
 * Collider Pilot - Document PiP content view (Phase 3)
 * ====================================================
 * The compact frame view rendered INSIDE the Document Picture-in-Picture window
 * (and, standalone, inside `pip-preview.html` for served-page testing). It is a
 * PURE presentational component: it holds no store, no adapter, no I/O. It reuses
 * the exact same three render surfaces as the side panel — ProvenanceHeader +
 * FrameGraph + NodeInspector — so the PiP mirror shows the SAME frame identity and
 * selection the panel holds (criterion 3, #158).
 *
 * DEFENSIVE RENDER (Phase 1-fix discipline, preserved): every frame field is
 * Array.isArray-guarded before it reaches a child, and this whole subtree is wrapped
 * by an ErrorBoundary at each mount root (the real PiP mount in pip-window.tsx and the
 * pip-preview harness both wrap it). A partial/stale frame must never blank the mirror.
 */

import { useMemo } from "react";
import type { HgFrame, HgNode } from "../mcp/types";
import { ProvenanceHeader } from "../components/ProvenanceHeader";
import { FrameGraph } from "../components/FrameGraph";
import { NodeInspector } from "../components/NodeInspector";

export interface PipContentProps {
  /** The frame to mirror (passed through the shared scratch, never re-fetched). */
  frame: HgFrame | null;
  /** The shared selection (urn) or null. */
  selectedUrn: string | null;
  /** Selection handler; writes back to the shared scratch so the panel mirrors it. */
  onSelect: (urn: string | null) => void;
  /** Whether the mirror is bound to a live scratch stream (drives the status dot). */
  connected?: boolean;
  /** Label variant: the real PiP mirror vs the served-page preview. */
  variant?: "pip" | "preview";
}

export function PipContent({
  frame,
  selectedUrn,
  onSelect,
  connected,
  variant = "pip",
}: PipContentProps) {
  // Defensive: normalize the frame's arrays before any lookup or child render.
  const nodes = Array.isArray(frame?.nodes) ? (frame as HgFrame).nodes : [];

  const selectedNode: HgNode | null = useMemo(
    () => nodes.find((n) => n.urn === selectedUrn) ?? null,
    [nodes, selectedUrn],
  );

  const isConnected = connected ?? frame != null;

  return (
    <div className="pilot-container pip-container">
      <header className="pilot-header pip-header">
        <div className="header-left">
          <span
            className={`status-dot ${isConnected ? "connected" : ""}`}
            title={isConnected ? "mirroring side panel" : "waiting for a frame"}
          />
          <h1>Collider Pilot</h1>
          <span className="header-sub">
            {variant === "preview" ? "PiP · preview" : "PiP mirror"}
          </span>
        </div>
      </header>

      {frame && <ProvenanceHeader provenance={frame.provenance} />}

      <main className="pilot-body">
        {!frame && (
          <div className="pilot-state pip-waiting">
            Waiting for the side panel to project a frame…
          </div>
        )}
        {frame && (
          <>
            <FrameGraph
              frame={frame}
              selectedUrn={selectedUrn}
              onSelect={onSelect}
            />
            <NodeInspector
              frame={frame}
              node={selectedNode}
              onSelect={onSelect}
            />
          </>
        )}
      </main>
    </div>
  );
}
